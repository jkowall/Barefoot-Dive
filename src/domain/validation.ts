import { STOP_GRID_PRESETS } from "./defaults";
import type {
  BarAbsolute,
  CalculationResult,
  CcrDiveInput,
  Cylinder,
  Diagnostic,
  DivePlanInput,
  EnvironmentSettings,
  Gas,
  Meters,
  PlannerSettings,
} from "./types";
import { barAbsolute, depthToAmbientPressure, formatBound, formatMessageDepth, meters, roundDepthDeeper } from "./units";

/**
 * Oxygen-at-20 ft stop policy (`oxygen-at-20ft-stop-v1`).
 *
 * On the 10 ft stop grid, pure oxygen at the displayed 20 ft stop (exactly two
 * stop increments) is accepted for deco-switch validation and stop/event
 * breathability when the applicable ceiling is at least 1.60 bar. Default
 * seawater PPO₂ there is about 1.61 bar; custom ambient settings may differ.
 * This exception is named and versioned; it does not clamp, rewrite, or sanitize
 * PPO₂, depth, or limit values elsewhere.
 */
export const OXYGEN_AT_20FT_STOP_POLICY = {
  id: "oxygen-at-20ft-stop-v1",
  version: "1.0.0",
  stopGridId: "10ft",
  stopFeet: 20,
  oxygenFraction: 1,
} as const;

/** Info diagnostic naming `oxygen-at-20ft-stop-v1` when that policy accepts a gas/depth pair. */
export function oxygenAtTwentyFootStopInfo(
  gas: Gas,
  depthM: Meters,
  ppo2: number,
  limit: number,
  field?: string,
  cylinderId?: string,
): Diagnostic {
  return {
    code: "OXYGEN_AT_20FT_STOP_POLICY",
    severity: "info",
    message:
      `${gas.name} at the 20 ft stop is accepted under ${OXYGEN_AT_20FT_STOP_POLICY.id} ` +
      `(${OXYGEN_AT_20FT_STOP_POLICY.version}): PPO₂ is ${ppo2.toFixed(3)} bar, ` +
      `over the ${limit.toFixed(2)} bar limit.`,
    ...(field ? { field } : {}),
    depthM,
    actual: ppo2,
    limit,
    gasId: gas.id,
    ...(cylinderId ? { cylinderId } : {}),
  };
}

const error = (code: string, message: string, field?: string): Diagnostic => ({
  code,
  severity: "error",
  message,
  field,
});

const warning = (code: string, message: string, field?: string): Diagnostic => ({
  code,
  severity: "warning",
  message,
  field,
});

function positiveFinite(value: number, code: string, message: string, field: string): Diagnostic | undefined {
  return !Number.isFinite(value) || value <= 0 ? error(code, message, field) : undefined;
}

export function nitrogenFraction(gas: Gas): number {
  return 1 - gas.oxygen - gas.helium;
}

export function sameGas(left: Gas, right: Gas): boolean {
  return left.id === right.id &&
    Math.abs(left.oxygen - right.oxygen) <= 1e-9 &&
    Math.abs(left.helium - right.helium) <= 1e-9;
}

/**
 * Resolve the cylinder used by a gas without guessing when more than one
 * cylinder carries the same normalized gas. Explicit assignments always win.
 */
export function resolveAssignedCylinder(
  gas: Gas,
  cylinders: readonly Cylinder[],
): Cylinder | undefined {
  if (gas.cylinderId) {
    return cylinders.find((cylinder) => cylinder.id === gas.cylinderId);
  }
  const candidates = cylinders.filter((cylinder) => sameGas(cylinder.gas, gas));
  return candidates.length === 1 ? candidates[0] : undefined;
}

export function validateGas(gas: Gas, field = "gas"): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (typeof gas.id !== "string" || typeof gas.name !== "string" || !gas.id.trim() || !gas.name.trim()) {
    diagnostics.push(error("GAS_IDENTITY_REQUIRED", "Gas name and identifier are required.", field));
  }
  if (!Number.isFinite(gas.oxygen) || !Number.isFinite(gas.helium)) {
    diagnostics.push(error("GAS_FRACTION_NOT_FINITE", "Gas fractions must be finite numbers.", field));
    return diagnostics;
  }
  if (gas.oxygen < 0 || gas.helium < 0 || gas.oxygen > 1 || gas.helium > 1) {
    diagnostics.push(error("GAS_FRACTION_RANGE", "Oxygen and helium fractions must be between 0 and 1.", field));
  }
  if (gas.oxygen + gas.helium > 1 + 1e-9) {
    diagnostics.push(error("GAS_FRACTION_SUM", "Oxygen and helium fractions cannot exceed 100%.", field));
  }
  if (gas.switchDepthM !== undefined && (!Number.isFinite(gas.switchDepthM) || gas.switchDepthM < 0)) {
    diagnostics.push(error("GAS_SWITCH_DEPTH_INVALID", "Gas switch depth must be finite and nonnegative.", `${field}.switchDepthM`));
  }
  return diagnostics;
}

export function validatePlannerSettings(settings: PlannerSettings): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!Number.isFinite(settings.gfLow) || !Number.isFinite(settings.gfHigh)) {
    diagnostics.push(error("GF_NOT_FINITE", "Gradient Factors must be finite.", "gradientFactors"));
  } else if (
    settings.gfLow <= 0 || settings.gfHigh <= 0 || settings.gfLow > 1 ||
    settings.gfHigh > 1 || settings.gfLow > settings.gfHigh
  ) {
    diagnostics.push(error("GF_INVALID", "GF Low and GF High must satisfy 0 < low ≤ high ≤ 100%.", "gradientFactors"));
  }
  for (const [field, value] of [
    ["descentRateMPerMinute", settings.descentRateMPerMinute],
    ["ascentRateMPerMinute", settings.ascentRateMPerMinute],
    ["decoAscentRateMPerMinute", settings.decoAscentRateMPerMinute],
    ["stopIncrementM", settings.stopIncrementM],
    ["lastStopDepthM", settings.lastStopDepthM],
    ["stopTimeQuantumSeconds", settings.stopTimeQuantumSeconds],
  ] as const) {
    const issue = positiveFinite(value, "SETTING_POSITIVE_REQUIRED", `${field} must be greater than zero.`, field);
    if (issue) diagnostics.push(issue);
  }
  if (
    Number.isFinite(settings.stopIncrementM) && settings.stopIncrementM > 0 &&
    Number.isFinite(settings.lastStopDepthM)
  ) {
    const steps = settings.lastStopDepthM / settings.stopIncrementM;
    if (Math.abs(steps - Math.round(steps)) > 1e-9) {
      diagnostics.push(error("LAST_STOP_GRID", "Last stop depth must align with the stop increment.", "lastStopDepthM"));
    }
  }
  if (
    !Number.isFinite(settings.minimumPPO2) ||
    !Number.isFinite(settings.maximumBottomPPO2) ||
    !Number.isFinite(settings.maximumDecoPPO2) ||
    settings.minimumPPO2 <= 0 ||
    settings.maximumBottomPPO2 <= settings.minimumPPO2 ||
    settings.maximumDecoPPO2 < settings.maximumBottomPPO2 ||
    settings.maximumDecoPPO2 > 2
  ) {
    diagnostics.push(error(
      "PPO2_LIMITS_INVALID",
      "PPO₂ limits must satisfy 0 < minimum < bottom maximum ≤ deco maximum ≤ 2 bar.",
      "ppo2Limits",
    ));
  }
  if (![
    "barefoot-zhl16c-v1",
    "multideco-zhlc-compatible-v1",
    "shearwater-petrel3-v103-compatible-v1",
  ].includes(settings.conventionId)) {
    diagnostics.push(error("CONVENTION_UNKNOWN", "The selected convention preset is not supported.", "conventionId"));
  }
  return diagnostics;
}

