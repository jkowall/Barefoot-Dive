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
  readonly setpointBar: number;
  readonly setpointActivationDepthM: number;
  readonly bailoutTriggerMinutes?: number;
  readonly gfLowPercent: number;
  readonly gfHighPercent: number;
  readonly conventionId: PlannerConventionId;
  readonly bottomRmvLpm: number;
  readonly decoRmvLpm: number;
  readonly bailoutRmvLpm: number;
  readonly bailoutDecoRmvLpm: number;
  readonly reserve: ReserveDraft;
};

export type ResolvedPlanInput = {
  readonly input: DivePlanInput;
  readonly gases: readonly Gas[];
  readonly cylinders: readonly Cylinder[];
};

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
  gfLowPercent: 30,
  gfHighPercent: 70,
  conventionId: "barefoot-zhl16c-v1",
  bottomRmvLpm: 20,
  decoRmvLpm: 15,
  bailoutRmvLpm: 30,
  bailoutDecoRmvLpm: 20,
  reserve: { kind: "fixed", minimumPressureBar: 35 },
};

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
  const selectedDrafts = draft.mode === "oc"
    ? [draft.bottomGas, ...(draft.travelGasEnabled ? [draft.travelGas] : []), ...draft.decoGases]
    : [draft.diluent, ...draft.bailoutGases];
  const resolved = selectedDrafts.map((item) => resolveGasAndCylinder(item, tankBank));
  const gases = resolved.map((item) => item.gas);
  const cylinders = [...new Map(resolved.map((item) => [item.cylinder.id, item.cylinder])).values()];
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
      bailoutGases: gases.slice(1),
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
