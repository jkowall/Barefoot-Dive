import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RMV,
} from "../domain/defaults";
import type {
  Cylinder,
  Diagnostic,
  DivePlanInput,
  Gas,
  GasRole,
  PlannerConventionId,
  PlanningMode,
  ReservePolicy,
} from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import type { StorageResult, TankRecord } from "../storage";

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
  /**
   * Open-water OC only: charge the bottom RMV until the first stop (decoRmvFrom "first-stop").
   * Off keeps the engine 0.1.0 rule, the deco RMV from the end of bottom time.
   */
  readonly bottomRmvUntilFirstStop: boolean;
  readonly reserve: ReserveDraft;
  /** Cylinder accounting, or gas volumes only (open water; Cave always uses cylinders). */
  readonly gasPlanning: "cylinders" | "gas-only";
};

/**
 * What Plan and Cave could read from the Tank Bank. Records include archived cylinders so an
 * archived source is reported as archived rather than missing.
 */
export type TankBankSnapshot =
  | {
      readonly readable: true;
      readonly records: readonly TankRecord[];
      /** Stored records that failed validation and were quarantined instead of loaded. */
      readonly quarantined?: readonly { readonly id?: string; readonly name?: string }[];
    }
  | { readonly readable: false; readonly message: string };

/** Why a gas's selected Tank Bank cylinder cannot be used. */
export type TankSourceUnavailableReason = "archived" | "missing" | "quarantined" | "unreadable";

/** An active gas whose selected Tank Bank cylinder cannot be used. */
export type UnavailableTankSource = {
  readonly gasKey: string;
  readonly role: GasRole;
  readonly cylinderId: string;
  readonly reason: TankSourceUnavailableReason;
  /** Stored cylinder name, when the Tank Bank still reports one (archived or quarantined records). */
  readonly cylinderName?: string;
  /** Why the whole Tank Bank could not be read (reason `unreadable`). */
  readonly detail?: string;
  /** Exactly the gas and cylinder a calculation uses once this gas is detached to its ad hoc fields. */
  readonly adHoc: { readonly gas: Gas; readonly cylinder: Cylinder };
};

/**
 * A draft resolved against the Tank Bank. When any active gas's selected Tank Bank cylinder is
 * unavailable there is no input: nothing may be calculated until the diver chooses another
 * cylinder or detaches the gas. Its `gases` and `cylinders` then show each unavailable source as
 * the ad hoc gas and cylinder that detaching would use, for display only.
 */
export type ResolvedPlanInput = {
  readonly gases: readonly Gas[];
  readonly cylinders: readonly Cylinder[];
} & (
  | {
      readonly ok: true;
      readonly input: DivePlanInput;
      readonly unavailableSources: readonly [];
      readonly diagnostics: readonly [];
    }
  | {
      readonly ok: false;
      readonly input?: undefined;
      readonly unavailableSources: readonly UnavailableTankSource[];
      readonly diagnostics: readonly Diagnostic[];
    }
);

/**
 * Change the gas-planning mode. Gas-only plans read the mix from the draft, so a gas that was
 * sourced from a Tank Bank cylinder takes that cylinder's mix, name, and maximum PPO₂ with it.
 * The Tank Bank selection is kept so switching back to cylinders restores it. A source that does
 * not load has no mix to carry, so Plan offers gas-only planning only after every unavailable
 * source of an active gas is resolved.
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
  tankBank: TankBankSnapshot | readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): string {
  if (isGasOnlyPlan(draft, environment)) return "[]";
  const bank = snapshotOf(tankBank);
  const tanks = bank.readable ? bank.records : [];
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
  bottomRmvUntilFirstStop: true,
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

/**
 * Plan and Cave's view of one Tank Bank read: every loaded record plus each quarantined record's
 * id and name, or why the bank could not be read.
 */
export function tankBankSnapshot(result: StorageResult<readonly TankRecord[]> | undefined): TankBankSnapshot {
  if (!result) return { readable: false, message: "Local storage is unavailable." };
  if (!result.ok) return { readable: false, message: result.error.message };
  const quarantined = result.diagnostics.flatMap((item) => item.code === "STORAGE_RECORD_QUARANTINED" && item.record
    ? [{ ...(item.record.id === undefined ? {} : { id: item.record.id }), ...(item.record.name === undefined ? {} : { name: item.record.name }) }]
    : []);
  return { readable: true, records: result.value, ...(quarantined.length > 0 ? { quarantined } : {}) };
}

const snapshotOf = (tankBank: TankBankSnapshot | readonly TankRecord[]): TankBankSnapshot =>
  "readable" in tankBank ? tankBank : { readable: true, records: tankBank };