function validateCylinder(cylinder: Cylinder, index: number): readonly Diagnostic[] {
  const field = `cylinders.${index}`;
  const diagnostics: Diagnostic[] = [...validateGas(cylinder.gas, `${field}.gas`)];
  if (typeof cylinder.id !== "string" || typeof cylinder.name !== "string" || !cylinder.id.trim() || !cylinder.name.trim()) {
    diagnostics.push(error("CYLINDER_IDENTITY_REQUIRED", "Cylinder name and identifier are required.", field));
  }
  for (const [name, value] of [
    ["waterVolumeL", cylinder.waterVolumeL],
    ["workingPressureBar", cylinder.workingPressureBar],
    ["maximumPPO2", cylinder.maximumPPO2],
  ] as const) {
    const issue = positiveFinite(value, "CYLINDER_VALUE_INVALID", `${name} must be finite and greater than zero.`, `${field}.${name}`);
    if (issue) diagnostics.push(issue);
  }
  if (!Number.isFinite(cylinder.currentPressureBar) || cylinder.currentPressureBar < 0) {
    diagnostics.push(error("CYLINDER_PRESSURE_INVALID", "Current pressure must be finite and nonnegative.", `${field}.currentPressureBar`));
  }
  if (
    cylinder.minimumPressureBar !== undefined &&
    (!Number.isFinite(cylinder.minimumPressureBar) || cylinder.minimumPressureBar < 0)
  ) {
    diagnostics.push(error("CYLINDER_MINIMUM_INVALID", "Minimum pressure must be finite and nonnegative.", `${field}.minimumPressureBar`));
  }
  if (cylinder.minimumPressureBar !== undefined && cylinder.minimumPressureBar > cylinder.currentPressureBar) {
    diagnostics.push(error("CYLINDER_BELOW_MINIMUM", "Current pressure is below this cylinder's minimum pressure.", field));
  }
  if (!Number.isInteger(cylinder.revision) || cylinder.revision < 1) {
    diagnostics.push(error("CYLINDER_REVISION_INVALID", "Cylinder revision must be a positive integer.", `${field}.revision`));
  }
  return diagnostics;
}

function gasPPO2AtDepth(gas: Gas, depthM: number, input: DivePlanInput): number {
  return gasPPO2(gas, depthM, input);
}

export function ocBottomSwitchDepth(input: Extract<DivePlanInput, { mode: "oc" }>): number {
  if (input.bottomGas.switchDepthM !== undefined) return input.bottomGas.switchDepthM;
  const minimumDepth = Math.max(
    0,
    (input.settings.minimumPPO2 / input.bottomGas.oxygen - input.environmentSettings.surfacePressureBar) *
      input.environmentSettings.metersPerBar,
  );
  return roundDepthDeeper(meters(minimumDepth), input.settings.stopIncrementM);
}

/**
 * One PPO₂ comparison tolerance shared by the ascent scheduler, validation, and the
 * hypoxic-segment guard, so a gas at exactly its limit is judged the same everywhere.
 */
export const PPO2_EPSILON = 1e-8;

