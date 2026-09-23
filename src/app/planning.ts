import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RMV,
} from "../domain/defaults";
import type {
  Cylinder,
  DivePlanInput,
  Gas,
  GasRole,
  PlannerConventionId,
  PlanningMode,
  ReservePolicy,
} from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import type { TankRecord } from "../storage";

export type GasDraft = {
  readonly key: string;
  readonly name: string;
  readonly oxygenPercent: number;
  readonly heliumPercent: number;
  readonly role: GasRole;
  readonly switchDepthM?: number;
  readonly cylinderId?: string;
  readonly waterVolumeL: number;
  readonly workingPressureBar: number;
  readonly currentPressureBar: number;
  readonly minimumPressureBar?: number;
  readonly maximumPPO2Bar: number;
  /** Deco and bailout gases can be excluded from a calculation without deleting them. Undefined means included. */
  readonly enabled?: boolean;
};

export type ReserveDraft =
  | { readonly kind: "fixed"; readonly minimumPressureBar: number }
  | { readonly kind: "custom"; readonly reserveVolumeL: number }
  | { readonly kind: "rock-bottom"; readonly teamSize: number; readonly stressedRmvLpm: number }
  | { readonly kind: "thirds" }
  | { readonly kind: "sixths" };

export type PlanDraft = {
  readonly mode: PlanningMode;
  readonly depthM: number;
  readonly bottomTimeMinutes: number;
  readonly bottomGas: GasDraft;
  readonly travelGasEnabled: boolean;
  readonly travelGas: GasDraft;
  readonly decoGases: readonly GasDraft[];
  readonly diluent: GasDraft;
  readonly bailoutGases: readonly GasDraft[];
  /** High setpoint (bar absolute). */
  readonly setpointBar: number;
  /** Switch-up depth on descent. */
  readonly setpointActivationDepthM: number;
  /** Low setpoint breathed from the surface and after leaving the switch-down depth. */
  readonly lowSetpointBar: number;
  /** Switch-down depth on ascent; never shallower than where the high setpoint is achievable. */
  readonly setpointDeactivationDepthM: number;
  /** Dil-out: the diluent and its cylinder join the bailout gases. */
  readonly diluentBailout: boolean;
  /** Dil-out only: diver-entered diluent use before bailout, in surface litres. */
  readonly diluentPreBailoutUseL?: number;
  readonly bailoutTriggerMinutes?: number;
  readonly gfLowPercent: number;
  readonly gfHighPercent: number;
  readonly conventionId: PlannerConventionId;
  readonly bottomRmvLpm: number;
  readonly decoRmvLpm: number;
  readonly bailoutRmvLpm: number;
  readonly bailoutDecoRmvLpm: number;
  readonly reserve: ReserveDraft;
  /** Cylinder accounting, or gas volumes only (open water; Cave always uses cylinders). */
  readonly gasPlanning: "cylinders" | "gas-only";
};

export type ResolvedPlanInput = {
  readonly input: DivePlanInput;
  readonly gases: readonly Gas[];
  readonly cylinders: readonly Cylinder[];
};

/**
 * Change the gas-planning mode. Gas-only plans read the mix from the draft, so a gas that was
 * sourced from a Tank Bank cylinder takes that cylinder's mix, name, and maximum PPO₂ with it.
 * The Tank Bank selection is kept so switching back to cylinders restores it.
 */
export function withGasPlanning(
  draft: PlanDraft,
  gasPlanning: PlanDraft["gasPlanning"],
  tanks: readonly TankRecord[],
): PlanDraft {
  if (gasPlanning !== "gas-only") return { ...draft, gasPlanning };
  const percent = (value: number) => Math.round(value * 100 * 1e6) / 1e6;
  const fromTank = (gas: GasDraft): GasDraft => {
    const tank = gas.cylinderId
      ? tanks.find((candidate) => candidate.id === gas.cylinderId && !candidate.archived)
      : undefined;
    if (!tank) return gas;
    return {
      ...gas,
      name: tank.gas.name || gas.name,
      oxygenPercent: percent(tank.gas.oxygen),
      heliumPercent: percent(tank.gas.helium),
      maximumPPO2Bar: tank.maximumPPO2,
    };
  };
  return {
    ...draft,
    gasPlanning,
    bottomGas: fromTank(draft.bottomGas),
    travelGas: fromTank(draft.travelGas),
    decoGases: draft.decoGases.map(fromTank),
    diluent: fromTank(draft.diluent),
    bailoutGases: draft.bailoutGases.map(fromTank),
  };
}

/** Gas-only planning applies to open-water plans only; Cave always plans with cylinders. */
export function isGasOnlyPlan(draft: PlanDraft, environment: DivePlanInput["environment"] = "open-water"): boolean {
  return environment !== "cave" && draft.gasPlanning === "gas-only";
}

