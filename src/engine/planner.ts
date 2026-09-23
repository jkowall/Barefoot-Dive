import type {
  BarAbsolute,
  CalculationResult,
  CcrDiveInput,
  DecoStop,
  Diagnostic,
  DivePlan,
  DivePlanInput,
  Fraction,
  Gas,
  Meters,
  OcDiveInput,
  ProfileSegment,
  Seconds,
  TissueState,
} from "../domain/types";
import {
  ambientPressureToDepth,
  barAbsolute,
  depthToAmbientPressure,
  meters,
  roundDepthDeeper,
  roundDepthShallower,
  seconds,
} from "../domain/units";
import {
  compareGasPreference,
  effectiveBailoutGases,
  effectiveSwitchDownDepth,
  setpointAchievableDepth,
  gasPPO2,
  isBelowMinimumPPO2,
  isSwitchEligible,
  maximumPPO2ForGas,
  ocBottomSwitchDepth,
  sameGas,
  usesLowSetpoint,
  validateDiveInput,
  validateGas,
} from "../domain/validation";
import { calculateGasLedger } from "../gas/ledger";
import { conventionFor, effectiveAscentRate } from "./conventions";
import {
  calculateCeiling,
  exposeTissues,
  gradientFactorAtDepth,
  initializeTissues,
  type BreathingStrategy,
} from "./tissues";
import {
  ZHL16C_COEFFICIENT_HASH,
  ZHL16C_MODEL_ID,
  ZHL16C_MODEL_VERSION,
} from "./zhl16c";

export const ENGINE_VERSION = "barefoot-dive-engine-0.2.1";
const MAX_ASCENT_ITERATIONS = 10_000;
const MAX_DECOMPRESSION_SECONDS = 48 * 60 * 60;
const EPSILON = 1e-8;

type WorkingState = {
  tissues: TissueState;
  runtimeSeconds: Seconds;
  depthM: Meters;
  segments: ProfileSegment[];
  currentStrategy: BreathingStrategy;
  currentGas: Gas;
  firstStopDepthM?: Meters;
};

/**
 * CCR ascent breathing rule. Legacy: switch to open-circuit diluent on arrival at the
 * activation depth. Low: hold the high setpoint at or below the switch-down depth
 * (including a stop there) and switch to the low setpoint when leaving it.
 */
type CcrAscent =
  | { readonly mode: "legacy"; readonly activationDepthM: Meters }
  | { readonly mode: "low"; readonly switchDownDepthM: Meters; readonly lowStrategy: Extract<BreathingStrategy, { kind: "ccr" }> };

type AscentConfiguration = {
  readonly input: DivePlanInput;
  readonly availableOcGases?: readonly Gas[];
  readonly ccrAscent?: CcrAscent;
  readonly segmentKind?: "ascent" | "bailout" | "exit";
  /**
   * Set only when a first schedule deadlocked at a stop: at that stop depth or shallower,
   * allow leaving a stop that cannot clear for a shallower depth where a richer open-circuit
   * gas becomes eligible. Deeper stops are scheduled exactly as in the first run.
   */
  readonly gasSwitchWaypointMaxDepthM?: Meters;
};

type AscentResult = {
  readonly state: WorkingState;
  readonly stops: readonly DecoStop[];
  readonly diagnostics: readonly Diagnostic[];
  readonly ttsSeconds: Seconds;
};

export type ExposureEvent = {
  readonly id: string;
  readonly kind: Extract<ProfileSegment["kind"], "descent" | "bottom" | "penetration" | "exit" | "bailout">;
  readonly startDepthM: Meters;
  readonly endDepthM: Meters;
  readonly durationSeconds: Seconds;
  readonly gas: Gas;
  readonly strategy: BreathingStrategy;
};