export function gasPPO2(gas: Gas, depthM: number, input: DivePlanInput): number {
  return gas.oxygen * depthToAmbientPressure(
    meters(depthM),
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
}

export function isBelowMinimumPPO2(ppo2: number, minimumPPO2: number): boolean {
  return ppo2 + PPO2_EPSILON < minimumPPO2;
}

/** True when PPO₂ exceeds a ceiling by more than the shared comparison tolerance. */
export function isAboveMaximumPPO2(ppo2: number, maximumPPO2: number): boolean {
  return ppo2 > maximumPPO2 + PPO2_EPSILON;
}

/** True when the plan's stop increment is the Setup 10 ft grid preset. */
export function isTenFootStopGrid(settings: Pick<PlannerSettings, "stopIncrementM">): boolean {
  return Math.abs(settings.stopIncrementM - STOP_GRID_PRESETS["10ft"].stopIncrementM) <= 1e-9;
}

/** Depth of the displayed 20 ft stop on the active 10 ft grid (two increments). */
export function twentyFootStopDepthM(settings: Pick<PlannerSettings, "stopIncrementM">): number {
  return 2 * settings.stopIncrementM;
}

/**
 * True when `oxygen-at-20ft-stop-v1` applies: pure oxygen at the 20 ft stop on the
 * 10 ft grid. Callers must not use this to rewrite PPO₂ or depth values.
 */
export function isOxygenAtTwentyFootStop(
  gas: Pick<Gas, "oxygen" | "helium">,
  depthM: number,
  settings: Pick<PlannerSettings, "stopIncrementM">,
): boolean {
  if (!isTenFootStopGrid(settings)) return false;
  if (Math.abs(gas.oxygen - OXYGEN_AT_20FT_STOP_POLICY.oxygenFraction) > 1e-9) return false;
  if (Math.abs(gas.helium) > 1e-9) return false;
  return Math.abs(depthM - twentyFootStopDepthM(settings)) <= 1e-9;
}

/**
 * Max-PPO₂ breach for deco-switch and stop breathability, honoring
 * `oxygen-at-20ft-stop-v1`. The exception applies only when the applicable
 * ceiling is at least the nominal 1.60 bar deco limit; a tighter cylinder or
 * bottom limit still rejects. The raw PPO₂ comparison (`isAboveMaximumPPO2`)
 * is otherwise unchanged.
 */
export function isUnbreathablyHighPPO2(
  gas: Pick<Gas, "oxygen" | "helium">,
  depthM: number,
  ppo2: number,
  maximumPPO2: number,
  settings: Pick<PlannerSettings, "stopIncrementM">,
): boolean {
  // Waive only the known ~1.61 vs 1.60 seawater miss on the 20 ft stop — never a tighter ceiling.
  if (
    isOxygenAtTwentyFootStop(gas, depthM, settings) &&
    maximumPPO2 + PPO2_EPSILON >= 1.6
  ) {
    return false;
  }
  return isAboveMaximumPPO2(ppo2, maximumPPO2);
}

/** The lowest of the plan limit, the assigned cylinder limit, and a gas-only per-gas limit. */
export function maximumPPO2ForGas(gas: Gas, input: DivePlanInput, planLimit: number): number {
  return Math.min(
    planLimit,
    resolveAssignedCylinder(gas, input.cylinders)?.maximumPPO2 ?? Number.POSITIVE_INFINITY,
    gas.maximumPPO2 ?? Number.POSITIVE_INFINITY,
  );
}

export function isGasBreathable(gas: Gas, depthM: number, input: DivePlanInput): boolean {
  const ppo2 = gasPPO2(gas, depthM, input);
  const maximum = maximumPPO2ForGas(gas, input, input.settings.maximumDecoPPO2);
  return !isBelowMinimumPPO2(ppo2, input.settings.minimumPPO2) &&
    !isUnbreathablyHighPPO2(gas, depthM, ppo2, maximum, input.settings);
}

/** The planner's open-circuit switch rule: breathable, and no deeper than the gas switch depth. */
export function isSwitchEligible(gas: Gas, depthM: number, input: DivePlanInput): boolean {
  if (!isGasBreathable(gas, depthM, input)) return false;
  if (input.mode === "oc" && input.travelGas?.id === gas.id) {
    return depthM <= ocBottomSwitchDepth(input) + PPO2_EPSILON;
  }
  return gas.switchDepthM === undefined || depthM <= gas.switchDepthM + PPO2_EPSILON;
}

/**
 * Richest oxygen first, then least helium. A dedicated bailout is preferred over the
 * diluent for an identical mix, because the diluent's pre-bailout use is an estimate.
 */
export function compareGasPreference(left: Gas, right: Gas): number {
  return right.oxygen - left.oxygen ||
    left.helium - right.helium ||
    Number(left.role === "diluent") - Number(right.role === "diluent") ||
    left.id.localeCompare(right.id);
}

/** Open-circuit bailout gases, including the diluent when dil-out is enabled. */
export function effectiveBailoutGases(input: CcrDiveInput): readonly Gas[] {
  return input.diluentBailout === true ? [...input.bailoutGases, input.diluent] : input.bailoutGases;
}

/** True when the plan uses a low setpoint instead of legacy open-circuit diluent above the switch-up depth. */
export function usesLowSetpoint(input: CcrDiveInput): input is CcrDiveInput & { readonly lowSetpointBar: BarAbsolute } {
  return input.lowSetpointBar !== undefined;
}

/**
 * True when ascent holds min(high setpoint, max loop PPO₂ at depth) after the high setpoint
 * is active, instead of switching to the fixed low setpoint at the switch-down depth.
 */
export function usesAmbientLimitedAscentSetpoint(input: CcrDiveInput): boolean {
  return input.ascentSetpointMode === "ambient-limited-high";
}

/** Ascent switch-down depth in low-setpoint mode: the entered value, else the switch-up depth. */
export function switchDownDepth(input: CcrDiveInput): Meters {
  return input.setpointDeactivationDepthM ?? input.setpointActivationDepthM;
}

/** Shallowest depth at which a loop can still hold the setpoint: setpoint = ambient − water vapor. */
export function setpointAchievableDepth(setpointBar: number, environment: EnvironmentSettings): number {
  return Math.max(
    0,
    (setpointBar + environment.waterVaporPressureBar - environment.surfacePressureBar) * environment.metersPerBar,
  );
}

/** Maximum PPO₂ the loop can achieve at depth: ambient − water vapor. */
export function maxLoopPPO2AtDepth(depthM: number, environment: EnvironmentSettings): number {
  return Math.max(
    0,
    depthToAmbientPressure(meters(depthM), environment.surfacePressureBar, environment.metersPerBar) -
      environment.waterVaporPressureBar,
  );
}

/** min(high setpoint, max loop PPO₂ at depth). */
export function ambientLimitedSetpoint(
  highSetpointBar: number,
  depthM: number,
  environment: EnvironmentSettings,
): BarAbsolute {
  return barAbsolute(Math.min(highSetpointBar, maxLoopPPO2AtDepth(depthM, environment)));
}

/**
 * Switch-down depth the open-water planner applies under the leave-the-depth → low setpoint
 * rule. The loop cannot hold the high setpoint shallower than its achievable depth, and
 * modeling it there as oxygen at ambient pressure would credit off-gassing the loop cannot
 * deliver, so the switch happens no shallower than that. Ambient-limited ascent mode does
 * not deepen: it holds the ambient-limited high setpoint instead of dropping to the fixed low.
 */
export function effectiveSwitchDownDepth(input: CcrDiveInput): Meters {
  if (usesAmbientLimitedAscentSetpoint(input)) return switchDownDepth(input);
  return meters(Math.max(switchDownDepth(input), setpointAchievableDepth(input.setpointBar, input.environmentSettings)));
}

type DepthInterval = { readonly shallowM: number; readonly deepM: number };

function eligibilityInterval(gas: Gas, input: DivePlanInput): DepthInterval | undefined {
  if (!(gas.oxygen > 0)) return undefined;
  const surface = input.environmentSettings.surfacePressureBar;
  const perBar = input.environmentSettings.metersPerBar;
  const shallowM = Math.max(0, (input.settings.minimumPPO2 / gas.oxygen - surface) * perBar);
  const maximum = maximumPPO2ForGas(gas, input, input.settings.maximumDecoPPO2);
  const deepM = Math.min(
    gas.switchDepthM ?? Number.POSITIVE_INFINITY,
    (maximum / gas.oxygen - surface) * perBar,
  );
  return shallowM <= deepM + 1e-9 ? { shallowM, deepM } : undefined;
}

/**
 * First interior depth band within (0, depthM] where no gas is switch-eligible. The
 * surface and the target depth are reported separately by their own checks.
 */
export function eligibilityCoverageGap(gases: readonly Gas[], input: DivePlanInput): DepthInterval | undefined {
  const tolerance = 1e-6;
  const intervals = gases
    .map((gas) => eligibilityInterval(gas, input))
    .filter((interval): interval is DepthInterval => interval !== undefined && interval.shallowM <= input.depthM + tolerance)
    .sort((left, right) => left.shallowM - right.shallowM);
  if (intervals.length === 0) return undefined;
  let reach = intervals[0].shallowM;
  for (const interval of intervals) {
    if (interval.shallowM > reach + tolerance) {
      return { shallowM: reach, deepM: interval.shallowM };
    }
    reach = Math.max(reach, interval.deepM);
  }
  return undefined;
}

export function validateDiveInput(input: DivePlanInput): CalculationResult<DivePlanInput> {
  const errors: Diagnostic[] = [];
  const warnings: Diagnostic[] = [];
  if (!Number.isFinite(input.depthM) || input.depthM <= 0 || input.depthM > 300) {
    errors.push(error("DEPTH_INVALID", "Depth must be greater than 0 and no more than 300 m.", "depthM"));
  }
  if (!Number.isFinite(input.bottomTimeSeconds) || input.bottomTimeSeconds <= 0 || input.bottomTimeSeconds > 86_400) {
    errors.push(error("BOTTOM_TIME_INVALID", "Time at depth must be greater than 0 and no more than 24 hours.", "bottomTimeSeconds"));
  }
  errors.push(...validatePlannerSettings(input.settings));

  const environment = input.environmentSettings;
  if (!Number.isFinite(environment.surfacePressureBar) || environment.surfacePressureBar <= 0 || environment.surfacePressureBar > 2) {
    errors.push(error("SURFACE_PRESSURE_INVALID", "Surface pressure must be greater than 0 and no more than 2 bar.", "environmentSettings.surfacePressureBar"));
  }
  if (!Number.isFinite(environment.metersPerBar) || environment.metersPerBar <= 0 || environment.metersPerBar > 20) {
    errors.push(error("WATER_DENSITY_INVALID", "Meters per bar must be greater than 0 and no more than 20 m/bar.", "environmentSettings.metersPerBar"));
  }
  if (
    !Number.isFinite(environment.waterVaporPressureBar) ||
    environment.waterVaporPressureBar < 0 ||
    environment.waterVaporPressureBar >= environment.surfacePressureBar
  ) {
    errors.push(error("WATER_VAPOR_PRESSURE_INVALID", "Water-vapor pressure must be nonnegative and below surface pressure.", "environmentSettings.waterVaporPressureBar"));
  }

  for (const [field, value] of Object.entries(input.rmv)) {
    const issue = positiveFinite(value, "RMV_INVALID", `${field} must be finite and greater than zero.`, `rmv.${field}`);
    if (issue) errors.push(issue);
  }
  switch (input.reservePolicy.kind) {
    case "fixed":
      if (!Number.isFinite(input.reservePolicy.minimumPressureBar) || input.reservePolicy.minimumPressureBar < 0) {
        errors.push(error("RESERVE_INVALID", "Fixed reserve pressure must be finite and nonnegative.", "reservePolicy.minimumPressureBar"));
      }
      break;
    case "custom":
      if (!Number.isFinite(input.reservePolicy.reserveVolumeL) || input.reservePolicy.reserveVolumeL < 0) {
        errors.push(error("RESERVE_INVALID", "Custom reserve volume must be finite and nonnegative.", "reservePolicy.reserveVolumeL"));
      }
      break;
    case "rock-bottom":
      if (!Number.isInteger(input.reservePolicy.teamSize) || input.reservePolicy.teamSize < 1) {
        errors.push(error("TEAM_SIZE_INVALID", "Rock-bottom team size must be a positive integer.", "reservePolicy.teamSize"));
      }
      if (!Number.isFinite(input.reservePolicy.stressedRmvLpm) || input.reservePolicy.stressedRmvLpm <= 0) {
        errors.push(error("STRESSED_RMV_INVALID", "Rock-bottom SAC/RMV must be finite and greater than zero.", "reservePolicy.stressedRmvLpm"));
      }
      break;
    case "thirds":
    case "sixths":
      break;
  }

  const gases = input.mode === "oc"
    ? [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases]
    : [input.diluent, ...input.bailoutGases];
  gases.forEach((gas, index) => errors.push(...validateGas(gas, `gases.${index}`)));
  gases.forEach((gas, index) => {
    if (gas.maximumPPO2 === undefined) return;
    if (input.gasOnly !== true) {
      errors.push(error(
        "GAS_MAXIMUM_PPO2_REQUIRES_GAS_ONLY",
        `${gas.name} has its own maximum PPO₂, which is used only in gas-only planning. Cylinder plans take the limit from the assigned cylinder.`,
        `gases.${index}.maximumPPO2`,
      ));
      return;
    }
    if (
      typeof gas.maximumPPO2 !== "number" ||
      !Number.isFinite(gas.maximumPPO2) ||
      gas.maximumPPO2 <= input.settings.minimumPPO2 ||
      gas.maximumPPO2 > 1.6
    ) {
      errors.push(error("GAS_MAXIMUM_PPO2_INVALID", `${gas.name} maximum PPO₂ must be above the minimum PPO₂ and no more than 1.6 bar.`, `gases.${index}.maximumPPO2`));
    }
  });
  if (input.gasOnly !== undefined && typeof input.gasOnly !== "boolean") {
    errors.push(error("GAS_ONLY_INVALID", "Gas-only planning must be true or false.", "gasOnly"));
  }
  if (input.gasOnly === true) {
    if (input.cylinders.length > 0 || gases.some((gas) => gas.cylinderId !== undefined)) {
      errors.push(error("GAS_ONLY_CYLINDER_PRESENT", "Gas-only planning cannot include cylinders or cylinder assignments.", "cylinders"));
    }
    if (input.environment === "cave") {
      errors.push(error("GAS_ONLY_CAVE_UNSUPPORTED", "Cave planning needs cylinders for access, turn pressure, and gas limits; gas-only planning is open water only.", "gasOnly"));
    }
    if (input.reservePolicy.kind === "fixed") {
      errors.push(error(
        "GAS_ONLY_RESERVE_POLICY",
        "A fixed minimum-pressure reserve needs cylinder sizes. For gas-only planning choose cave thirds, cave sixths, rock bottom, or a custom reserve volume.",
        "reservePolicy",
      ));
    }
    if (input.mode === "ccr" && input.diluentBailout === true) {
      errors.push(error(
        "GAS_ONLY_DILUENT_BAILOUT_UNSUPPORTED",
        "Dil-out shares the diluent cylinder between the loop and bailout, which gas-only planning cannot account for. Use cylinder planning or turn dil-out off.",
        "diluentBailout",
      ));
    }
  }
  // Stored inputs are replayed verbatim, so an unknown or misplaced value is rejected
  // rather than ignored.
  const decoRmvFrom = (input as { readonly decoRmvFrom?: unknown }).decoRmvFrom;
  if (decoRmvFrom !== undefined) {
    if (input.mode !== "oc") {
      errors.push(error(
        "DECO_RMV_BOUNDARY_OC_ONLY",
        "The deco RMV boundary applies to open-circuit plans only. CCR bailout charges only stops at the bailout deco RMV unless a bailout RMV mode is set.",
        "decoRmvFrom",
      ));
    } else if (decoRmvFrom !== "first-stop") {
      errors.push(error("DECO_RMV_BOUNDARY_INVALID", "The deco RMV boundary must be \"first-stop\" or absent.", "decoRmvFrom"));
    } else if (input.environment === "cave") {
      errors.push(error(
        "DECO_RMV_BOUNDARY_CAVE_UNSUPPORTED",
        "Cave turn limits keep the end-of-bottom-time deco RMV boundary until the first-stop boundary has cave review.",
        "decoRmvFrom",
      ));
    }
  }
  if (input.mode !== "ccr") {
    for (const field of ["bailoutRmvMode", "bailoutRmvSwitchSeconds", "problemSolvingTimeSeconds"] as const) {
      if ((input as Record<string, unknown>)[field] !== undefined) {
        errors.push(error(
          "BAILOUT_RMV_POLICY_CCR_ONLY",
          "Bailout RMV modes and problem-solving time apply to CCR plans only.",
          field,
        ));
      }
    }
  }
  const gasIds = new Set<string>();
  gases.forEach((gas, index) => {
    if (gasIds.has(gas.id)) errors.push(error("GAS_ID_DUPLICATE", `Gas identifier ${gas.id} is duplicated.`, `gases.${index}.id`));
    gasIds.add(gas.id);
    if (gas.switchDepthM !== undefined && gas.switchDepthM > input.depthM) {
      errors.push(error("GAS_SWITCH_BELOW_PROFILE", "Gas switch depth cannot be deeper than the plan.", `gases.${index}.switchDepthM`));
    }
  });

  const cylinderIds = new Set<string>();
  input.cylinders.forEach((cylinder, index) => {
    errors.push(...validateCylinder(cylinder, index));
    if (cylinderIds.has(cylinder.id)) {
      errors.push(error("CYLINDER_ID_DUPLICATE", `Cylinder identifier ${cylinder.id} is duplicated.`, `cylinders.${index}.id`));
    }
    cylinderIds.add(cylinder.id);
    if (cylinder.currentPressureBar > cylinder.workingPressureBar) {
      warnings.push(warning("CYLINDER_OVER_WORKING_PRESSURE", `${cylinder.name} starts above its stated working pressure (overfill); the plan uses the entered starting pressure.`, `cylinders.${index}.currentPressureBar`));
    }
  });
  gases.forEach((gas, index) => {
    const cylinder = resolveAssignedCylinder(gas, input.cylinders);
    if (!cylinder) {
      if (gas.cylinderId) {
        errors.push(error("CYLINDER_REFERENCE_MISSING", `${gas.name} references a cylinder that is not present in this plan.`, `gases.${index}.cylinderId`));
      }
      if (
        gas.maximumPPO2 !== undefined &&
        gas.switchDepthM !== undefined &&
        environment.surfacePressureBar > 0 &&
        environment.metersPerBar > 0
      ) {
        const ppo2 = gasPPO2AtDepth(gas, gas.switchDepthM, input);
        if (isUnbreathablyHighPPO2(gas, gas.switchDepthM, ppo2, gas.maximumPPO2, input.settings)) {
          errors.push({
            ...error(
              "GAS_PPO2_LIMIT_EXCEEDED",
              `${gas.name} reaches PPO₂ ${ppo2.toFixed(3)} bar at its ${formatMessageDepth(gas.switchDepthM)} switch depth, above its ${gas.maximumPPO2.toFixed(2)} bar maximum.`,
              `gases.${index}.switchDepthM`,
            ),
            depthM: gas.switchDepthM,
            actual: ppo2,
            limit: gas.maximumPPO2,
            gasId: gas.id,
          });
        } else if (
          isOxygenAtTwentyFootStop(gas, gas.switchDepthM, input.settings) &&
          isAboveMaximumPPO2(ppo2, gas.maximumPPO2)
        ) {
          warnings.push(oxygenAtTwentyFootStopInfo(gas, gas.switchDepthM, ppo2, gas.maximumPPO2, `gases.${index}.switchDepthM`));
        }
      }
    } else if (!sameGas(gas, cylinder.gas)) {
      errors.push(error("CYLINDER_GAS_MISMATCH", `${gas.name} does not match the assigned cylinder gas snapshot.`, `gases.${index}.cylinderId`));
    } else if (gas.switchDepthM !== undefined && environment.surfacePressureBar > 0 && environment.metersPerBar > 0) {
      const ppo2 = gasPPO2AtDepth(gas, gas.switchDepthM, input);
      if (isUnbreathablyHighPPO2(gas, gas.switchDepthM, ppo2, cylinder.maximumPPO2, input.settings)) {
        errors.push({
          ...error(
            "CYLINDER_PPO2_LIMIT_EXCEEDED",
            `${gas.name} reaches PPO₂ ${ppo2.toFixed(3)} bar at its ${formatMessageDepth(gas.switchDepthM)} switch depth, above the assigned cylinder's ${cylinder.maximumPPO2.toFixed(2)} bar maximum.`,
            `gases.${index}.switchDepthM`,
          ),
          depthM: gas.switchDepthM,
          actual: ppo2,
          limit: cylinder.maximumPPO2,
          gasId: gas.id,
          cylinderId: cylinder.id,
        });
      } else if (
        isOxygenAtTwentyFootStop(gas, gas.switchDepthM, input.settings) &&
        isAboveMaximumPPO2(ppo2, cylinder.maximumPPO2)
      ) {
        warnings.push(oxygenAtTwentyFootStopInfo(
          gas,
          gas.switchDepthM,
          ppo2,
          cylinder.maximumPPO2,
          `gases.${index}.switchDepthM`,
          cylinder.id,
        ));
      }
    }
  });

  const environmentValid = !errors.some((item) => item.code === "SURFACE_PRESSURE_INVALID" || item.code === "WATER_DENSITY_INVALID");
  if (input.mode === "oc" && environmentValid) {
    const bottomPPO2 = gasPPO2AtDepth(input.bottomGas, input.depthM, input);
    const bottomCylinder = resolveAssignedCylinder(input.bottomGas, input.cylinders);
    if (isBelowMinimumPPO2(bottomPPO2, input.settings.minimumPPO2)) {
      errors.push(error("BOTTOM_GAS_HYPOXIC_AT_DEPTH", "Bottom gas is below the minimum PPO₂ at target depth.", "bottomGas"));
    }
    if (isAboveMaximumPPO2(bottomPPO2, input.settings.maximumBottomPPO2)) {
      errors.push({
        code: "BOTTOM_PPO2_LIMIT_EXCEEDED",
        severity: "error",
        message: `${input.bottomGas.name} reaches PPO₂ ${bottomPPO2.toFixed(2)} bar at target depth, above the configured bottom limit.`,
        field: "bottomGas",
        depthM: input.depthM,
        actual: bottomPPO2,
        limit: input.settings.maximumBottomPPO2,
        gasId: input.bottomGas.id,
      });
    }
    if (!bottomCylinder && input.bottomGas.maximumPPO2 !== undefined && isAboveMaximumPPO2(bottomPPO2, input.bottomGas.maximumPPO2)) {
      errors.push({
        code: "GAS_PPO2_LIMIT_EXCEEDED",
        severity: "error",
        message: `${input.bottomGas.name} exceeds its maximum PPO₂ at target depth.`,
        field: "bottomGas",
        depthM: input.depthM,
        actual: bottomPPO2,
        limit: input.bottomGas.maximumPPO2,
        gasId: input.bottomGas.id,
      });
    }
    if (bottomCylinder && isAboveMaximumPPO2(bottomPPO2, bottomCylinder.maximumPPO2)) {
      errors.push({
        code: "CYLINDER_PPO2_LIMIT_EXCEEDED",
        severity: "error",
        message: `${input.bottomGas.name} exceeds ${bottomCylinder.name}'s maximum PPO₂ at target depth.`,
        field: "bottomGas",
        depthM: input.depthM,
        actual: bottomPPO2,
        limit: bottomCylinder.maximumPPO2,
        gasId: input.bottomGas.id,
        cylinderId: bottomCylinder.id,
      });
    }
    const bottomSurfacePPO2 = gasPPO2AtDepth(input.bottomGas, 0, input);
    if (isBelowMinimumPPO2(bottomSurfacePPO2, input.settings.minimumPPO2) && !input.travelGas) {
      errors.push(error("TRAVEL_GAS_REQUIRED", "Hypoxic bottom gas requires a breathable travel gas.", "travelGas"));
    }
    if (input.travelGas) {
      const switchDepth = ocBottomSwitchDepth(input);
      const travelSurfacePPO2 = gasPPO2AtDepth(input.travelGas, 0, input);
      const travelSwitchPPO2 = gasPPO2AtDepth(input.travelGas, switchDepth, input);
      const bottomSwitchPPO2 = gasPPO2AtDepth(input.bottomGas, switchDepth, input);
      const travelCylinder = resolveAssignedCylinder(input.travelGas, input.cylinders);
      const travelMaximum = Math.min(
        input.settings.maximumBottomPPO2,
        travelCylinder?.maximumPPO2 ?? input.travelGas.maximumPPO2 ?? input.settings.maximumBottomPPO2,
      );
      if (switchDepth <= 0 || switchDepth > input.depthM) {
        errors.push(error("TRAVEL_SWITCH_DEPTH_INVALID", "Travel-to-bottom switch must be within the planned descent.", "bottomGas.switchDepthM"));
      }
      const travelHypoxicAtSurface = isBelowMinimumPPO2(travelSurfacePPO2, input.settings.minimumPPO2);
      const travelAboveMaximum = isAboveMaximumPPO2(travelSwitchPPO2, travelMaximum);
      if (travelHypoxicAtSurface || travelAboveMaximum) {
        const atSwitch = `the ${formatMessageDepth(switchDepth)} travel-to-bottom switch`;
        const surface = `is only PPO₂ ${travelSurfacePPO2.toFixed(3)} bar at the surface, below the ${input.settings.minimumPPO2.toFixed(2)} bar minimum`;
        const maximum = `reaches PPO₂ ${travelSwitchPPO2.toFixed(3)} bar at ${atSwitch}, above the ${travelMaximum.toFixed(2)} bar travel-gas limit`;
        errors.push({
          ...error(
            "TRAVEL_GAS_OPERATING_RANGE",
            travelHypoxicAtSurface && travelAboveMaximum
              ? `${input.travelGas.name} ${surface}, and ${maximum}.`
              : travelHypoxicAtSurface
                ? `${input.travelGas.name} ${surface}, so it cannot be breathed from the surface to ${atSwitch}.`
                : `${input.travelGas.name} ${maximum}.`,
            "travelGas",
          ),
          depthM: meters(switchDepth),
          actual: travelAboveMaximum ? travelSwitchPPO2 : travelSurfacePPO2,
          limit: travelAboveMaximum ? travelMaximum : input.settings.minimumPPO2,
          gasId: input.travelGas.id,
        });
      }
      if (travelCylinder && isAboveMaximumPPO2(travelSwitchPPO2, travelCylinder.maximumPPO2)) {
        errors.push({
          code: "CYLINDER_PPO2_LIMIT_EXCEEDED",
          severity: "error",
          message: `${input.travelGas.name} reaches PPO₂ ${travelSwitchPPO2.toFixed(3)} bar at the ${formatMessageDepth(switchDepth)} travel-to-bottom switch, above ${travelCylinder.name}'s ${travelCylinder.maximumPPO2.toFixed(2)} bar maximum.`,
          field: "travelGas",
          depthM: meters(switchDepth),
          actual: travelSwitchPPO2,
          limit: travelCylinder.maximumPPO2,
          gasId: input.travelGas.id,
          cylinderId: travelCylinder.id,
        });
      }
      const bottomAboveMaximum = isAboveMaximumPPO2(bottomSwitchPPO2, input.settings.maximumBottomPPO2);
      if (isBelowMinimumPPO2(bottomSwitchPPO2, input.settings.minimumPPO2) || bottomAboveMaximum) {
        const at = `at its ${formatMessageDepth(switchDepth)} switch depth`;
        errors.push({
          ...error(
            "BOTTOM_SWITCH_UNBREATHABLE",
            bottomAboveMaximum
              ? `${input.bottomGas.name} reaches PPO₂ ${bottomSwitchPPO2.toFixed(3)} bar ${at}, above the ${input.settings.maximumBottomPPO2.toFixed(2)} bar bottom limit.`
              : `${input.bottomGas.name} is only PPO₂ ${bottomSwitchPPO2.toFixed(3)} bar ${at}, below the ${input.settings.minimumPPO2.toFixed(2)} bar minimum.`,
            "bottomGas.switchDepthM",
          ),
          depthM: meters(switchDepth),
          actual: bottomSwitchPPO2,
          limit: bottomAboveMaximum ? input.settings.maximumBottomPPO2 : input.settings.minimumPPO2,
          gasId: input.bottomGas.id,
        });
      }
    }
    input.decoGases.forEach((gas, index) => {
      if (gas.switchDepthM === undefined) return;
      const ppo2 = gasPPO2AtDepth(gas, gas.switchDepthM, input);
      const aboveMaximum = isUnbreathablyHighPPO2(
        gas,
        gas.switchDepthM,
        ppo2,
        input.settings.maximumDecoPPO2,
        input.settings,
      );
      if (isBelowMinimumPPO2(ppo2, input.settings.minimumPPO2) || aboveMaximum) {
        const at = `at its ${formatMessageDepth(gas.switchDepthM)} switch depth`;
        errors.push({
          ...error(
            "DECO_SWITCH_UNBREATHABLE",
            aboveMaximum
              ? `${gas.name} reaches PPO₂ ${ppo2.toFixed(3)} bar ${at}, above the ${input.settings.maximumDecoPPO2.toFixed(2)} bar deco limit.`
              : `${gas.name} is only PPO₂ ${ppo2.toFixed(3)} bar ${at}, below the ${input.settings.minimumPPO2.toFixed(2)} bar minimum.`,
            `decoGases.${index}.switchDepthM`,
          ),
          depthM: gas.switchDepthM,
          actual: ppo2,
          limit: aboveMaximum ? input.settings.maximumDecoPPO2 : input.settings.minimumPPO2,
          gasId: gas.id,
        });
      } else if (
        isOxygenAtTwentyFootStop(gas, gas.switchDepthM, input.settings) &&
        isAboveMaximumPPO2(ppo2, input.settings.maximumDecoPPO2) &&
        // Only name the policy when the effective ceiling (plan ∩ cylinder ∩ gas) still accepts.
        !isUnbreathablyHighPPO2(
          gas,
          gas.switchDepthM,
          ppo2,
          maximumPPO2ForGas(gas, input, input.settings.maximumDecoPPO2),
          input.settings,
        ) &&
        !warnings.some((item) => item.code === "OXYGEN_AT_20FT_STOP_POLICY" && item.gasId === gas.id)
      ) {
        warnings.push(oxygenAtTwentyFootStopInfo(
          gas,
          gas.switchDepthM,
          ppo2,
          input.settings.maximumDecoPPO2,
          `decoGases.${index}.switchDepthM`,
        ));
      }
    });
  } else if (input.mode === "ccr" && environmentValid) {
    validateCcr(input, errors, warnings);
  }
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: input, warnings };
}

