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
  ocBottomSwitchDepth,
  resolveAssignedCylinder,
  sameGas,
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

export const ENGINE_VERSION = "barefoot-dive-engine-0.1.0";
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

type AscentConfiguration = {
  readonly input: DivePlanInput;
  readonly availableOcGases?: readonly Gas[];
  readonly ccrActivationDepthM?: Meters;
  readonly segmentKind?: "ascent" | "bailout" | "exit";
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
    strategy,
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

function gasPPO2(gas: Gas, depthM: Meters, input: DivePlanInput): number {
  return gas.oxygen * depthToAmbientPressure(
    depthM,
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
}

function maximumPPO2ForGas(
  gas: Gas,
  input: DivePlanInput,
  planLimit: BarAbsolute,
): number {
  return Math.min(
    planLimit,
    resolveAssignedCylinder(gas, input.cylinders)?.maximumPPO2 ?? planLimit,
  );
}

function isGasBreathable(gas: Gas, depthM: Meters, input: DivePlanInput): boolean {
  const ppO2 = gasPPO2(gas, depthM, input);
  const maximumPPO2 = maximumPPO2ForGas(
    gas,
    input,
    input.settings.maximumDecoPPO2,
  );
  return ppO2 + EPSILON >= input.settings.minimumPPO2 &&
    ppO2 <= maximumPPO2 + EPSILON;
}

function isSwitchEligible(gas: Gas, depthM: Meters, input: DivePlanInput): boolean {
  if (!isGasBreathable(gas, depthM, input)) return false;
  if (input.mode === "oc" && input.travelGas?.id === gas.id) {
    return depthM <= ocBottomSwitchDepth(input) + EPSILON;
  }
  return gas.switchDepthM === undefined || depthM <= gas.switchDepthM + EPSILON;
}

function selectBestGas(gases: readonly Gas[], depthM: Meters, input: DivePlanInput): Gas | undefined {
  return gases
    .filter((gas) => isSwitchEligible(gas, depthM, input))
    .slice()
    .sort((left, right) =>
      right.oxygen - left.oxygen || left.helium - right.helium || left.id.localeCompare(right.id),
    )[0];
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
  return appendExposure(state, input, kind, state.depthM, seconds(durationValue), gf, strategy, gas);
}

function updateBreathingAtDepth(
  state: WorkingState,
  configuration: AscentConfiguration,
  gf: Fraction,
): WorkingState {
  const { input } = configuration;
  const policy = conventionFor(input.settings);
  if (state.currentStrategy.kind === "ccr" && configuration.ccrActivationDepthM !== undefined) {
    if (state.depthM <= configuration.ccrActivationDepthM + EPSILON) {
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
    const trial = trialAscent(
      ndlState,
      input,
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
      ...(configuration.ccrActivationDepthM !== undefined
        ? [configuration.ccrActivationDepthM]
        : []),
    ].filter((depth) => depth < state.depthM - EPSILON && depth > target + EPSILON);
    if (boundaries.length > 0) target = meters(Math.max(...boundaries));
    if (target < state.depthM - EPSILON) {
      state = trialAscent(
        state,
        input,
        target,
        input.settings.gfLow,
        effectiveAscentRate(input.settings, false),
        configuration.segmentKind ?? "ascent",
      );
      continue;
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
      state = trialAscent(
        state,
        input,
        target,
        targetGf,
        effectiveAscentRate(input.settings, true),
        configuration.segmentKind ?? "ascent",
      );
      continue;
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

function initialWorkingState(input: DivePlanInput, gas: Gas): WorkingState {
  return {
    tissues: initializeTissues(input.environmentSettings),
    runtimeSeconds: seconds(0),
    depthM: meters(0),
    segments: [],
    currentStrategy: { kind: "open-circuit", gas },
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
  ledgerOptions: { readonly bailout?: boolean; readonly startRuntimeSeconds?: Seconds } = {},
): DivePlan {
  const decompressionSeconds = seconds(
    ascent.stops.reduce((sum, stop) => sum + stop.durationSeconds, 0),
  );
  const ledger = calculateGasLedger(ascent.state.segments, input, {
    ...ledgerOptions,
    bottomEndRuntimeSeconds: bottomEndRuntime,
  });
  const diagnostics = [...warnings, ...ascent.diagnostics, ...ledger.diagnostics];
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
    ccrActivationDepthM: input.setpointActivationDepthM,
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
  const bailoutGas = selectBestGas(input.bailoutGases, input.depthM, input);
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
    availableOcGases: input.bailoutGases,
    segmentKind: "bailout",
  });
  const bailoutPlan = buildPlan(
    { ...input, mode: "ccr" },
    bailoutAscent,
    warnings,
    bailoutTriggerRuntime,
    "bailout",
    { bailout: true, startRuntimeSeconds: bailoutTriggerRuntime },
  );
  return { ...normalPlan, bailoutPlan };
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
  const normalizedGases = input.mode === "oc"
    ? [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases]
    : [input.diluent, ...input.bailoutGases];
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
    ? { input, ccrActivationDepthM: input.mode === "ccr" ? input.setpointActivationDepthM : meters(0) }
    : { input, availableOcGases: options.ascentGases ?? [state.currentGas], segmentKind: options.bailout ? "bailout" : "ascent" };
  const ascent = scheduleAscent(state, configuration);
  const plan = buildPlan(
    input,
    ascent,
    validation.warnings,
    exposureEndRuntime,
    options.idSuffix ?? "events",
    options.bailout
      ? { bailout: true, startRuntimeSeconds: bailoutStartRuntime ?? exposureEndRuntime }
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