/** Cylinders a gas can be sourced from: loaded, not archived. */
export function selectableTanks(tankBank: TankBankSnapshot): readonly TankRecord[] {
  return tankBank.readable ? tankBank.records.filter((record) => !record.archived) : [];
}

type TankSourceLookup =
  | { readonly kind: "ad-hoc" }
  | { readonly kind: "record"; readonly record: TankRecord }
  | { readonly kind: "unavailable"; readonly source: Pick<UnavailableTankSource, "cylinderId" | "reason" | "cylinderName" | "detail"> };

function lookupTankSource(draft: GasDraft, tankBank: TankBankSnapshot): TankSourceLookup {
  const cylinderId = draft.cylinderId;
  if (!cylinderId) return { kind: "ad-hoc" };
  if (!tankBank.readable) return { kind: "unavailable", source: { cylinderId, reason: "unreadable", detail: tankBank.message } };
  const record = tankBank.records.find((candidate) => candidate.id === cylinderId && !candidate.archived);
  if (record) return { kind: "record", record };
  const archived = tankBank.records.find((candidate) => candidate.id === cylinderId);
  if (archived) return { kind: "unavailable", source: { cylinderId, reason: "archived", cylinderName: archived.name } };
  const quarantined = tankBank.quarantined?.find((entry) => entry.id === cylinderId);
  if (quarantined) {
    return { kind: "unavailable", source: { cylinderId, reason: "quarantined", ...(quarantined.name ? { cylinderName: quarantined.name } : {}) } };
  }
  return { kind: "unavailable", source: { cylinderId, reason: "missing" } };
}

/** One sentence naming why a selected Tank Bank cylinder cannot be used. */
export function tankSourceUnavailableText(source: Pick<UnavailableTankSource, "reason" | "cylinderName" | "detail">): string {
  const named = source.cylinderName ? `“${source.cylinderName}”` : "The selected Tank Bank cylinder";
  switch (source.reason) {
    case "archived":
      return `${named} is archived in Tank Bank.`;
    case "quarantined":
      return `${named} failed validation and is quarantined in Tank Bank.`;
    case "missing":
      return "The selected Tank Bank cylinder no longer exists in Tank Bank.";
    case "unreadable":
      return `Tank Bank could not be read, so the selected cylinder cannot be loaded${source.detail ? `: ${source.detail}` : "."}`;
  }
}

const gasRoleLabel: Record<GasRole, string> = {
  bottom: "Bottom gas",
  travel: "Travel gas",
  deco: "Deco gas",
  bailout: "Bailout gas",
  diluent: "Diluent",
};

function unavailableSourceDiagnostic(source: UnavailableTankSource): Diagnostic {
  return {
    code: "TANK_SOURCE_UNAVAILABLE",
    severity: "error",
    message: `${gasRoleLabel[source.role]} ${source.adHoc.gas.name}: ${tankSourceUnavailableText(source)} Choose another cylinder or detach it to ad hoc values before calculating.`,
    cylinderId: source.cylinderId,
  };
}

/** A loaded Tank Bank record and the active gases that select it as their cylinder source, in plan order. */
export type SelectedTankSource = {
  readonly record: TankRecord;
  readonly gases: readonly GasDraft[];
};

/**
 * Every loaded Tank Bank record that an active gas selects, with the active gases that select it, in
 * plan order. Gas-only plans select no cylinders, and a selected record that does not load is an
 * unavailable source instead.
 */
export function selectedTankSources(
  draft: PlanDraft,
  tankBank: TankBankSnapshot | readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): readonly SelectedTankSource[] {
  if (isGasOnlyPlan(draft, environment)) return [];
  const bank = snapshotOf(tankBank);
  const selected = new Map<string, SelectedTankSource>();
  for (const gas of activeGasDrafts(draft)) {
    const source = lookupTankSource(gas, bank);
    if (source.kind !== "record") continue;
    selected.set(source.record.id, { record: source.record, gases: [...(selected.get(source.record.id)?.gases ?? []), gas] });
  }
  return [...selected.values()];
}

/** A gas as Tank Bank source messages name it, in lower case: "deco gas EAN50". */
export function gasSourceLabel(gas: Pick<GasDraft, "role" | "name">): string {
  return `${gasRoleLabel[gas.role].toLowerCase()} ${gas.name.trim() || "Plan gas"}`;
}

const listText = (items: readonly string[]) => items.length < 2
  ? items.join("")
  : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Why one Tank Bank record cannot supply several gases, naming the gases (`gasSourceLabel`, in plan
 * order) and the record. Plan's `TANK_SOURCE_SHARED` and Cave's `ROUTE_CYLINDER_SHARED` errors share it.
 */