function validateCcr(input: CcrDiveInput, errors: Diagnostic[], warnings: Diagnostic[]): void {
  const environment = input.environmentSettings;
  const lowMode = input.lowSetpointBar !== undefined;
  const highValid = Number.isFinite(input.setpointBar) && input.setpointBar >= 0.5 && input.setpointBar <= 1.6;
  if (!highValid) {
    errors.push(error("CCR_SETPOINT_INVALID", "CCR setpoint must be between 0.5 and 1.6 bar.", "setpointBar"));
  }
  if (Number.isFinite(input.setpointBar) && isAboveMaximumPPO2(input.setpointBar, input.settings.maximumBottomPPO2)) {
    errors.push(error("CCR_SETPOINT_LIMIT_EXCEEDED", "CCR setpoint cannot exceed the configured maximum bottom PPO₂.", "setpointBar"));
  }
  const activationValid = Number.isFinite(input.setpointActivationDepthM) &&
    input.setpointActivationDepthM > 0 &&
    input.setpointActivationDepthM <= input.depthM;
  if (!activationValid) {
    errors.push(error("CCR_ACTIVATION_INVALID", "Setpoint activation depth must be within the planned descent.", "setpointActivationDepthM"));
  } else {
    const activationAmbient = depthToAmbientPressure(
      input.setpointActivationDepthM,
      environment.surfacePressureBar,
      environment.metersPerBar,
    );
    const reachable = activationAmbient - environment.waterVaporPressureBar;
    if (isAboveMaximumPPO2(input.setpointBar, reachable)) {
      errors.push({
        ...error(
          "CCR_SETPOINT_NOT_ACHIEVABLE",
          `The ${input.setpointBar.toFixed(2)} bar setpoint cannot be held at the ${formatMessageDepth(input.setpointActivationDepthM)} switch-up depth, where the loop reaches at most ${formatBound(reachable, 2, "upper")} bar.`,
          "setpointActivationDepthM",
        ),
        depthM: input.setpointActivationDepthM,
        actual: input.setpointBar,
        limit: reachable,
      });
    }
    if (!lowMode) {
      const diluentSurfacePPO2 = gasPPO2AtDepth(input.diluent, 0, input);
      const diluentActivationPPO2 = gasPPO2AtDepth(input.diluent, input.setpointActivationDepthM, input);
      const diluentCylinder = resolveAssignedCylinder(input.diluent, input.cylinders);
      const diluentMaximum = Math.min(
        input.settings.maximumBottomPPO2,
        diluentCylinder?.maximumPPO2 ?? input.diluent.maximumPPO2 ?? input.settings.maximumBottomPPO2,
      );
      if (
        isBelowMinimumPPO2(diluentSurfacePPO2, input.settings.minimumPPO2) ||
        isAboveMaximumPPO2(diluentActivationPPO2, diluentMaximum)
      ) {
        errors.push(error("CCR_DILUENT_OC_RANGE", "Diluent must be breathable on open circuit from the surface through setpoint activation.", "diluent"));
      }
    }
  }

  if (input.setpointDeactivationDepthM !== undefined && !lowMode) {
    errors.push(error(
      "CCR_SWITCH_DOWN_REQUIRES_LOW_SETPOINT",
      "A switch-down depth needs a low setpoint to switch to.",
      "setpointDeactivationDepthM",
    ));
  }
  const ascentMode = input.ascentSetpointMode;
  if (ascentMode !== undefined) {
    if (ascentMode !== "ambient-limited-high") {
      errors.push(error(
        "CCR_ASCENT_SETPOINT_MODE_INVALID",
        "CCR ascent setpoint mode must be \"ambient-limited-high\" or absent.",
        "ascentSetpointMode",
      ));
    } else if (!lowMode) {
      errors.push(error(
        "CCR_ASCENT_SETPOINT_MODE_REQUIRES_LOW_SETPOINT",
        "Ambient-limited ascent setpoint mode needs a low setpoint for the descent.",
        "ascentSetpointMode",
      ));
    }
  }
  if (lowMode) validateLowSetpoint(input, highValid && activationValid, errors, warnings);

  // Rich diluent: the loop cannot run below the diluent's own PPO₂ after a flush or ADV add.
  const highDiluentPPO2 = input.diluent.oxygen * (
    depthToAmbientPressure(input.depthM, environment.surfacePressureBar, environment.metersPerBar) -
    environment.waterVaporPressureBar
  );
  if (highValid && isAboveMaximumPPO2(highDiluentPPO2, input.setpointBar)) {
    warnings.push({
      ...warning(
        "CCR_DILUENT_PPO2_ABOVE_SETPOINT",
        `${input.diluent.name} reaches PPO₂ ${highDiluentPPO2.toFixed(2)} bar at target depth, above the ${input.setpointBar.toFixed(2)} bar high setpoint. The plan models the setpoint, so it carries more inert gas and less oxygen exposure than the loop can hold.`,
        "diluent",
      ),
      depthM: input.depthM,
      actual: highDiluentPPO2,
      limit: input.setpointBar,
    });
  }

  validateDiluentBailout(input, errors, warnings);
  validateBailoutCoverage(input, errors);

  if (
    input.bailoutTriggerSecondsAtDepth !== undefined &&
    (!Number.isFinite(input.bailoutTriggerSecondsAtDepth) ||
      input.bailoutTriggerSecondsAtDepth < 0 ||
      input.bailoutTriggerSecondsAtDepth > input.bottomTimeSeconds)
  ) {
    errors.push(error("CCR_BAILOUT_TRIGGER_INVALID", "Bailout trigger must fall within the at-depth time.", "bailoutTriggerSecondsAtDepth"));
  }
  validateBailoutRmvPolicy(input, errors);
}

