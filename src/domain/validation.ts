import type {
  CalculationResult,
  Cylinder,
  Diagnostic,
  DivePlanInput,
  Gas,
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
  return gas.oxygen * depthToAmbientPressure(
    meters(depthM),
    input.environmentSettings.surfacePressureBar,
    input.environmentSettings.metersPerBar,
  );
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
        travelCylinder?.maximumPPO2 ?? input.settings.maximumBottomPPO2,
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
    if (!Number.isFinite(input.setpointBar) || input.setpointBar < 0.5 || input.setpointBar > 1.6) {
      errors.push(error("CCR_SETPOINT_INVALID", "CCR setpoint must be between 0.5 and 1.6 bar.", "setpointBar"));
    }
    if (Number.isFinite(input.setpointBar) && input.setpointBar > input.settings.maximumBottomPPO2 + 1e-9) {
      errors.push(error("CCR_SETPOINT_LIMIT_EXCEEDED", "CCR setpoint cannot exceed the configured maximum bottom PPO₂.", "setpointBar"));
    }
    if (
      !Number.isFinite(input.setpointActivationDepthM) ||
      input.setpointActivationDepthM <= 0 ||
      input.setpointActivationDepthM > input.depthM
    ) {
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
      const diluentSurfacePPO2 = gasPPO2AtDepth(input.diluent, 0, input);
      const diluentActivationPPO2 = gasPPO2AtDepth(input.diluent, input.setpointActivationDepthM, input);
      const diluentCylinder = resolveAssignedCylinder(input.diluent, input.cylinders);
      const diluentMaximum = Math.min(
        input.settings.maximumBottomPPO2,
        diluentCylinder?.maximumPPO2 ?? input.settings.maximumBottomPPO2,
      );
      if (diluentSurfacePPO2 < input.settings.minimumPPO2 || diluentActivationPPO2 > diluentMaximum) {
        errors.push(error("CCR_DILUENT_OC_RANGE", "Diluent must be breathable on open circuit from the surface through setpoint activation.", "diluent"));
      }
    }
    if (input.bailoutGases.length === 0) {
      errors.push(error("CCR_BAILOUT_REQUIRED", "CCR plans require at least one bailout gas.", "bailoutGases"));
    } else if (!input.bailoutGases.some((gas) => {
      const ppo2 = gasPPO2AtDepth(gas, input.depthM, input);
      const cylinder = resolveAssignedCylinder(gas, input.cylinders);
      return ppo2 >= input.settings.minimumPPO2 &&
        ppo2 <= Math.min(input.settings.maximumDecoPPO2, cylinder?.maximumPPO2 ?? input.settings.maximumDecoPPO2);
    })) {
      errors.push(error("CCR_BAILOUT_AT_DEPTH_REQUIRED", "At least one bailout gas must be breathable at the trigger depth.", "bailoutGases"));
    }
    if (
      input.bailoutTriggerSecondsAtDepth !== undefined &&
      (!Number.isFinite(input.bailoutTriggerSecondsAtDepth) ||
        input.bailoutTriggerSecondsAtDepth < 0 ||
        input.bailoutTriggerSecondsAtDepth > input.bottomTimeSeconds)
    ) {
      errors.push(error("CCR_BAILOUT_TRIGGER_INVALID", "Bailout trigger must fall within the at-depth time.", "bailoutTriggerSecondsAtDepth"));
    }
  }
  return errors.length > 0 ? { ok: false, errors, warnings } : { ok: true, value: input, warnings };
}