export function sharedTankSourceMessage(
  gasLabels: readonly string[],
  cylinderName: string,
  environment: DivePlanInput["environment"] = "open-water",
): string {
  const both = gasLabels.length === 2;
  return sentence(`${listText(gasLabels)} ${both ? "both" : "all"} use Tank Bank cylinder “${cylinderName}”. Choose another cylinder for ${both ? "one of them" : "all but one of them"}; ${environment === "cave" ? "a cave plan" : "a plan"} needs one cylinder per gas.`);
}

/**
 * One blocking error per loaded Tank Bank record selected for more than one active gas. Every such gas
 * resolves to the record's own gas and cylinder, so the input would carry one gas identifier twice,
 * which domain validation rejects as `GAS_ID_DUPLICATE` without naming the record. The message names
 * the gases and the record instead; nothing may be calculated until each gas has its own cylinder.
 */
export function sharedTankSourceDiagnostics(
  draft: PlanDraft,
  tankBank: TankBankSnapshot | readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): readonly Diagnostic[] {
  return selectedTankSources(draft, tankBank, environment)
    .filter((source) => source.gases.length > 1)
    .map(({ record, gases }): Diagnostic => ({
      code: "TANK_SOURCE_SHARED",
      severity: "error",
      message: sharedTankSourceMessage(gases.map(gasSourceLabel), record.name, environment),
      cylinderId: record.id,
    }));
}

/** A Tank Bank record as a gas's cylinder-source control lists it, naming any other active gas that selects it. */
export function tankSourceOptionLabel(
  record: Pick<TankRecord, "name" | "gas">,
  otherGases: readonly Pick<GasDraft, "role" | "name">[],
): string {
  const label = `${record.name} · ${record.gas.name}`;
  return otherGases.length === 0 ? label : `${label} · used by ${listText(otherGases.map(gasSourceLabel))}`;
}

/** Why a gas's selected Tank Bank record cannot be calculated while other active gases select it too. */
export function sharedTankSourceText(otherGases: readonly Pick<GasDraft, "role" | "name">[]): string {
  return sentence(`${listText(otherGases.map(gasSourceLabel))} also ${otherGases.length === 1 ? "uses" : "use"} this cylinder. Give each gas its own cylinder.`);
}

function bankGasAndCylinder(draft: GasDraft, bankCylinder: TankRecord): { gas: Gas; cylinder: Cylinder } {
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

/** The draft's own gas and cylinder fields: an ad hoc gas, or what detaching a Tank Bank source uses. */
function adHocGasAndCylinder(draft: GasDraft): { gas: Gas; cylinder: Cylinder } {
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

/**
 * Resolves the active gases against the Tank Bank. A gas whose selected Tank Bank cylinder is
 * archived, missing, quarantined, or unreadable is never replaced by its ad hoc fields: the
 * result carries an unavailable source instead of an input until the diver resolves it.
 */
export function resolvePlanInput(
  draft: PlanDraft,
  tankBank: TankBankSnapshot | readonly TankRecord[],
  environment: DivePlanInput["environment"] = "open-water",
): ResolvedPlanInput {
  const bank = snapshotOf(tankBank);
  const selectedDrafts = activeGasDrafts(draft);
  const gasOnly = isGasOnlyPlan(draft, environment);
  const unavailableSources: UnavailableTankSource[] = [];
  const resolved = selectedDrafts.map((item) => {
    if (gasOnly) return { gas: resolveGasOnly(item), cylinder: undefined };
    const source = lookupTankSource(item, bank);
    if (source.kind === "record") return bankGasAndCylinder(item, source.record);
    const adHoc = adHocGasAndCylinder(item);
    if (source.kind === "unavailable") unavailableSources.push({ gasKey: item.key, role: item.role, ...source.source, adHoc });
    return adHoc;
  });
  const gases = resolved.map((item) => item.gas);
  const cylinders = [...new Map(resolved.flatMap((item) => item.cylinder ? [[item.cylinder.id, item.cylinder] as const] : [])).values()];
  if (unavailableSources.length > 0) {
    return { ok: false, gases, cylinders, unavailableSources, diagnostics: unavailableSources.map(unavailableSourceDiagnostic) };
  }
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
  const resolvedSources = { ok: true, gases, cylinders, unavailableSources: [], diagnostics: [] } as const;
  if (draft.mode === "oc") {
    return {
      ...resolvedSources,
      input: {
        ...shared,
        mode: "oc",
        bottomGas: gases[0] ?? AIR,
        ...(draft.travelGasEnabled && gases[1] ? { travelGas: gases[1] } : {}),
        decoGases: gases.slice(draft.travelGasEnabled ? 2 : 1),
        // Cave turn limits keep the engine 0.1.0 rule until they are reviewed with it.
        ...(draft.bottomRmvUntilFirstStop && environment === "open-water" ? { decoRmvFrom: "first-stop" as const } : {}),
      },
    };
  }
  return {
    ...resolvedSources,
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