const BAILOUT_RMV_MODES = new Set(["static", "bottom-deco", "timed"]);

/**
 * Opt-in CCR bailout RMV modes and problem-solving hold. Absent fields keep the engine 0.3.0
 * ledger (travel at bailout SAC, stops at bailout deco SAC, no hold). Cave rejects them until
 * turn limits have review with the new charging rules.
 */
function validateBailoutRmvPolicy(input: CcrDiveInput, errors: Diagnostic[]): void {
  const mode = (input as { readonly bailoutRmvMode?: unknown }).bailoutRmvMode;
  const switchSeconds = (input as { readonly bailoutRmvSwitchSeconds?: unknown }).bailoutRmvSwitchSeconds;
  const problemSolving = (input as { readonly problemSolvingTimeSeconds?: unknown }).problemSolvingTimeSeconds;

  if (mode !== undefined) {
    if (!BAILOUT_RMV_MODES.has(mode as string)) {
      errors.push(error(
        "BAILOUT_RMV_MODE_INVALID",
        "The bailout RMV mode must be \"static\", \"bottom-deco\", \"timed\", or absent.",
        "bailoutRmvMode",
      ));
    } else if (input.environment === "cave") {
      errors.push(error(
        "BAILOUT_RMV_MODE_CAVE_UNSUPPORTED",
        "Cave turn limits keep the engine 0.3.0 bailout RMV phases until the new modes have cave review.",
        "bailoutRmvMode",
      ));
    }
  }

  if (switchSeconds !== undefined) {
    if (typeof switchSeconds !== "number" || !Number.isFinite(switchSeconds) || switchSeconds <= 0) {
      errors.push(error(
        "BAILOUT_RMV_SWITCH_INVALID",
        "The timed bailout RMV switch must be finite and greater than zero.",
        "bailoutRmvSwitchSeconds",
      ));
    } else if (mode !== "timed") {
      errors.push(error(
        "BAILOUT_RMV_SWITCH_REQUIRES_TIMED",
        "bailoutRmvSwitchSeconds is only valid when bailoutRmvMode is \"timed\".",
        "bailoutRmvSwitchSeconds",
      ));
    } else if (input.environment === "cave") {
      errors.push(error(
        "BAILOUT_RMV_SWITCH_CAVE_UNSUPPORTED",
        "Cave turn limits keep the engine 0.3.0 bailout RMV phases until the new modes have cave review.",
        "bailoutRmvSwitchSeconds",
      ));
    }
  } else if (mode === "timed") {
    errors.push(error(
      "BAILOUT_RMV_SWITCH_REQUIRED",
      "Timed bailout RMV mode requires bailoutRmvSwitchSeconds.",
      "bailoutRmvSwitchSeconds",
    ));
  }

  if (problemSolving !== undefined) {
    if (typeof problemSolving !== "number" || !Number.isFinite(problemSolving) || problemSolving < 0) {
      errors.push(error(
        "BAILOUT_PROBLEM_SOLVING_INVALID",
        "Problem-solving time must be finite and nonnegative.",
        "problemSolvingTimeSeconds",
      ));
    } else if (input.environment === "cave") {
      errors.push(error(
        "BAILOUT_PROBLEM_SOLVING_CAVE_UNSUPPORTED",
        "Cave turn limits keep bailout without a problem-solving hold until that hold has cave review.",
        "problemSolvingTimeSeconds",
      ));
    }
  }
}