export function tankSourceSignature(
  draft: PlanDraft,
  tanks: readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): string {
  if (isGasOnlyPlan(draft, environment)) return "[]";
  const selectedDrafts = activeGasDrafts(draft);
  return JSON.stringify(selectedDrafts.flatMap((gas) => {
    if (!gas.cylinderId) return [];
    const tank = tanks.find((candidate) => candidate.id === gas.cylinderId);
    return [{ gasKey: gas.key, tankId: gas.cylinderId, revision: tank?.revision ?? null }];
  }));
}

const gasDraft = (
  key: string,
  name: string,
  oxygenPercent: number,
  heliumPercent: number,
  role: GasRole,
  overrides: Partial<GasDraft> = {},
): GasDraft => ({
  key,
  name,
  oxygenPercent,
  heliumPercent,
  role,
  waterVolumeL: role === "bottom" || role === "diluent" ? 24 : 11,
  workingPressureBar: 232,
  currentPressureBar: 210,
  minimumPressureBar: 35,
  maximumPPO2Bar: role === "bottom" || role === "travel" || role === "diluent" ? 1.4 : 1.6,
  ...overrides,
});

export const DEFAULT_PLAN_DRAFT: PlanDraft = {
  mode: "oc",
  depthM: 40,
  bottomTimeMinutes: 25,
  bottomGas: gasDraft("bottom", "Tx18/45", 18, 45, "bottom"),
  travelGasEnabled: false,
  travelGas: gasDraft("travel", "Travel air", 21, 0, "travel"),
  decoGases: [
    gasDraft("deco-50", "EAN50", 50, 0, "deco", { switchDepthM: 21 }),
    gasDraft("deco-o2", "Oxygen", 100, 0, "deco", { switchDepthM: 6 }),
  ],
  diluent: gasDraft("diluent", "Tx18/45 diluent", 18, 45, "diluent", {
    waterVolumeL: 3,
    workingPressureBar: 200,
    currentPressureBar: 190,
  }),
  bailoutGases: [
    gasDraft("bailout-bottom", "Tx18/45 bailout", 18, 45, "bailout"),
    gasDraft("bailout-50", "EAN50 bailout", 50, 0, "bailout", { switchDepthM: 21 }),
  ],
  setpointBar: 1.3,
  setpointActivationDepthM: 6,
  lowSetpointBar: 0.7,
  setpointDeactivationDepthM: 6,
  diluentBailout: false,
  gfLowPercent: 30,
  gfHighPercent: 70,
  conventionId: "barefoot-zhl16c-v1",
  bottomRmvLpm: 20,
  decoRmvLpm: 15,
  bailoutRmvLpm: 30,
  bailoutDecoRmvLpm: 20,
  reserve: { kind: "fixed", minimumPressureBar: 35 },
  gasPlanning: "cylinders",
};

/** Gases that take part in the calculation: bottom/diluent, an enabled travel gas, and deco/bailout gases not switched off. */
export function activeGasDrafts(draft: PlanDraft): readonly GasDraft[] {
  const included = (gas: GasDraft) => gas.enabled !== false;
  return draft.mode === "oc"
    ? [draft.bottomGas, ...(draft.travelGasEnabled ? [draft.travelGas] : []), ...draft.decoGases.filter(included)]
    : [draft.diluent, ...draft.bailoutGases.filter(included)];
}

/** Gas-only: the draft's own mix and PPO₂ ceiling, with no cylinder or Tank Bank source. */
function resolveGasOnly(draft: GasDraft): Gas {
  return {
    id: `plan-gas-${draft.key}`,
    name: draft.name.trim() || "Plan gas",
    oxygen: fraction(draft.oxygenPercent / 100),
    helium: fraction(draft.heliumPercent / 100),
    role: draft.role,
    ...(draft.switchDepthM === undefined ? {} : { switchDepthM: meters(draft.switchDepthM) }),
    maximumPPO2: barAbsolute(draft.maximumPPO2Bar),
  };
}

function resolveGasAndCylinder(
  draft: GasDraft,
  tankBank: readonly TankRecord[],
): { gas: Gas; cylinder: Cylinder } {
  const bankCylinder = draft.cylinderId
    ? tankBank.find((candidate) => candidate.id === draft.cylinderId && !candidate.archived)
    : undefined;
  if (bankCylinder) {
    const gas: Gas = {
      ...bankCylinder.gas,
      name: bankCylinder.gas.name || draft.name,
      role: draft.role,
      ...(draft.switchDepthM === undefined ? {} : { switchDepthM: meters(draft.switchDepthM) }),
      cylinderId: bankCylinder.id,
    };
    return {
      gas,
      cylinder: {
        ...bankCylinder,
        gas,
        role: bankCylinder.role ?? draft.role,
      },
    };
  }
  const gas: Gas = {
    id: `plan-gas-${draft.key}`,
    name: draft.name.trim() || "Plan gas",
    oxygen: fraction(draft.oxygenPercent / 100),
    helium: fraction(draft.heliumPercent / 100),
    role: draft.role,
    ...(draft.switchDepthM === undefined ? {} : { switchDepthM: meters(draft.switchDepthM) }),
    cylinderId: `plan-cylinder-${draft.key}`,
  };
  return {
    gas,
    cylinder: {
      id: gas.cylinderId!,
      name: `${gas.name} cylinder`,
      waterVolumeL: liters(draft.waterVolumeL),
      workingPressureBar: barGauge(draft.workingPressureBar),
      currentPressureBar: barGauge(draft.currentPressureBar),
      ...(draft.minimumPressureBar === undefined
        ? {}
        : { minimumPressureBar: barGauge(draft.minimumPressureBar) }),
      gas,
      maximumPPO2: barAbsolute(draft.maximumPPO2Bar),
      role: draft.role,
      revision: 1,
    },
  };
}