function diagnostic(
  code: string,
  severity: Diagnostic["severity"],
  message: string,
  details: Partial<Diagnostic> = {},
): Diagnostic {
  return { code, severity, message, ...details };
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function strategyLabel(strategy: BreathingStrategy, gas: Gas): string {
  return strategy.kind === "ccr"
    ? `CCR ${strategy.setpointBar.toFixed(2)} / ${gas.name}`
    : gas.name;
}

function appendExposure(
  state: WorkingState,
  input: DivePlanInput,
  kind: ProfileSegment["kind"],
  endDepthM: Meters,
  durationSeconds: Seconds,
  gf: Fraction,
  strategy = state.currentStrategy,
  gas = state.currentGas,
  exposureStrategy = strategy,
): WorkingState {
  const startPressure = depthToAmbientPressure(
    state.depthM,
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
  const endPressure = depthToAmbientPressure(
    endDepthM,
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
  const tissues = exposeTissues(
    state.tissues,
    startPressure,
    endPressure,
    durationSeconds,
    exposureStrategy,
    input.environmentSettings,
  );
  const ceiling = calculateCeiling(tissues, gf, input.environmentSettings);
  const segment: ProfileSegment = {
    id: `segment-${state.segments.length + 1}`,
    kind,
    startRuntimeSeconds: state.runtimeSeconds,
    durationSeconds,
    startDepthM: state.depthM,
    endDepthM,
    gasId: gas.id,
    gasName: strategyLabel(strategy, gas),
    ...(strategy.kind === "ccr" ? { setpointBar: strategy.setpointBar } : {}),
    gf,
    ceilingDepthM: ceiling.depthM,
    tissuesAfter: tissues,
  };
  return {
    ...state,
    tissues,
    runtimeSeconds: seconds(state.runtimeSeconds + durationSeconds),
    depthM: endDepthM,
    segments: [...state.segments, segment],
    currentStrategy: strategy,
    currentGas: gas,
  };
}

function ascentDuration(startDepthM: Meters, endDepthM: Meters, rateMPerMinute: number): Seconds {
  return seconds((Math.abs(startDepthM - endDepthM) / rateMPerMinute) * 60);
}

function nextStopDepth(currentDepthM: Meters, input: DivePlanInput): Meters {
  if (currentDepthM <= input.settings.lastStopDepthM + EPSILON) return meters(0);
  const aligned = roundDepthShallower(currentDepthM, input.settings.stopIncrementM);
  const candidate = aligned >= currentDepthM - EPSILON
    ? meters(aligned - input.settings.stopIncrementM)
    : aligned;
  return meters(Math.max(input.settings.lastStopDepthM, candidate));
}

function selectBestGas(gases: readonly Gas[], depthM: Meters, input: DivePlanInput): Gas | undefined {
  return gases
    .filter((gas) => isSwitchEligible(gas, depthM, input))
    .slice()
    .sort(compareGasPreference)[0];
}

function registeredGases(input: DivePlanInput): readonly Gas[] {
  return input.mode === "oc"
    ? [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases]
    : [input.diluent, ...input.bailoutGases];
}

function ccrStrategy(input: CcrDiveInput, setpointBar: BarAbsolute): Extract<BreathingStrategy, { kind: "ccr" }> {
  return { kind: "ccr", diluent: input.diluent, setpointBar };
}

/**
 * `heldSetpointBar` is the setpoint actually breathed when the ascent starts. Explicit event
 * plans can hold a setpoint other than `setpointBar`, and the switch-down must also be no
 * shallower than the depth where that setpoint is achievable.
 */
function ccrAscentConfiguration(input: CcrDiveInput, heldSetpointBar?: number): CcrAscent {
  if (!usesLowSetpoint(input)) return { mode: "legacy", activationDepthM: input.setpointActivationDepthM };
  const held = heldSetpointBar === undefined ? 0 : setpointAchievableDepth(heldSetpointBar, input.environmentSettings);
  return {
    mode: "low",
    switchDownDepthM: meters(Math.max(effectiveSwitchDownDepth(input), held)),
    lowStrategy: ccrStrategy(input, input.lowSetpointBar),
  };
}

function appendSwitch(
  state: WorkingState,
  input: DivePlanInput,
  gas: Gas,
  strategy: BreathingStrategy,
  kind: "gas-switch" | "setpoint-switch",
  durationValue: number,
  gf: Fraction,
): WorkingState {
  if (state.currentGas.id === gas.id && state.currentStrategy.kind === strategy.kind) {
    if (
      state.currentStrategy.kind !== "ccr" ||
      strategy.kind !== "ccr" ||
      Math.abs(state.currentStrategy.setpointBar - strategy.setpointBar) < EPSILON
    ) return state;
  }
  // Low-setpoint mode models a setpoint change on the lower of the two setpoints for the
  // switch time. Legacy inputs keep engine 0.1.0 behavior (the new setpoint).
  const exposure = input.mode === "ccr" &&
    usesLowSetpoint(input) &&
    state.currentStrategy.kind === "ccr" &&
    strategy.kind === "ccr" &&
    state.currentStrategy.setpointBar < strategy.setpointBar
    ? state.currentStrategy
    : strategy;
  return appendExposure(state, input, kind, state.depthM, seconds(durationValue), gf, strategy, gas, exposure);
}

function updateBreathingAtDepth(
  state: WorkingState,
  configuration: AscentConfiguration,
  gf: Fraction,
): WorkingState {
  const { input } = configuration;
  const policy = conventionFor(input.settings);
  if (state.currentStrategy.kind === "ccr" && configuration.ccrAscent !== undefined) {
    // Low-setpoint mode switches only when leaving the switch-down depth (commitAscentLeg).
    if (
      configuration.ccrAscent.mode === "legacy" &&
      state.depthM <= configuration.ccrAscent.activationDepthM + EPSILON
    ) {
      return appendSwitch(
        state,
        input,
        state.currentGas,
        { kind: "open-circuit", gas: state.currentGas },
        "setpoint-switch",
        policy.setpointSwitchDurationSeconds,
        gf,
      );
    }
    return state;
  }
  if (!configuration.availableOcGases) return state;
  const selected = selectBestGas(configuration.availableOcGases, state.depthM, input);
  if (!selected || selected.id === state.currentGas.id) return state;
  return appendSwitch(
    state,
    input,
    selected,
    { kind: "open-circuit", gas: selected },
    "gas-switch",
    policy.gasSwitchDurationSeconds,
    gf,
  );
}

function trialAscent(
  state: WorkingState,
  input: DivePlanInput,
  targetDepthM: Meters,
  gf: Fraction,
  rateMPerMinute: number,
  kind: ProfileSegment["kind"],
): WorkingState {
  return appendExposure(
    state,
    input,
    kind,
    targetDepthM,
    ascentDuration(state.depthM, targetDepthM, rateMPerMinute),
    gf,
  );
}

function isOnHighSetpoint(state: WorkingState, low: Extract<CcrAscent, { mode: "low" }>): boolean {
  return state.currentStrategy.kind === "ccr" &&
    state.currentStrategy.setpointBar > low.lowStrategy.setpointBar + EPSILON;
}

/**
 * Low-setpoint mode: the diver leaves the switch-down depth on the low setpoint. Called
 * immediately before every ascent leg, so a stop held at that depth stays on the high setpoint.
 */
function switchDownBeforeLeaving(
  state: WorkingState,
  configuration: AscentConfiguration,
  gf: Fraction,
): WorkingState {
  const ascent = configuration.ccrAscent;
  if (ascent?.mode !== "low" || ascent.switchDownDepthM <= 0) return state;
  if (!isOnHighSetpoint(state, ascent) || state.depthM > ascent.switchDownDepthM + EPSILON) return state;
  return appendSwitch(
    state,
    configuration.input,
    state.currentGas,
    ascent.lowStrategy,
    "setpoint-switch",
    conventionFor(configuration.input.settings).setpointSwitchDurationSeconds,
    gf,
  );
}

/**
 * Where an open-circuit leg would end on a hypoxic gas, stop the leg at the deepest depth
 * (no shallower than the gas's hypoxic floor) where a preferred gas is switch-eligible.
 * Returns undefined when the leg stays breathable, so non-hypoxic schedules are unchanged.
 */
function hypoxicWaypoint(
  state: WorkingState,
  configuration: AscentConfiguration,
  targetDepthM: Meters,
): Meters | undefined {
  const { input } = configuration;
  const gases = configuration.availableOcGases;
  const gas = state.currentGas;
  if (state.currentStrategy.kind !== "open-circuit" || !gases || !(gas.oxygen > 0)) return undefined;
  if (!isBelowMinimumPPO2(gasPPO2(gas, targetDepthM, input), input.settings.minimumPPO2)) return undefined;
  const surface = input.environmentSettings.surfacePressureBar;
  const perBar = input.environmentSettings.metersPerBar;
  const floor = (input.settings.minimumPPO2 / gas.oxygen - surface) * perBar;
  if (floor >= state.depthM - EPSILON || floor <= targetDepthM + EPSILON) return undefined;
  const preferred = gases.filter((candidate) => candidate.id !== gas.id && compareGasPreference(candidate, gas) < 0);
  const candidates = new Set<number>([floor]);
  for (const other of preferred) {
    if (other.switchDepthM !== undefined) candidates.add(other.switchDepthM);
    if (other.oxygen > 0) {
      candidates.add((maximumPPO2ForGas(other, input, input.settings.maximumDecoPPO2) / other.oxygen - surface) * perBar);
    }
  }
  if (input.mode === "oc" && input.travelGas) candidates.add(ocBottomSwitchDepth(input));
  const switchDepth = [...candidates]
    .filter((depth) => depth >= floor - EPSILON && depth < state.depthM - EPSILON && depth > targetDepthM + EPSILON)
    .sort((left, right) => right - left)
    .find((depth) => preferred.some((other) => isSwitchEligible(other, meters(depth), input)));
  return meters(switchDepth ?? floor);
}

/**
 * Deepest depth between the current depth and the target where an open-circuit gas preferred
 * over the current one becomes switch-eligible. Used only after a stop deadlocks.
 */
function preferredGasWaypoint(
  state: WorkingState,
  configuration: AscentConfiguration,
  targetDepthM: Meters,
): Meters | undefined {
  const { input } = configuration;
  const gases = configuration.availableOcGases;
  if (state.currentStrategy.kind !== "open-circuit" || !gases) return undefined;
  const surface = input.environmentSettings.surfacePressureBar;
  const perBar = input.environmentSettings.metersPerBar;
  const preferred = gases.filter((candidate) =>
    candidate.id !== state.currentGas.id && compareGasPreference(candidate, state.currentGas) < 0);
  const candidates = new Set<number>();
  for (const other of preferred) {
    if (other.switchDepthM !== undefined) candidates.add(other.switchDepthM);
    if (other.oxygen > 0) {
      candidates.add((maximumPPO2ForGas(other, input, input.settings.maximumDecoPPO2) / other.oxygen - surface) * perBar);
    }
  }
  if (input.mode === "oc" && input.travelGas) candidates.add(ocBottomSwitchDepth(input));
  const depth = [...candidates]
    .filter((candidate) => candidate < state.depthM - EPSILON && candidate > targetDepthM + EPSILON)
    .sort((left, right) => right - left)
    .find((candidate) => preferred.some((other) => isSwitchEligible(other, meters(candidate), input)));
  return depth === undefined ? undefined : meters(depth);
}

/**
 * Commit one ascent leg. It is split, without a stop, at the low-setpoint switch-down
 * depth and at any hypoxic-floor waypoint, and breathing is updated at each split.
 * With neither split this is exactly one trialAscent, so legacy schedules are unchanged.
 */
function commitAscentLeg(
  state: WorkingState,
  configuration: AscentConfiguration,
  targetDepthM: Meters,
  gf: Fraction,
  rateMPerMinute: number,
  kind: ProfileSegment["kind"],
): WorkingState {
  const { input } = configuration;
  let current = state;
  for (let splits = 0; current.depthM > targetDepthM + EPSILON && splits < 8; splits += 1) {
    current = switchDownBeforeLeaving(current, configuration, gf);
    let next = targetDepthM;
    const ascent = configuration.ccrAscent;
    if (
      ascent?.mode === "low" &&
      isOnHighSetpoint(current, ascent) &&
      ascent.switchDownDepthM > next + EPSILON &&
      ascent.switchDownDepthM < current.depthM - EPSILON
    ) {
      next = ascent.switchDownDepthM;
    }
    next = hypoxicWaypoint(current, configuration, next) ?? next;
    current = trialAscent(current, input, next, gf, rateMPerMinute, kind);
    if (next > targetDepthM + EPSILON) current = updateBreathingAtDepth(current, configuration, gf);
  }
  return current.depthM > targetDepthM + EPSILON
    ? trialAscent(current, input, targetDepthM, gf, rateMPerMinute, kind)
    : current;
}

function hypoxicSegmentDiagnostics(segments: readonly ProfileSegment[], input: DivePlanInput): readonly Diagnostic[] {
  const gases = new Map(registeredGases(input).map((gas) => [gas.id, gas]));
  const flagged = new Set<string>();
  const diagnostics: Diagnostic[] = [];
  for (const segment of segments) {
    if (segment.setpointBar !== undefined) continue;
    const gas = gases.get(segment.gasId);
    if (!gas || flagged.has(gas.id)) continue;
    for (const [depthM, runtimeSeconds] of [
      [segment.startDepthM, segment.startRuntimeSeconds],
      [segment.endDepthM, segment.startRuntimeSeconds + segment.durationSeconds],
    ] as const) {
      const ppo2 = gasPPO2(gas, depthM, input);
      if (!isBelowMinimumPPO2(ppo2, input.settings.minimumPPO2)) continue;
      flagged.add(gas.id);
      diagnostics.push(diagnostic(
        "OC_GAS_HYPOXIC",
        "error",
        `${gas.name} is hypoxic on open circuit at ${depthM.toFixed(1)} m (PPO₂ ${ppo2.toFixed(2)} bar). The schedule cannot be used; add or adjust a gas for that depth.`,
        {
          runtimeSeconds: seconds(runtimeSeconds),
          depthM,
          gasId: gas.id,
          actual: ppo2,
          limit: input.settings.minimumPPO2,
        },
      ));
      break;
    }
  }
  return diagnostics;
}

function canOccupyDepth(state: WorkingState, targetDepthM: Meters, gf: Fraction, input: DivePlanInput): boolean {
  const ceiling = calculateCeiling(state.tissues, gf, input.environmentSettings);
  const targetPressure = depthToAmbientPressure(
    targetDepthM,
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
  return ceiling.pressureBar <= targetPressure + EPSILON;
}

function aggregateStops(segments: readonly ProfileSegment[]): readonly DecoStop[] {
  const stops: DecoStop[] = [];
  for (const segment of segments) {
    if (segment.kind !== "stop") continue;
    const previous = stops.at(-1);
    if (previous && previous.depthM === segment.endDepthM && previous.gasId === segment.gasId) {
      stops[stops.length - 1] = {
        ...previous,
        durationSeconds: seconds(previous.durationSeconds + segment.durationSeconds),
      };
    } else {
      stops.push({
        depthM: segment.endDepthM,
        durationSeconds: segment.durationSeconds,
        gasId: segment.gasId,
        gasName: segment.gasName,
      });
    }
  }
  return stops;
}

function scheduleAscent(initial: WorkingState, configuration: AscentConfiguration): AscentResult {
  const first = scheduleAscentOnce(initial, configuration);
  const stuck = first.diagnostics.find((item) => item.code === "DECOMPRESSION_LIMIT_EXCEEDED");
  if (
    configuration.gasSwitchWaypointMaxDepthM !== undefined ||
    !configuration.availableOcGases ||
    stuck?.depthM === undefined
  ) return first;
  // A stop that never clears on its gas: retry, allowing a move from that stop (or a shallower
  // one) to where a richer gas becomes eligible. Schedules that already clear are never
  // recomputed, and stops deeper than the stuck stop are unchanged.
  const retry = scheduleAscentOnce(initial, { ...configuration, gasSwitchWaypointMaxDepthM: stuck.depthM });
  if (retry.diagnostics.some((item) => item.code === "DECOMPRESSION_LIMIT_EXCEEDED")) return first;
  return {
    ...retry,
    diagnostics: [
      ...retry.diagnostics,
      diagnostic(
        "OC_STOP_MOVED_FOR_GAS_SWITCH",
        "warning",
        "A stop could not clear on its gas, so the plan moves shallower to switch to a richer gas and finishes decompression there, which can be shallower than the configured last stop. Add a gas usable at the last stop to avoid this.",
      ),
    ],
  };
}

function scheduleAscentOnce(initial: WorkingState, configuration: AscentConfiguration): AscentResult {
  const { input } = configuration;
  const startRuntime = initial.runtimeSeconds;
  const startingSegmentCount = initial.segments.length;
  const diagnostics: Diagnostic[] = [];
  let state = initial;
  let iterations = 0;
  if (state.depthM <= 0) {
    return { state, stops: [], diagnostics, ttsSeconds: seconds(0) };
  }

  // NDL is evaluated with GF High at the surface. Simulate the actual ascent
  // path (including CCR deactivation or a required travel-gas switch) and
  // discard it completely if any intermediate point breaches the ceiling.
  let ndlState = initial;
  let ndlIterations = 0;
  let ndlPossible = true;
  while (ndlState.depthM > 0 && ndlIterations < MAX_ASCENT_ITERATIONS) {
    ndlIterations += 1;
    ndlState = updateBreathingAtDepth(ndlState, configuration, input.settings.gfHigh);
    const target = nextStopDepth(ndlState.depthM, input);
    const trial = commitAscentLeg(
      ndlState,
      configuration,
      target,
      input.settings.gfHigh,
      effectiveAscentRate(input.settings, false),
      configuration.segmentKind ?? "ascent",
    );
    if (!canOccupyDepth(trial, target, input.settings.gfHigh, input)) {
      ndlPossible = false;
      break;
    }
    ndlState = trial;
  }
  if (ndlPossible && ndlState.depthM === 0) {
    return {
      state: ndlState,
      stops: [],
      diagnostics,
      ttsSeconds: seconds(ndlState.runtimeSeconds - startRuntime),
    };
  }

  // Find the first stop from the current GF-low ceiling, rounded to the stop
  // grid. Recalculate only after committing the ascent to that ceiling. This
  // avoids taking credit for off-gassing during an ascent that the current
  // tissue state does not yet permit.
  while (state.depthM > 0 && iterations < MAX_ASCENT_ITERATIONS) {
    iterations += 1;
    state = updateBreathingAtDepth(state, configuration, input.settings.gfLow);
    const ceiling = calculateCeiling(
      state.tissues,
      input.settings.gfLow,
      input.environmentSettings,
    );
    let target = meters(Math.max(
      input.settings.lastStopDepthM,
      roundDepthDeeper(ceiling.depthM, input.settings.stopIncrementM),
    ));
    const boundaries = [
      ...(configuration.availableOcGases ?? [])
        .map((gas) => gas.switchDepthM)
        .filter((depth): depth is Meters => depth !== undefined),
      ...(configuration.ccrAscent?.mode === "legacy"
        ? [configuration.ccrAscent.activationDepthM]
        : []),
    ].filter((depth) => depth < state.depthM - EPSILON && depth > target + EPSILON);
    if (boundaries.length > 0) target = meters(Math.max(...boundaries));
    if (target < state.depthM - EPSILON) {
      let committed = commitAscentLeg(
        state,
        configuration,
        target,
        input.settings.gfLow,
        effectiveAscentRate(input.settings, false),
        configuration.segmentKind ?? "ascent",
      );
      // Tissues can still load inert gas during the leg: after a switch from a nitrogen-loaded
      // loop to a helium-heavy gas the fast compartments take up helium faster than they
      // release nitrogen, and a mid-leg switch down to the low setpoint loads inert gas. So
      // re-check the arrival ceiling and retry from the pre-leg state one grid step deeper.
      while (
        !canOccupyDepth(committed, target, input.settings.gfLow, input) &&
        target < state.depthM - EPSILON
      ) {
        target = meters(Math.min(
          state.depthM,
          roundDepthDeeper(meters(target + 1e-6), input.settings.stopIncrementM),
        ));
        committed = target < state.depthM - EPSILON
          ? commitAscentLeg(
              state,
              configuration,
              target,
              input.settings.gfLow,
              effectiveAscentRate(input.settings, false),
              configuration.segmentKind ?? "ascent",
            )
          : state;
      }
      if (committed !== state) {
        state = committed;
        continue;
      }
    }
    state = { ...state, firstStopDepthM: state.depthM };
    break;
  }

  if (state.firstStopDepthM === undefined) {
    diagnostics.push(diagnostic(
      "ASCENT_ITERATION_LIMIT",
      "error",
      "The ascent scheduler exceeded its deterministic iteration limit.",
    ));
    return { state, stops: [], diagnostics, ttsSeconds: seconds(state.runtimeSeconds - startRuntime) };
  }
  const firstStopDepthM = state.firstStopDepthM;

  let heldSeconds = 0;
  let stopArrivalDepth: Meters | undefined;
  while (state.depthM > 0 && iterations < MAX_ASCENT_ITERATIONS) {
    iterations += 1;
    const currentGf = gradientFactorAtDepth(
      state.depthM,
      firstStopDepthM,
      input.settings.gfLow,
      input.settings.gfHigh,
    );
    state = updateBreathingAtDepth(state, configuration, currentGf);
    if (stopArrivalDepth !== state.depthM) {
      state = appendExposure(
        state,
        input,
        "stop",
        state.depthM,
        input.settings.stopTimeQuantumSeconds,
        currentGf,
      );
      heldSeconds += input.settings.stopTimeQuantumSeconds;
      stopArrivalDepth = state.depthM;
    }
    const target = nextStopDepth(state.depthM, input);
    const targetGf = gradientFactorAtDepth(
      target,
      firstStopDepthM,
      input.settings.gfLow,
      input.settings.gfHigh,
    );
    // A stop clears only when the current tissue state permits occupying the
    // next depth. The subsequent ascent is then committed with Schreiner.
    // This intentionally avoids crediting off-gassing from a rejected trial.
    if (canOccupyDepth(state, target, targetGf, input)) {
      const committed = commitAscentLeg(
        state,
        configuration,
        target,
        targetGf,
        effectiveAscentRate(input.settings, true),
        configuration.segmentKind ?? "ascent",
      );
      // For the same reasons the leg can load inert gas, so it is taken only if the arrival
      // still clears; otherwise hold the stop (on the high setpoint in low-setpoint mode).
      if (canOccupyDepth(committed, target, targetGf, input)) {
        state = committed;
        continue;
      }
    } else if (
      configuration.gasSwitchWaypointMaxDepthM !== undefined &&
      state.depthM <= configuration.gasSwitchWaypointMaxDepthM + EPSILON
    ) {
      const waypoint = preferredGasWaypoint(state, configuration, target);
      if (waypoint !== undefined) {
        const waypointGf = gradientFactorAtDepth(waypoint, firstStopDepthM, input.settings.gfLow, input.settings.gfHigh);
        if (canOccupyDepth(state, waypoint, waypointGf, input)) {
          const committed = commitAscentLeg(
            state,
            configuration,
            waypoint,
            waypointGf,
            effectiveAscentRate(input.settings, true),
            configuration.segmentKind ?? "ascent",
          );
          if (canOccupyDepth(committed, waypoint, waypointGf, input)) {
            state = committed;
            continue;
          }
        }
      }
    }
    state = appendExposure(
      state,
      input,
      "stop",
      state.depthM,
      input.settings.stopTimeQuantumSeconds,
      currentGf,
    );
    heldSeconds += input.settings.stopTimeQuantumSeconds;
    if (heldSeconds > MAX_DECOMPRESSION_SECONDS) {
      diagnostics.push(diagnostic(
        "DECOMPRESSION_LIMIT_EXCEEDED",
        "error",
        "The calculated decompression exceeded 48 hours; review the profile and gases.",
        { runtimeSeconds: state.runtimeSeconds, depthM: state.depthM },
      ));
      break;
    }
  }

  if (iterations >= MAX_ASCENT_ITERATIONS) {
    diagnostics.push(diagnostic(
      "ASCENT_ITERATION_LIMIT",
      "error",
      "The ascent scheduler exceeded its deterministic iteration limit.",
      { runtimeSeconds: state.runtimeSeconds, depthM: state.depthM },
    ));
  }
  const ascentSegments = state.segments.slice(startingSegmentCount);
  return {
    state,
    stops: aggregateStops(ascentSegments),
    diagnostics,
    ttsSeconds: seconds(state.runtimeSeconds - startRuntime),
  };
}

function initialWorkingState(
  input: DivePlanInput,
  gas: Gas,
  strategy: BreathingStrategy = { kind: "open-circuit", gas },
): WorkingState {
  return {
    tissues: initializeTissues(input.environmentSettings),
    runtimeSeconds: seconds(0),
    depthM: meters(0),
    segments: [],
    currentStrategy: strategy,
    currentGas: gas,
  };
}

function ocDescent(input: OcDiveInput): WorkingState {
  const usesTravel = input.travelGas !== undefined;
  const initialGas = input.travelGas ?? input.bottomGas;
  let state = initialWorkingState(input, initialGas);
  if (!usesTravel) {
    return appendExposure(
      state,
      input,
      "descent",
      input.depthM,
      ascentDuration(meters(0), input.depthM, input.settings.descentRateMPerMinute),
      input.settings.gfLow,
    );
  }
  const switchDepth = meters(ocBottomSwitchDepth(input));
  state = appendExposure(
    state,
    input,
    "descent",
    switchDepth,
    ascentDuration(meters(0), switchDepth, input.settings.descentRateMPerMinute),
    input.settings.gfLow,
  );
  state = appendSwitch(
    state,
    input,
    input.bottomGas,
    { kind: "open-circuit", gas: input.bottomGas },
    "gas-switch",
    conventionFor(input.settings).gasSwitchDurationSeconds,
    input.settings.gfLow,
  );
  return appendExposure(
    state,
    input,
    "descent",
    input.depthM,
    ascentDuration(switchDepth, input.depthM, input.settings.descentRateMPerMinute),
    input.settings.gfLow,
  );
}

function ccrDescent(input: CcrDiveInput): { state: WorkingState; arrivalState: TissueState } {
  if (usesLowSetpoint(input)) return lowSetpointDescent(input);
  let state = initialWorkingState(input, input.diluent);
  const activation = meters(Math.min(input.depthM, input.setpointActivationDepthM));
  if (activation > 0) {
    state = appendExposure(
      state,
      input,
      "descent",
      activation,
      ascentDuration(meters(0), activation, input.settings.descentRateMPerMinute),
      input.settings.gfLow,
    );
  }
  const ccrStrategy: BreathingStrategy = {
    kind: "ccr",
    diluent: input.diluent,
    setpointBar: input.setpointBar,
  };
  state = appendSwitch(
    state,
    input,
    input.diluent,
    ccrStrategy,
    "setpoint-switch",
    conventionFor(input.settings).setpointSwitchDurationSeconds,
    input.settings.gfLow,
  );
  if (activation < input.depthM) {
    state = appendExposure(
      state,
      input,
      "descent",
      input.depthM,
      ascentDuration(activation, input.depthM, input.settings.descentRateMPerMinute),
      input.settings.gfLow,
    );
  }
  return { state, arrivalState: state.tissues };
}

/** Loop closed from the surface on the low setpoint, then switch up at the activation depth. */
function lowSetpointDescent(input: CcrDiveInput & { readonly lowSetpointBar: BarAbsolute }): { state: WorkingState; arrivalState: TissueState } {
  let state = initialWorkingState(input, input.diluent, ccrStrategy(input, input.lowSetpointBar));
  const activation = meters(Math.min(input.depthM, input.setpointActivationDepthM));
  if (activation > 0) {
    state = appendExposure(
      state,
      input,
      "descent",
      activation,
      ascentDuration(meters(0), activation, input.settings.descentRateMPerMinute),
      input.settings.gfLow,
    );
  }
  state = appendSwitch(
    state,
    input,
    input.diluent,
    ccrStrategy(input, input.setpointBar),
    "setpoint-switch",
    conventionFor(input.settings).setpointSwitchDurationSeconds,
    input.settings.gfLow,
  );
  if (activation < input.depthM) {
    state = appendExposure(
      state,
      input,
      "descent",
      input.depthM,
      ascentDuration(activation, input.depthM, input.settings.descentRateMPerMinute),
      input.settings.gfLow,
    );
  }
  return { state, arrivalState: state.tissues };
}

function diluentBailoutLedgerOption(input: DivePlanInput) {
  return input.mode === "ccr" && input.diluentBailout === true
    ? { diluentBailout: { gasId: input.diluent.id, preBailoutUseL: input.diluentPreBailoutUseL ?? 0 } }
    : {};
}

function planMetadata(input: DivePlanInput) {
  const policy = conventionFor(input.settings);
  return {
    engineVersion: ENGINE_VERSION,
    modelId: ZHL16C_MODEL_ID,
    coefficientSet: ZHL16C_MODEL_VERSION,
    coefficientHash: ZHL16C_COEFFICIENT_HASH,
    conventionId: policy.id,
    conventionVersion: policy.version,
    validationStatus: policy.validationStatus,
    assumptionsHash: stableHash({ settings: input.settings, environment: input.environmentSettings }),
  } as const;
}

function buildPlan(
  input: DivePlanInput,
  ascent: AscentResult,
  warnings: readonly Diagnostic[],
  bottomEndRuntime: Seconds,
  idSuffix = "base",
  ledgerOptions: {
    readonly bailout?: boolean;
    readonly startRuntimeSeconds?: Seconds;
    readonly diluentBailout?: { readonly gasId: string; readonly preBailoutUseL: number };
  } = {},
): DivePlan {
  const decompressionSeconds = seconds(
    ascent.stops.reduce((sum, stop) => sum + stop.durationSeconds, 0),
  );
  const ledger = calculateGasLedger(ascent.state.segments, input, {
    ...ledgerOptions,
    bottomEndRuntimeSeconds: bottomEndRuntime,
  });
  const diagnostics = [
    ...warnings,
    ...ascent.diagnostics,
    ...ledger.diagnostics,
    ...hypoxicSegmentDiagnostics(ascent.state.segments, input),
  ];
  return {
    id: `plan-${stableHash({ input, idSuffix })}`,
    mode: input.mode,
    environment: input.environment,
    metadata: planMetadata(input),
    segments: ascent.state.segments,
    stops: ascent.stops,
    finalTissues: ascent.state.tissues,
    summary: {
      runtimeSeconds: ascent.state.runtimeSeconds,
      ttsSeconds: seconds(ascent.state.runtimeSeconds - bottomEndRuntime),
      decompressionSeconds,
      maximumDepthM: input.depthM,
      ...(ascent.state.firstStopDepthM !== undefined
        ? { firstStopDepthM: ascent.state.firstStopDepthM }
        : {}),
    },
    gasLedger: ledger.entries,
    diagnostics,
    safetyStatus: diagnostics.some((item) => item.severity === "error")
      ? "unsafe"
      : "calculated",
  };
}

function calculateOc(input: OcDiveInput, warnings: readonly Diagnostic[]): DivePlan {
  let state = ocDescent(input);
  state = appendExposure(
    state,
    input,
    "bottom",
    input.depthM,
    input.bottomTimeSeconds,
    input.settings.gfLow,
  );
  const bottomEndRuntime = state.runtimeSeconds;
  const gases = [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases];
  const ascent = scheduleAscent(state, { input, availableOcGases: gases });
  return buildPlan(input, ascent, warnings, bottomEndRuntime);
}

function calculateCcr(input: CcrDiveInput, warnings: readonly Diagnostic[]): DivePlan {
  const descent = ccrDescent(input);
  const normalState = appendExposure(
    descent.state,
    input,
    "bottom",
    input.depthM,
    input.bottomTimeSeconds,
    input.settings.gfLow,
  );
  const bottomEndRuntime = normalState.runtimeSeconds;
  const normalAscent = scheduleAscent(normalState, {
    input,
    ccrAscent: ccrAscentConfiguration(input),
  });
  const normalPlan = buildPlan(input, normalAscent, warnings, bottomEndRuntime);

  const triggerSeconds = input.bailoutTriggerSecondsAtDepth ?? input.bottomTimeSeconds;
  let triggerState: WorkingState = {
    ...descent.state,
    tissues: descent.arrivalState,
  };
  triggerState = appendExposure(
    triggerState,
    input,
    "bottom",
    input.depthM,
    triggerSeconds,
    input.settings.gfLow,
  );
  const bailoutTriggerRuntime = triggerState.runtimeSeconds;
  const bailoutGases = effectiveBailoutGases(input);
  const bailoutGas = selectBestGas(bailoutGases, input.depthM, input);
  if (!bailoutGas) {
    const noGas = diagnostic(
      "NO_BREATHABLE_BAILOUT_GAS",
      "error",
      "No bailout gas is breathable at the selected trigger depth.",
      { depthM: input.depthM },
    );
    return { ...normalPlan, diagnostics: [...normalPlan.diagnostics, noGas] };
  }
  triggerState = appendSwitch(
    triggerState,
    input,
    bailoutGas,
    { kind: "open-circuit", gas: bailoutGas },
    "gas-switch",
    conventionFor(input.settings).gasSwitchDurationSeconds,
    input.settings.gfLow,
  );
  const bailoutAscent = scheduleAscent(triggerState, {
    input,
    availableOcGases: bailoutGases,
    segmentKind: "bailout",
  });
  const triggerPPO2 = gasPPO2(bailoutGas, input.depthM, input);
  const triggerWarnings: Diagnostic[] = triggerPPO2 > input.settings.maximumBottomPPO2 + EPSILON
    ? [diagnostic(
        "CCR_BAILOUT_TRIGGER_PPO2_HIGH",
        "warning",
        `${bailoutGas.name} reaches PPO₂ ${triggerPPO2.toFixed(2)} bar at the trigger depth, above the ${input.settings.maximumBottomPPO2.toFixed(2)} bar bottom limit, because it is the richest bailout gas eligible there.`,
        { gasId: bailoutGas.id, depthM: input.depthM, actual: triggerPPO2, limit: input.settings.maximumBottomPPO2 },
      )]
    : [];
  const bailoutPlan = buildPlan(
    { ...input, mode: "ccr" },
    bailoutAscent,
    [...warnings, ...triggerWarnings],
    bailoutTriggerRuntime,
    "bailout",
    { bailout: true, startRuntimeSeconds: bailoutTriggerRuntime, ...diluentBailoutLedgerOption(input) },
  );
  // A bailout plan that cannot be used makes the whole CCR plan unusable.
  const unusableBailout = bailoutPlan.diagnostics
    .filter((item) =>
      item.code === "OC_GAS_HYPOXIC" ||
      item.code === "DECOMPRESSION_LIMIT_EXCEEDED" ||
      item.code === "ASCENT_ITERATION_LIMIT")
    .map((item) => item.code === "OC_GAS_HYPOXIC" ? item : { ...item, message: `Bailout plan: ${item.message}` });
  return {
    ...normalPlan,
    diagnostics: [...normalPlan.diagnostics, ...unusableBailout],
    safetyStatus: unusableBailout.length > 0 ? "unsafe" : normalPlan.safetyStatus,
    bailoutPlan,
  };
}

export function calculateDivePlan(input: DivePlanInput): CalculationResult<DivePlan> {
  const validation = validateDiveInput(input);
  if (!validation.ok) return validation;
  const plan = input.mode === "oc"
    ? calculateOc(input, validation.warnings)
    : calculateCcr(input, validation.warnings);
  return resultForPlan(plan);
}

function resultForPlan(plan: DivePlan): CalculationResult<DivePlan> {
  const errors = plan.diagnostics.filter((item) => item.severity === "error");
  const fatalCodes = new Set([
    "ASCENT_ITERATION_LIMIT",
    "DECOMPRESSION_LIMIT_EXCEEDED",
    "NO_BREATHABLE_BAILOUT_GAS",
    "EXPOSURE_CEILING_VIOLATION",
    "OC_GAS_HYPOXIC",
  ]);
  const fatal = errors.filter((item) => fatalCodes.has(item.code));
  const warnings = plan.diagnostics.filter((item) => item.severity !== "error");
  return fatal.length > 0
    ? { ok: false, errors: fatal, warnings }
    : {
        ok: true,
        value: plan,
        warnings,
        ...(errors.length > 0 ? { errors } : {}),
      };
}

/**
 * Internal multi-level exposure entry point used by cave planning. The public
 * open-water UI remains square-profile in the initial release, while every
 * event is still evaluated with the same production tissue and ascent engine.
 */
export function calculateEventDivePlan(
  input: DivePlanInput,
  events: readonly ExposureEvent[],
  options: {
    readonly ascentGases?: readonly Gas[];
    readonly idSuffix?: string;
    readonly bailout?: boolean;
  } = {},
): CalculationResult<DivePlan> {
  const validation = validateDiveInput(input);
  if (!validation.ok) return validation;
  const eventErrors: Diagnostic[] = [];
  const normalizedGases = registeredGases(input);
  if (events.length === 0) {
    eventErrors.push(diagnostic("EXPOSURE_EVENTS_REQUIRED", "error", "At least one exposure event is required."));
  }
  events.forEach((event, index) => {
    if (!Number.isFinite(event.durationSeconds) || event.durationSeconds <= 0) {
      eventErrors.push(diagnostic(
        "EXPOSURE_DURATION_INVALID",
        "error",
        "Every exposure event must have a positive duration.",
        { field: `events.${index}.durationSeconds` },
      ));
    }
    for (const [field, value] of [
      ["startDepthM", event.startDepthM],
      ["endDepthM", event.endDepthM],
    ] as const) {
      if (!Number.isFinite(value) || value < 0 || value > input.depthM) {
        eventErrors.push(diagnostic(
          "EXPOSURE_DEPTH_INVALID",
          "error",
          "Exposure depths must be finite, nonnegative, and no deeper than the plan maximum.",
          { field: `events.${index}.${field}` },
        ));
      }
    }
    eventErrors.push(...validateGas(event.gas, `events.${index}.gas`));
    const strategyGas = event.strategy.kind === "open-circuit"
      ? event.strategy.gas
      : event.strategy.diluent;
    if (!sameGas(event.gas, strategyGas)) {
      eventErrors.push(diagnostic(
        "EXPOSURE_STRATEGY_GAS_MISMATCH",
        "error",
        "The displayed event gas must match the gas used for tissue loading.",
        { field: `events.${index}.strategy` },
      ));
    }
    if (!normalizedGases.some((gas) => sameGas(gas, event.gas))) {
      eventErrors.push(diagnostic(
        "EXPOSURE_GAS_NOT_REGISTERED",
        "error",
        "Every exposure gas must be present in the normalized plan input.",
        { field: `events.${index}.gas` },
      ));
    }
    if (event.strategy.kind === "ccr") {
      if (input.mode !== "ccr") {
        eventErrors.push(diagnostic(
          "EXPOSURE_CCR_MODE_MISMATCH",
          "error",
          "CCR exposure events require a CCR plan input.",
          { field: `events.${index}.strategy` },
        ));
      } else if (!sameGas(event.strategy.diluent, input.diluent)) {
        eventErrors.push(diagnostic(
          "EXPOSURE_DILUENT_NOT_REGISTERED",
          "error",
          "CCR exposure events must use the normalized plan diluent.",
          { field: `events.${index}.strategy.diluent` },
        ));
      }
      if (
        !Number.isFinite(event.strategy.setpointBar) ||
        event.strategy.setpointBar < 0.5 ||
        event.strategy.setpointBar > 1.6
      ) {
        eventErrors.push(diagnostic(
          "EXPOSURE_SETPOINT_INVALID",
          "error",
          "CCR event setpoint must be between 0.5 and 1.6 bar.",
          { field: `events.${index}.strategy.setpointBar` },
        ));
      }
      if (
        Number.isFinite(event.strategy.setpointBar) &&
        event.strategy.setpointBar > input.settings.maximumBottomPPO2 + EPSILON
      ) {
        eventErrors.push(diagnostic(
          "EXPOSURE_SETPOINT_LIMIT_EXCEEDED",
          "error",
          "CCR event setpoint cannot exceed the configured maximum bottom PPO₂.",
          {
            field: `events.${index}.strategy.setpointBar`,
            actual: event.strategy.setpointBar,
            limit: input.settings.maximumBottomPPO2,
          },
        ));
      }
      const shallowDepth = meters(Math.min(event.startDepthM, event.endDepthM));
      const shallowAmbient = depthToAmbientPressure(
        shallowDepth,
        input.environmentSettings.surfacePressureBar,
        input.environmentSettings.metersPerBar,
      );
      if (event.strategy.setpointBar > shallowAmbient - input.environmentSettings.waterVaporPressureBar) {
        eventErrors.push(diagnostic(
          "EXPOSURE_SETPOINT_NOT_ACHIEVABLE",
          "error",
          "CCR event setpoint is not achievable at the shallow end of the event.",
          { field: `events.${index}.strategy.setpointBar` },
        ));
      }
    } else {
      const endpointPPO2 = [event.startDepthM, event.endDepthM]
        .map((depth) => gasPPO2(event.gas, depth, input));
      const planMaximumPPO2 = event.kind === "exit" || event.kind === "bailout"
        ? input.settings.maximumDecoPPO2
        : input.settings.maximumBottomPPO2;
      const maximumPPO2 = maximumPPO2ForGas(event.gas, input, planMaximumPPO2);
      if (endpointPPO2.some((ppo2) =>
        ppo2 < input.settings.minimumPPO2 || ppo2 > maximumPPO2
      )) {
        eventErrors.push(diagnostic(
          "EXPOSURE_GAS_UNBREATHABLE",
          "error",
          "Open-circuit event gas must remain within PPO₂ limits for the entire event.",
          { field: `events.${index}.gas` },
        ));
      }
    }
    if (index === 0 && Math.abs(event.startDepthM) > EPSILON) {
      eventErrors.push(diagnostic(
        "EXPOSURE_START_NOT_SURFACE",
        "error",
        "The first exposure event must start at the surface.",
        { field: "events.0.startDepthM" },
      ));
    }
    const previous = events[index - 1];
    if (previous && Math.abs(previous.endDepthM - event.startDepthM) > EPSILON) {
      eventErrors.push(diagnostic(
        "EXPOSURE_DISCONTINUITY",
        "error",
        "Exposure events must form a continuous depth timeline.",
        { field: `events.${index}.startDepthM` },
      ));
    }
  });
  (options.ascentGases ?? []).forEach((gas, index) => {
    eventErrors.push(...validateGas(gas, `options.ascentGases.${index}`));
    if (!normalizedGases.some((registered) => sameGas(registered, gas))) {
      eventErrors.push(diagnostic(
        "ASCENT_GAS_NOT_REGISTERED",
        "error",
        "Event-plan ascent gases must be a subset of normalized plan gases.",
        { field: `options.ascentGases.${index}` },
      ));
    }
  });
  if (eventErrors.length > 0) {
    return { ok: false, errors: eventErrors, warnings: validation.warnings };
  }
  const first = events[0];
  let state = initialWorkingState(input, first.gas);
  const exposureErrors: Diagnostic[] = [];
  let bailoutStartRuntime: Seconds | undefined;
  for (const [eventIndex, event] of events.entries()) {
    if (options.bailout && event.kind === "bailout" && bailoutStartRuntime === undefined) {
      bailoutStartRuntime = state.runtimeSeconds;
    }
    if (
      state.currentGas.id !== event.gas.id ||
      state.currentStrategy.kind !== event.strategy.kind ||
      (
        state.currentStrategy.kind === "ccr" &&
        event.strategy.kind === "ccr" &&
        state.currentStrategy.setpointBar !== event.strategy.setpointBar
      )
    ) {
      state = appendSwitch(
        state,
        input,
        event.gas,
        event.strategy,
        event.strategy.kind === "ccr" ? "setpoint-switch" : "gas-switch",
        event.strategy.kind === "ccr"
          ? conventionFor(input.settings).setpointSwitchDurationSeconds
          : conventionFor(input.settings).gasSwitchDurationSeconds,
        input.settings.gfLow,
      );
    }
    state = appendExposure(
      state,
      input,
      event.kind,
      event.endDepthM,
      event.durationSeconds,
      input.settings.gfLow,
      event.strategy,
      event.gas,
    );
    const committed = state.segments.at(-1);
    if (
      event.endDepthM < event.startDepthM - EPSILON &&
      committed &&
      committed.ceilingDepthM > event.endDepthM + EPSILON
    ) {
      exposureErrors.push(diagnostic(
        "EXPOSURE_CEILING_VIOLATION",
        "error",
        "An explicit ascent or exit leg crosses above the calculated decompression ceiling.",
        {
          field: `events.${eventIndex}.endDepthM`,
          runtimeSeconds: state.runtimeSeconds,
          depthM: event.endDepthM,
          actual: event.endDepthM,
          limit: committed.ceilingDepthM,
        },
      ));
    }
  }
  if (exposureErrors.length > 0) {
    return { ok: false, errors: exposureErrors, warnings: validation.warnings };
  }
  const exposureEndRuntime = state.runtimeSeconds;
  const configuration: AscentConfiguration = state.currentStrategy.kind === "ccr"
    ? {
        input,
        ccrAscent: input.mode === "ccr"
          ? ccrAscentConfiguration(input, state.currentStrategy.setpointBar)
          : { mode: "legacy", activationDepthM: meters(0) },
      }
    : { input, availableOcGases: options.ascentGases ?? [state.currentGas], segmentKind: options.bailout ? "bailout" : "ascent" };
  const ascent = scheduleAscent(state, configuration);
  const plan = buildPlan(
    input,
    ascent,
    validation.warnings,
    exposureEndRuntime,
    options.idSuffix ?? "events",
    options.bailout
      ? {
          bailout: true,
          startRuntimeSeconds: bailoutStartRuntime ?? exposureEndRuntime,
          ...diluentBailoutLedgerOption(input),
        }
      : {},
  );
  return resultForPlan(plan);
}

export function inspiredAmbientPressureAtDepth(input: DivePlanInput, depthM: Meters): BarAbsolute {
  return depthToAmbientPressure(
    depthM,
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
}

export function ceilingDepthAt(
  tissues: TissueState,
  gf: Fraction,
  input: DivePlanInput,
): Meters {
  const pressure = calculateCeiling(tissues, gf, input.environmentSettings).pressureBar;
  return ambientPressureToDepth(
    barAbsolute(pressure),
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
}