function validateLowSetpoint(
  input: CcrDiveInput,
  highUsable: boolean,
  errors: Diagnostic[],
  warnings: Diagnostic[],
): void {
  const environment = input.environmentSettings;
  const low = input.lowSetpointBar;
  const lowValid = typeof low === "number" && Number.isFinite(low) && low >= 0.5 && low <= 1.6;
  if (!lowValid) {
    errors.push(error("CCR_LOW_SETPOINT_INVALID", "Low setpoint must be between 0.5 and 1.6 bar.", "lowSetpointBar"));
  } else {
    if (Number.isFinite(input.setpointBar) && low > input.setpointBar + 1e-9) {
      errors.push(error("CCR_LOW_SETPOINT_ABOVE_HIGH", "Low setpoint cannot be above the high setpoint.", "lowSetpointBar"));
    }
    if (isAboveMaximumPPO2(low, input.settings.maximumBottomPPO2)) {
      errors.push(error("CCR_LOW_SETPOINT_LIMIT_EXCEEDED", "Low setpoint cannot exceed the configured maximum bottom PPO₂.", "lowSetpointBar"));
    }
    const surfaceReachable = environment.surfacePressureBar - environment.waterVaporPressureBar;
    if (isAboveMaximumPPO2(low, surfaceReachable)) {
      // The limit is printed rounded down, so entering the printed value is always accepted.
      errors.push({
        ...error(
          "CCR_LOW_SETPOINT_NOT_ACHIEVABLE",
          `Low setpoint ${low.toFixed(2)} bar cannot be held at the surface, where the loop reaches at most ${formatBound(surfaceReachable, 2, "upper")} bar.`,
          "lowSetpointBar",
        ),
        actual: low,
        limit: surfaceReachable,
      });
    }
  }
  const deactivation = input.setpointDeactivationDepthM;
  const deactivationValid = deactivation === undefined || (
    typeof deactivation === "number" &&
    Number.isFinite(deactivation) &&
    deactivation >= 0 &&
    deactivation <= input.depthM
  );
  if (!deactivationValid) {
    errors.push(error(
      "CCR_SWITCH_DOWN_DEPTH_INVALID",
      "Switch-down depth must be between the surface and the planned depth.",
      "setpointDeactivationDepthM",
    ));
  }

  const surfaceDiluentPPO2 = gasPPO2AtDepth(input.diluent, 0, input);
  if (isBelowMinimumPPO2(surfaceDiluentPPO2, input.settings.minimumPPO2) && input.diluent.oxygen > 0) {
    const breathableDepth = Math.max(
      0,
      (input.settings.minimumPPO2 / input.diluent.oxygen - environment.surfacePressureBar) * environment.metersPerBar,
    );
    warnings.push({
      ...warning(
        "CCR_DILUENT_FLUSH_HYPOXIC",
        `${input.diluent.name} is hypoxic shallower than ${formatMessageDepth(breathableDepth, "up")}. A diluent flush or open-circuit breath from it above that depth is not breathable.`,
        "diluent",
      ),
      depthM: meters(breathableDepth),
      depthMentions: [{ valueM: meters(breathableDepth), rounding: "up" }],
    });
  }
  if (!lowValid || !deactivationValid || !highUsable) return;

  const switchDown = switchDownDepth(input);
  // Leave-to-low breathes the low setpoint from the surface through switch-up and again after
  // leaving switch-down, so the richer of those depths is checked. Ambient-limited ascent keeps
  // the low setpoint only on the descent to switch-up.
  const lowCheckDepth = usesAmbientLimitedAscentSetpoint(input)
    ? input.setpointActivationDepthM
    : Math.max(input.setpointActivationDepthM, switchDown);
  const lowDiluentPPO2 = input.diluent.oxygen * (
    depthToAmbientPressure(meters(lowCheckDepth), environment.surfacePressureBar, environment.metersPerBar) -
    environment.waterVaporPressureBar
  );
  if (isAboveMaximumPPO2(lowDiluentPPO2, low)) {
    warnings.push({
      ...warning(
        "CCR_DILUENT_PPO2_ABOVE_SETPOINT",
        `${input.diluent.name} reaches PPO₂ ${lowDiluentPPO2.toFixed(2)} bar at ${lowCheckDepth.toFixed(1)} m, above the ${low.toFixed(2)} bar low setpoint. The plan models the setpoint, so it carries more inert gas and less oxygen exposure than the loop can hold.`,
        "lowSetpointBar",
      ),
      depthM: meters(lowCheckDepth),
      actual: lowDiluentPPO2,
      limit: low,
    });
  }

  // Leave-to-low only: the loop cannot hold the high setpoint shallower than its achievable
  // depth, so the planner switches to the fixed low setpoint no shallower than that.
  // Ambient-limited ascent mode keeps the entered switch-down depth and holds
  // min(high, max loop PPO₂ at depth) instead.
  if (usesAmbientLimitedAscentSetpoint(input)) return;
  const achievableDepth = setpointAchievableDepth(input.setpointBar, environment);
  if (switchDown < achievableDepth - 1e-9) {
    // The achievable depth is a minimum, so it is printed rounded up.
    const achievable = formatMessageDepth(achievableDepth, "up");
    warnings.push({
      ...warning(
        "CCR_SWITCH_DOWN_DEEPENED",
        `The loop cannot hold the ${input.setpointBar.toFixed(2)} bar high setpoint shallower than ${achievable}, so the plan switches to the low setpoint at ${achievable} instead of ${formatMessageDepth(switchDown)}.`,
        "setpointDeactivationDepthM",
      ),
      depthM: meters(achievableDepth),
      actual: switchDown,
      limit: achievableDepth,
      depthMentions: [
        { valueM: meters(achievableDepth), rounding: "up" },
        { valueM: meters(achievableDepth), rounding: "up" },
        { valueM: switchDown, rounding: "nearest" },
      ],
    });
  }
}