function reservePolicy(draft: ReserveDraft): ReservePolicy {
  switch (draft.kind) {
    case "fixed":
      return { kind: "fixed", minimumPressureBar: barGauge(draft.minimumPressureBar) };
    case "custom":
      return { kind: "custom", reserveVolumeL: liters(draft.reserveVolumeL) };
    case "rock-bottom":
      return {
        kind: "rock-bottom",
        teamSize: draft.teamSize,
        stressedRmvLpm: litersPerMinute(draft.stressedRmvLpm),
      };
    case "thirds":
      return { kind: "thirds" };
    case "sixths":
      return { kind: "sixths" };
  }
}

export function resolvePlanInput(
  draft: PlanDraft,
  tankBank: readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): ResolvedPlanInput {
  const selectedDrafts = activeGasDrafts(draft);
  const gasOnly = isGasOnlyPlan(draft, environment);
  const resolved = gasOnly
    ? selectedDrafts.map((item) => ({ gas: resolveGasOnly(item), cylinder: undefined }))
    : selectedDrafts.map((item) => resolveGasAndCylinder(item, tankBank));
  const gases = resolved.map((item) => item.gas);
  const cylinders = [...new Map(resolved.flatMap((item) => item.cylinder ? [[item.cylinder.id, item.cylinder] as const] : [])).values()];
  const shared = {
    environment,
    depthM: meters(draft.depthM),
    bottomTimeSeconds: seconds(draft.bottomTimeMinutes * 60),
    settings: {
      ...DEFAULT_PLANNER_SETTINGS,
      gfLow: fraction(draft.gfLowPercent / 100),
      gfHigh: fraction(draft.gfHighPercent / 100),
      conventionId: draft.conventionId,
    },
    environmentSettings: DEFAULT_ENVIRONMENT,
    cylinders,
    rmv: {
      ...DEFAULT_RMV,
      bottomLpm: litersPerMinute(draft.bottomRmvLpm),
      decoLpm: litersPerMinute(draft.decoRmvLpm),
      bailoutLpm: litersPerMinute(draft.bailoutRmvLpm),
      bailoutDecoLpm: litersPerMinute(draft.bailoutDecoRmvLpm),
    },
    reservePolicy: reservePolicy(draft.reserve),
    ...(gasOnly ? { gasOnly: true } : {}),
  } as const;
  if (draft.mode === "oc") {
    return {
      input: {
        ...shared,
        mode: "oc",
        bottomGas: gases[0] ?? AIR,
        ...(draft.travelGasEnabled && gases[1] ? { travelGas: gases[1] } : {}),
        decoGases: gases.slice(draft.travelGasEnabled ? 2 : 1),
      },
      gases,
      cylinders,
    };
  }
  return {
    input: {
      ...shared,
      mode: "ccr",
      diluent: gases[0] ?? AIR,
      setpointBar: barAbsolute(draft.setpointBar),
      setpointActivationDepthM: meters(draft.setpointActivationDepthM),
      lowSetpointBar: barAbsolute(draft.lowSetpointBar),
      setpointDeactivationDepthM: meters(draft.setpointDeactivationDepthM),
      bailoutGases: gases.slice(1),
      ...(draft.diluentBailout
        ? {
            diluentBailout: true,
            ...(draft.diluentPreBailoutUseL === undefined ? {} : { diluentPreBailoutUseL: liters(draft.diluentPreBailoutUseL) }),
          }
        : {}),
      ...(draft.bailoutTriggerMinutes === undefined
        ? {}
        : { bailoutTriggerSecondsAtDepth: seconds(draft.bailoutTriggerMinutes * 60) }),
    },
    gases,
    cylinders,
  };
}

export function applyGasToDraft(
  draft: PlanDraft,
  nextGas: Pick<GasDraft, "name" | "oxygenPercent" | "heliumPercent">,
  cylinderId?: string,
): PlanDraft {
  const updated = { ...draft.bottomGas, ...nextGas, cylinderId };
  return draft.mode === "oc"
    ? { ...draft, bottomGas: updated }
    : { ...draft, diluent: { ...draft.diluent, ...nextGas, cylinderId } };
}

export const resetPlanDraft = (): PlanDraft => structuredClone(DEFAULT_PLAN_DRAFT);
