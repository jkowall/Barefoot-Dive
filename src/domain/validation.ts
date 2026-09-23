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
import { depthToAmbientPressure, meters, roundDepthDeeper } from "./units";

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
    Number.isFinite(settings.lastStopDepthM) &&
    Math.abs(settings.lastStopDepthM % settings.stopIncrementM) > 1e-9
  ) {
    diagnostics.push(error("LAST_STOP_GRID", "Last stop depth must align with the stop increment.", "lastStopDepthM"));
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
  return !isBelowMinimumPPO2(ppo2, input.settings.minimumPPO2) && ppo2 <= maximum + PPO2_EPSILON;
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

/**
 * Switch-down depth the open-water planner applies. The loop cannot hold the high setpoint
 * shallower than its achievable depth, and modeling it there as oxygen at ambient pressure
 * would credit off-gassing the loop cannot deliver, so the switch happens no shallower than that.
 */
export function effectiveSwitchDownDepth(input: CcrDiveInput): Meters {
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
        errors.push(error("STRESSED_RMV_INVALID", "Rock-bottom RMV must be finite and greater than zero.", "reservePolicy.stressedRmvLpm"));
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
        environment.metersPerBar > 0 &&
        gasPPO2AtDepth(gas, gas.switchDepthM, input) > gas.maximumPPO2 + 1e-9
      ) {
        errors.push(error(
          "GAS_PPO2_LIMIT_EXCEEDED",
          `${gas.name} exceeds its maximum PPO₂ at its switch depth.`,
          `gases.${index}.switchDepthM`,
        ));
      }
    } else if (!sameGas(gas, cylinder.gas)) {
      errors.push(error("CYLINDER_GAS_MISMATCH", `${gas.name} does not match the assigned cylinder gas snapshot.`, `gases.${index}.cylinderId`));
    } else if (gas.switchDepthM !== undefined && environment.surfacePressureBar > 0 && environment.metersPerBar > 0) {
      const ppo2 = gasPPO2AtDepth(gas, gas.switchDepthM, input);
      if (ppo2 > cylinder.maximumPPO2) {
        errors.push(error(
          "CYLINDER_PPO2_LIMIT_EXCEEDED",
          `${gas.name} exceeds the assigned cylinder's maximum PPO₂ at its switch depth.`,
          `gases.${index}.switchDepthM`,
        ));
      }
    }
  });

  const environmentValid = !errors.some((item) => item.code === "SURFACE_PRESSURE_INVALID" || item.code === "WATER_DENSITY_INVALID");
  if (input.mode === "oc" && environmentValid) {
    const bottomPPO2 = gasPPO2AtDepth(input.bottomGas, input.depthM, input);
    const bottomCylinder = resolveAssignedCylinder(input.bottomGas, input.cylinders);
    if (bottomPPO2 < input.settings.minimumPPO2) {
      errors.push(error("BOTTOM_GAS_HYPOXIC_AT_DEPTH", "Bottom gas is below the minimum PPO₂ at target depth.", "bottomGas"));
    }
    if (bottomPPO2 > input.settings.maximumBottomPPO2 + 1e-9) {
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
    if (!bottomCylinder && input.bottomGas.maximumPPO2 !== undefined && bottomPPO2 > input.bottomGas.maximumPPO2 + 1e-9) {
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
    if (bottomCylinder && bottomPPO2 > bottomCylinder.maximumPPO2 + 1e-9) {
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
    if (bottomSurfacePPO2 < input.settings.minimumPPO2 && !input.travelGas) {
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
      if (travelSurfacePPO2 < input.settings.minimumPPO2 || travelSwitchPPO2 > travelMaximum + 1e-9) {
        errors.push(error("TRAVEL_GAS_OPERATING_RANGE", "Travel gas is not breathable for the entire surface-to-switch interval.", "travelGas"));
      }
      if (travelCylinder && travelSwitchPPO2 > travelCylinder.maximumPPO2 + 1e-9) {
        errors.push({
          code: "CYLINDER_PPO2_LIMIT_EXCEEDED",
          severity: "error",
          message: `${input.travelGas.name} exceeds ${travelCylinder.name}'s maximum PPO₂ at the travel switch.`,
          field: "travelGas",
          depthM: meters(switchDepth),
          actual: travelSwitchPPO2,
          limit: travelCylinder.maximumPPO2,
          gasId: input.travelGas.id,
          cylinderId: travelCylinder.id,
        });
      }
      if (bottomSwitchPPO2 < input.settings.minimumPPO2 || bottomSwitchPPO2 > input.settings.maximumBottomPPO2 + 1e-9) {
        errors.push(error("BOTTOM_SWITCH_UNBREATHABLE", "Bottom gas is not breathable at its configured switch depth.", "bottomGas.switchDepthM"));
      }
    }
    input.decoGases.forEach((gas, index) => {
      if (gas.switchDepthM === undefined) return;
      const ppo2 = gasPPO2AtDepth(gas, gas.switchDepthM, input);
      if (ppo2 < input.settings.minimumPPO2 || ppo2 > input.settings.maximumDecoPPO2) {
        errors.push(error("DECO_SWITCH_UNBREATHABLE", `${gas.name} is outside PPO₂ limits at its switch depth.`, `decoGases.${index}.switchDepthM`));
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
  if (Number.isFinite(input.setpointBar) && input.setpointBar > input.settings.maximumBottomPPO2 + 1e-9) {
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
    if (input.setpointBar > activationAmbient - environment.waterVaporPressureBar) {
      errors.push(error("CCR_SETPOINT_NOT_ACHIEVABLE", "Setpoint is not physically achievable at the activation depth.", "setpointActivationDepthM"));
    }
    if (!lowMode) {
      const diluentSurfacePPO2 = gasPPO2AtDepth(input.diluent, 0, input);
      const diluentActivationPPO2 = gasPPO2AtDepth(input.diluent, input.setpointActivationDepthM, input);
      const diluentCylinder = resolveAssignedCylinder(input.diluent, input.cylinders);
      const diluentMaximum = Math.min(
        input.settings.maximumBottomPPO2,
        diluentCylinder?.maximumPPO2 ?? input.diluent.maximumPPO2 ?? input.settings.maximumBottomPPO2,
      );
      if (diluentSurfacePPO2 < input.settings.minimumPPO2 || diluentActivationPPO2 > diluentMaximum) {
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
  if (lowMode) validateLowSetpoint(input, highValid && activationValid, errors, warnings);

  // Rich diluent: the loop cannot run below the diluent's own PPO₂ after a flush or ADV add.
  const highDiluentPPO2 = input.diluent.oxygen * (
    depthToAmbientPressure(input.depthM, environment.surfacePressureBar, environment.metersPerBar) -
    environment.waterVaporPressureBar
  );
  if (highValid && highDiluentPPO2 > input.setpointBar + 1e-9) {
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
    if (low > input.settings.maximumBottomPPO2 + 1e-9) {
      errors.push(error("CCR_LOW_SETPOINT_LIMIT_EXCEEDED", "Low setpoint cannot exceed the configured maximum bottom PPO₂.", "lowSetpointBar"));
    }
    if (low > environment.surfacePressureBar - environment.waterVaporPressureBar + 1e-9) {
      errors.push(error(
        "CCR_LOW_SETPOINT_NOT_ACHIEVABLE",
        `Low setpoint ${low.toFixed(2)} bar cannot be held at the surface, where the loop reaches at most ${(environment.surfacePressureBar - environment.waterVaporPressureBar).toFixed(2)} bar.`,
        "lowSetpointBar",
      ));
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
        `${input.diluent.name} is hypoxic shallower than ${breathableDepth.toFixed(1)} m. A diluent flush or open-circuit breath from it above that depth is not breathable.`,
        "diluent",
      ),
      depthM: meters(breathableDepth),
    });
  }
  if (!lowValid || !deactivationValid || !highUsable) return;

  const switchDown = switchDownDepth(input);
  const lowCheckDepth = Math.max(input.setpointActivationDepthM, switchDown);
  const lowDiluentPPO2 = input.diluent.oxygen * (
    depthToAmbientPressure(meters(lowCheckDepth), environment.surfacePressureBar, environment.metersPerBar) -
    environment.waterVaporPressureBar
  );
  if (lowDiluentPPO2 > low + 1e-9) {
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

  // The loop cannot hold the high setpoint shallower than its achievable depth. The planner
  // switches down no shallower than that, instead of modeling the loop as oxygen at ambient.
  const achievableDepth = setpointAchievableDepth(input.setpointBar, environment);
  if (switchDown < achievableDepth - 1e-9) {
    warnings.push({
      ...warning(
        "CCR_SWITCH_DOWN_DEEPENED",
        `The loop cannot hold the ${input.setpointBar.toFixed(2)} bar high setpoint shallower than ${achievableDepth.toFixed(1)} m, so the plan switches to the low setpoint at ${achievableDepth.toFixed(1)} m instead of ${switchDown.toFixed(1)} m.`,
        "setpointDeactivationDepthM",
      ),
      depthM: meters(achievableDepth),
      actual: switchDown,
      limit: achievableDepth,
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
    errors.push({
      ...error(
        "CCR_BAILOUT_COVERAGE_GAP",
        `No bailout gas is breathable between ${gap.shallowM.toFixed(1)} m and ${gap.deepM.toFixed(1)} m. Add a bailout gas for that range or adjust switch depths.`,
        "bailoutGases",
      ),
      depthM: meters(gap.deepM),
      actual: gap.shallowM,
      limit: gap.deepM,
    });
  }
}