function validateDiluentBailout(input: CcrDiveInput, errors: Diagnostic[], warnings: Diagnostic[]): void {
  if (input.diluentBailout !== undefined && typeof input.diluentBailout !== "boolean") {
    errors.push(error("CCR_DILUENT_BAILOUT_INVALID", "Dil-out must be true or false.", "diluentBailout"));
    return;
  }
  if (input.diluentBailout !== true || input.gasOnly === true) return;
  const cylinder = input.diluent.cylinderId
    ? input.cylinders.find((candidate) => candidate.id === input.diluent.cylinderId)
    : undefined;
  if (!cylinder) {
    errors.push(error(
      "DILUENT_BAILOUT_CYLINDER_REQUIRED",
      "Dil-out needs the diluent assigned to its own cylinder so bailout use is debited from it.",
      "diluent.cylinderId",
    ));
  }
  const preUse = input.diluentPreBailoutUseL;
  if (preUse === undefined) {
    errors.push(error(
      "DILUENT_PRE_BAILOUT_USE_REQUIRED",
      "Dil-out needs the diluent volume you expect to use before bailout (loop make-up, ADV, flushes, wing, suit). Enter 0 only if you mean it.",
      "diluentPreBailoutUseL",
    ));
  } else if (
    typeof preUse !== "number" ||
    !Number.isFinite(preUse) ||
    preUse < 0 ||
    (cylinder !== undefined && preUse > cylinder.waterVolumeL * cylinder.currentPressureBar + 1e-9)
  ) {
    errors.push(error(
      "DILUENT_PRE_BAILOUT_USE_INVALID",
      "Diluent used before bailout must be between zero and the diluent cylinder's full surface volume.",
      "diluentPreBailoutUseL",
    ));
  }
  warnings.push(warning(
    "DILUENT_BAILOUT_LOOP_USE_UNMODELED",
    "Dil-out: loop make-up, ADV, flush, wing, and suit use of diluent before bailout are your entered estimate, not modeled. Bailout may start with less diluent than planned.",
    "diluentPreBailoutUseL",
  ));
}

function validateBailoutCoverage(input: CcrDiveInput, errors: Diagnostic[]): void {
  const bailout = effectiveBailoutGases(input);
  if (bailout.length === 0) {
    errors.push(error("CCR_BAILOUT_REQUIRED", "CCR plans require at least one bailout gas.", "bailoutGases"));
    return;
  }
  if (!bailout.some((gas) => isSwitchEligible(gas, input.depthM, input))) {
    errors.push(error("CCR_BAILOUT_AT_DEPTH_REQUIRED", "At least one bailout gas must be breathable at the trigger depth.", "bailoutGases"));
  }
  if (!bailout.some((gas) => isSwitchEligible(gas, 0, input))) {
    errors.push(error(
      "CCR_BAILOUT_SURFACE_REQUIRED",
      "At least one bailout gas must be breathable at the surface, or the bailout ascent ends on an unbreathable gas.",
      "bailoutGases",
    ));
  }
  const gap = eligibilityCoverageGap(bailout, input);
  if (gap) {
    // The gap is printed widened (shallow end down, deep end up) so it is never understated.
    errors.push({
      ...error(
        "CCR_BAILOUT_COVERAGE_GAP",
        `No bailout gas is breathable between ${formatMessageDepth(gap.shallowM, "down")} and ${formatMessageDepth(gap.deepM, "up")}. Add a bailout gas for that range or adjust switch depths.`,
        "bailoutGases",
      ),
      depthM: meters(gap.deepM),
      actual: gap.shallowM,
      limit: gap.deepM,
      depthMentions: [
        { valueM: meters(gap.shallowM), rounding: "down" },
        { valueM: meters(gap.deepM), rounding: "up" },
      ],
    });
  }
}
