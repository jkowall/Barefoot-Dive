import { describe, expect, it } from "vitest";
import { calculateCavePlan, type CavePlanInput, type CavePlanResult } from "../cave";
import type { DivePlanInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { compareGasPreference, isSwitchEligible } from "../domain/validation";
import { createInitialCaveWorkspaceSession } from "./caveWorkspace";
import type { StorageResult, TankRecord } from "../storage";
import { switchDepthToCanonical } from "./helpers";
import { calculateDivePlan } from "../engine/planner";
import {
  DEFAULT_PLAN_DRAFT,
  resolvePlanInput,
  selectableTanks,
  selectedTankSources,
  sharedTankSourceDiagnostics,
  sharedTankSourceText,
  tankBankSnapshot,
  tankSourceOptionLabel,
  tankSourceSignature,
  withGasPlanning,
  type GasDraft,
  type PlanDraft,
  type ResolvedPlanInput,
  type TankBankSnapshot,
} from "./planning";

/** The calculable input of a draft whose Tank Bank sources all resolve. */
function calculable(resolved: ResolvedPlanInput): DivePlanInput {
  if (!resolved.ok) throw new Error(resolved.diagnostics.map((item) => item.message).join(" "));
  return resolved.input;
}

describe("plan input resolution", () => {
  it("creates distinct immutable ad hoc cylinders for every active OC gas", () => {
    const resolved = resolvePlanInput(DEFAULT_PLAN_DRAFT, []);
    expect(calculable(resolved).mode).toBe("oc");
    expect(resolved.gases).toHaveLength(3);
    expect(resolved.cylinders).toHaveLength(3);
    expect(new Set(resolved.cylinders.map((cylinder) => cylinder.id)).size).toBe(3);
    expect(resolved.cylinders.every((cylinder) =>
      resolved.gases.some((gas) => gas.cylinderId === cylinder.id && gas.id === cylinder.gas.id)
    )).toBe(true);
  });

  it("snapshots a selected Tank Bank gas and cylinder without mutating the bank", () => {
    const tank: TankRecord = {
      id: "bank-1",
      name: "Double 12",
      waterVolumeL: liters(24),
      workingPressureBar: barGauge(232),
      currentPressureBar: barGauge(210),
      gas: { id: "bank-air", name: "Analyzed air", oxygen: fraction(0.21), helium: fraction(0), role: "bottom" },
      maximumPPO2: barAbsolute(1.4),
      role: "bottom",
      revision: 2,
      archived: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    const draft = { ...DEFAULT_PLAN_DRAFT, bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: tank.id } };
    const resolved = resolvePlanInput(draft, [tank]);
    const input = calculable(resolved);
    expect(input.mode === "oc" && input.bottomGas).toMatchObject({
      id: "bank-air",
      oxygen: 0.21,
      cylinderId: tank.id,
    });
    expect(resolved.cylinders[0]).not.toBe(tank);
    expect(tank.gas.cylinderId).toBeUndefined();
  });

  it("builds CCR bailout trigger and all bailout cylinders", () => {
    const resolved = resolvePlanInput({
      ...DEFAULT_PLAN_DRAFT,
      mode: "ccr",
      bailoutTriggerMinutes: 10,
    }, [], "cave");
    const input = calculable(resolved);
    expect(input.mode).toBe("ccr");
    if (input.mode !== "ccr") return;
    expect(input.environment).toBe("cave");
    expect(input.bailoutTriggerSecondsAtDepth).toBe(600);
    expect(input.bailoutGases).toHaveLength(2);
    expect(resolved.cylinders).toHaveLength(3);
  });

  it("excludes a switched-off deco gas and its cylinder without deleting the draft entry", () => {
    const draft = structuredClone(DEFAULT_PLAN_DRAFT);
    const disabled = { ...draft.decoGases[1]!, enabled: false as const };
    const resolved = resolvePlanInput({ ...draft, decoGases: [draft.decoGases[0]!, disabled] }, []);
    const input = calculable(resolved);
    expect(resolved.gases.map((gas) => gas.name)).toEqual([draft.bottomGas.name, draft.decoGases[0]!.name]);
    expect(resolved.cylinders).toHaveLength(2);
    expect(input.mode === "oc" ? input.decoGases : []).toHaveLength(1);
  });

  it("keeps a switched-off bailout gas out of the CCR bailout list", () => {
    const draft = structuredClone(DEFAULT_PLAN_DRAFT);
    const bailout = draft.bailoutGases.map((gas, index) => index === 0 ? { ...gas, enabled: false as const } : gas);
    const input = calculable(resolvePlanInput({ ...draft, mode: "ccr", bailoutGases: bailout }, []));
    expect(input.mode === "ccr" ? input.bailoutGases.length : -1).toBe(draft.bailoutGases.length - 1);
  });

  it("resolves gas-only plans without cylinders or Tank Bank sources and keeps per-gas PPO₂ ceilings", () => {
    const draft: PlanDraft = {
      ...structuredClone(DEFAULT_PLAN_DRAFT),
      gasPlanning: "gas-only",
      bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: "bank-doubles" },
    };
    const resolved = resolvePlanInput(draft, []);
    const input = calculable(resolved);
    expect(resolved.cylinders).toEqual([]);
    expect(input.cylinders).toEqual([]);
    expect(input.gasOnly).toBe(true);
    expect(resolved.gases.every((gas) => gas.cylinderId === undefined)).toBe(true);
    expect(resolved.gases[0]).toMatchObject({ id: "plan-gas-bottom", oxygen: 0.18, helium: 0.45, maximumPPO2: 1.4 });
    expect(tankSourceSignature(draft, [])).toBe("[]");
  });

  it("ignores gas-only planning in Cave and does not emit gas-only fields for cylinder plans", () => {
    const draft: PlanDraft = { ...structuredClone(DEFAULT_PLAN_DRAFT), gasPlanning: "gas-only" };
    const cave = resolvePlanInput(draft, [], "cave");
    expect(calculable(cave).gasOnly).toBeUndefined();
    expect(cave.cylinders.length).toBeGreaterThan(0);
    const cylinders = resolvePlanInput(DEFAULT_PLAN_DRAFT, []);
    expect("gasOnly" in calculable(cylinders)).toBe(false);
    expect(cylinders.gases.every((gas) => gas.maximumPPO2 === undefined)).toBe(true);
  });

  it("emits the low setpoint and switch-down depth for every new CCR plan and dil-out only when enabled", () => {
    const ccr = calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr" }, []));
    expect(ccr.mode).toBe("ccr");
    if (ccr.mode !== "ccr") return;
    expect(ccr.lowSetpointBar).toBe(0.7);
    expect(ccr.setpointDeactivationDepthM).toBe(6);
    expect("diluentBailout" in ccr).toBe(false);
    expect("diluentPreBailoutUseL" in ccr).toBe(false);
    const dilOut = calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr", diluentBailout: true, diluentPreBailoutUseL: 150 }, []));
    expect(dilOut).toMatchObject({ diluentBailout: true, diluentPreBailoutUseL: 150 });
    const blank = calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr", diluentBailout: true }, []));
    expect("diluentPreBailoutUseL" in blank).toBe(false);
  });

  it("charges the bottom RMV until the first stop for new open-water OC plans only", () => {
    const oc = calculable(resolvePlanInput(DEFAULT_PLAN_DRAFT, []));
    expect(oc.mode === "oc" && oc.decoRmvFrom).toBe("first-stop");
    const gasOnly = calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), gasPlanning: "gas-only" }, []));
    expect(gasOnly.mode === "oc" && gasOnly.decoRmvFrom).toBe("first-stop");
    const off = calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), bottomRmvUntilFirstStop: false }, []));
    expect("decoRmvFrom" in off).toBe(false);
    expect("decoRmvFrom" in calculable(resolvePlanInput(DEFAULT_PLAN_DRAFT, [], "cave"))).toBe(false);
    expect("decoRmvFrom" in calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr" }, []))).toBe(false);
  });

  it("adds only the default draft's climb volume to its bottom gas", () => {
    const legacy = calculateDivePlan(calculable(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), bottomRmvUntilFirstStop: false }, [])));
    const current = calculateDivePlan(calculable(resolvePlanInput(DEFAULT_PLAN_DRAFT, [])));
    if (!legacy.ok || !current.ok) throw new Error("plan failed");
    expect(current.value.segments).toEqual(legacy.value.segments);
    // 40 m to a 21 m first stop in 127 s at a mean 4.05 bar: 5 L/min x 127/60 min x 4.05 bar.
    const [bottomGas, ean50, oxygen] = current.value.gasLedger;
    expect(bottomGas.totalUsedL - legacy.value.gasLedger[0].totalUsedL).toBeCloseTo(42.8625, 8);
    expect(ean50.totalUsedL).toBe(legacy.value.gasLedger[1].totalUsedL);
    expect(oxygen.totalUsedL).toBe(legacy.value.gasLedger[2].totalUsedL);
    expect(current.value.gasLedger.map((entry) => entry.reserveL)).toEqual(legacy.value.gasLedger.map((entry) => entry.reserveL));
  });
});

describe("unavailable Tank Bank sources", () => {
  // Deliberately unlike the draft's ad hoc bottom-gas fields (Tx18/45, 24 L, 232/210/35 bar, 1.4 bar).
  const doubles: TankRecord = {
    id: "bank-doubles",
    name: "Doubles 12 L",
    waterVolumeL: liters(12),
    workingPressureBar: barGauge(200),
    currentPressureBar: barGauge(180),
    minimumPressureBar: barGauge(50),
    gas: { id: "tank-tx2135", name: "Tx21/35", oxygen: fraction(0.21), helium: fraction(0.35), role: "bottom" },
    maximumPPO2: barAbsolute(1.2),
    role: "bottom",
    revision: 3,
    archived: false,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  };
  const spare: TankRecord = {
    ...doubles,
    id: "bank-spare",
    name: "Spare doubles",
    gas: { ...doubles.gas, id: "tank-air", name: "Air", oxygen: fraction(0.21), helium: fraction(0) },
    revision: 1,
  };
  const sourced: PlanDraft = { ...structuredClone(DEFAULT_PLAN_DRAFT), bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: doubles.id } };
  const adHocBottom = calculable(resolvePlanInput(DEFAULT_PLAN_DRAFT, []));

  it.each<[string, TankBankSnapshot | readonly TankRecord[], Record<string, unknown>, RegExp]>([
    ["archived", [{ ...doubles, archived: true }], { reason: "archived", cylinderName: "Doubles 12 L" }, /“Doubles 12 L” is archived in Tank Bank\./],
    ["deleted", [spare], { reason: "missing" }, /The selected Tank Bank cylinder no longer exists in Tank Bank\./],
    [
      "quarantined",
      { readable: true, records: [spare], quarantined: [{ id: doubles.id, name: "Doubles 12 L" }] },
      { reason: "quarantined", cylinderName: "Doubles 12 L" },
      /“Doubles 12 L” failed validation and is quarantined in Tank Bank\./,
    ],
    [
      "unreadable",
      { readable: false, message: "Stored data failed runtime validation." },
      { reason: "unreadable", detail: "Stored data failed runtime validation." },
      /Tank Bank could not be read, so the selected cylinder cannot be loaded: Stored data failed runtime validation\./,
    ],
  ])("withholds the input when the selected record is %s instead of using the ad hoc fields", (_label, bank, expected, message) => {
    const resolved = resolvePlanInput(sourced, bank);
    expect(resolved.ok).toBe(false);
    expect(resolved.input).toBeUndefined();
    expect(resolved.unavailableSources).toHaveLength(1);
    const [source] = resolved.unavailableSources;
    expect(source).toMatchObject({ gasKey: "bottom", role: "bottom", cylinderId: doubles.id, ...expected });
    if (expected.cylinderName === undefined) expect(source).not.toHaveProperty("cylinderName");
    expect(resolved.diagnostics).toEqual([expect.objectContaining({ code: "TANK_SOURCE_UNAVAILABLE", severity: "error", cylinderId: doubles.id })]);
    expect(resolved.diagnostics[0]!.message).toMatch(/^Bottom gas Tx18\/45: /);
    expect(resolved.diagnostics[0]!.message).toMatch(message);
    expect(resolved.diagnostics[0]!.message).toMatch(/Choose another cylinder or detach it to ad hoc values before calculating\.$/);
    expect(tankSourceSignature(sourced, bank)).toContain(`"tankId":"${doubles.id}"`);
  });

  it("previews exactly the ad hoc gas and cylinder that detaching calculates, never the record's values", () => {
    const resolved = resolvePlanInput(sourced, [{ ...doubles, archived: true }]);
    const source = resolved.unavailableSources[0]!;
    expect(source.adHoc.gas).toMatchObject({ id: "plan-gas-bottom", name: "Tx18/45", oxygen: 0.18, helium: 0.45, cylinderId: "plan-cylinder-bottom" });
    expect(source.adHoc.cylinder).toMatchObject({ id: "plan-cylinder-bottom", waterVolumeL: 24, workingPressureBar: 232, currentPressureBar: 210, minimumPressureBar: 35, maximumPPO2: 1.4 });
    // Display lists carry the preview in place of the source; there is still no input to calculate.
    expect(resolved.gases[0]).toEqual(source.adHoc.gas);
    expect(resolved.cylinders[0]).toEqual(source.adHoc.cylinder);

    const detached: PlanDraft = { ...sourced, bottomGas: { ...sourced.bottomGas, cylinderId: undefined } };
    const after = resolvePlanInput(detached, [{ ...doubles, archived: true }]);
    const input = calculable(after);
    expect(input.mode === "oc" && input.bottomGas).toEqual(source.adHoc.gas);
    expect(after.cylinders[0]).toEqual(source.adHoc.cylinder);
    expect(input).toEqual(adHocBottom);
    expect(tankSourceSignature(detached, [])).toBe("[]");
  });

  it("resolves again when the diver re-selects a loaded cylinder or the record loads again", () => {
    const reselected: PlanDraft = { ...sourced, bottomGas: { ...sourced.bottomGas, cylinderId: spare.id } };
    const input = calculable(resolvePlanInput(reselected, [{ ...doubles, archived: true }, spare]));
    expect(input.mode === "oc" && input.bottomGas).toMatchObject({ id: "tank-air", name: "Air", cylinderId: spare.id });
    expect(input.cylinders[0]).toMatchObject({ id: spare.id, waterVolumeL: 12, currentPressureBar: 180 });
    expect(calculable(resolvePlanInput(sourced, [doubles])).cylinders[0]).toMatchObject({ id: doubles.id, waterVolumeL: 12 });
  });

  it("prefers a loaded record over a quarantined entry that reuses its id", () => {
    const resolved = resolvePlanInput(sourced, { readable: true, records: [doubles], quarantined: [{ id: doubles.id }] });
    expect(calculable(resolved).cylinders[0]).toMatchObject({ id: doubles.id });
  });

  it("reports every active gas with an unavailable source, including Cave and CCR bailout gases", () => {
    const bank: TankBankSnapshot = { readable: false, message: "Unable to read local storage." };
    const multi: PlanDraft = {
      ...sourced,
      decoGases: sourced.decoGases.map((gas) => ({ ...gas, cylinderId: "bank-deco" })),
    };
    const oc = resolvePlanInput(multi, bank, "cave");
    expect(oc.ok).toBe(false);
    expect(oc.unavailableSources.map((source) => [source.gasKey, source.reason])).toEqual([
      ["bottom", "unreadable"],
      ["deco-50", "unreadable"],
      ["deco-o2", "unreadable"],
    ]);
    expect(oc.diagnostics.map((item) => item.message.split(":")[0])).toEqual(["Bottom gas Tx18/45", "Deco gas EAN50", "Deco gas Oxygen"]);

    const ccr: PlanDraft = {
      ...structuredClone(DEFAULT_PLAN_DRAFT),
      mode: "ccr",
      bailoutGases: DEFAULT_PLAN_DRAFT.bailoutGases.map((gas, index) => index === 1 ? { ...gas, cylinderId: "bank-stage" } : gas),
    };
    const bailout = resolvePlanInput(ccr, [doubles], "cave");
    expect(bailout.unavailableSources).toMatchObject([{ gasKey: "bailout-50", role: "bailout", reason: "missing" }]);
    expect(bailout.diagnostics[0]!.message).toMatch(/^Bailout gas EAN50 bailout: /);
  });

  it("ignores sources that take no part in the calculation", () => {
    const excluded: PlanDraft = {
      ...structuredClone(DEFAULT_PLAN_DRAFT),
      decoGases: DEFAULT_PLAN_DRAFT.decoGases.map((gas, index) => index === 0 ? { ...gas, cylinderId: "bank-gone", enabled: false } : gas),
      travelGas: { ...DEFAULT_PLAN_DRAFT.travelGas, cylinderId: "bank-gone" },
      diluent: { ...DEFAULT_PLAN_DRAFT.diluent, cylinderId: "bank-gone" },
    };
    expect(resolvePlanInput(excluded, []).ok).toBe(true);
    expect(resolvePlanInput({ ...excluded, travelGasEnabled: true }, []).unavailableSources.map((source) => source.gasKey)).toEqual(["travel"]);
    expect(resolvePlanInput({ ...sourced, gasPlanning: "gas-only" }, []).ok).toBe(true);
  });

  it("reads a Tank Bank result into a snapshot that keeps archived records and names an unreadable bank", () => {
    const archived = { ...doubles, archived: true };
    const loaded: StorageResult<readonly TankRecord[]> = { ok: true, value: [archived, spare], diagnostics: [] };
    const snapshot = tankBankSnapshot(loaded);
    expect(snapshot).toEqual({ readable: true, records: [archived, spare] });
    expect(selectableTanks(snapshot)).toEqual([spare]);
    expect(tankSourceSignature(sourced, snapshot)).toBe(JSON.stringify([{ gasKey: "bottom", tankId: doubles.id, revision: 3 }]));

    const error = { code: "STORAGE_INVALID", key: "barefoot-dive:tank-bank", message: "Stored data failed runtime validation." } as const;
    const unreadable = tankBankSnapshot({ ok: false, error, diagnostics: [error] });
    expect(unreadable).toEqual({ readable: false, message: "Stored data failed runtime validation." });
    expect(selectableTanks(unreadable)).toEqual([]);
    expect(tankSourceSignature(sourced, unreadable)).toBe(JSON.stringify([{ gasKey: "bottom", tankId: doubles.id, revision: null }]));
    expect(tankBankSnapshot(undefined)).toEqual({ readable: false, message: "Local storage is unavailable." });
  });

  it("carries each quarantined record's id and name from the Tank Bank read into the snapshot", () => {
    const quarantined = (index: number, record: { readonly id?: string; readonly name?: string }) => ({
      code: "STORAGE_RECORD_QUARANTINED",
      key: "barefoot-dive:tank-bank",
      message: `Stored record ${index + 1} failed validation (gas.oxygen) and was quarantined unchanged.`,
      record: { index, ...record, fields: ["gas.oxygen"] },
    } as const);
    const read: StorageResult<readonly TankRecord[]> = {
      ok: true,
      value: [spare],
      diagnostics: [quarantined(0, { id: doubles.id, name: "Doubles 12 L" }), quarantined(2, {})],
    };
    const snapshot = tankBankSnapshot(read);
    expect(snapshot).toEqual({ readable: true, records: [spare], quarantined: [{ id: doubles.id, name: "Doubles 12 L" }, {}] });
    expect(resolvePlanInput(sourced, snapshot).unavailableSources).toMatchObject([{ reason: "quarantined", cylinderName: "Doubles 12 L" }]);
    expect(selectableTanks(snapshot)).toEqual([spare]);
  });
});

describe("one Tank Bank cylinder selected for several gases", () => {
  const record = (id: string, name: string, waterVolumeL: number, gas: Pick<TankRecord["gas"], "id" | "name" | "oxygen">): TankRecord => ({
    id,
    name,
    waterVolumeL: liters(waterVolumeL),
    workingPressureBar: barGauge(232),
    currentPressureBar: barGauge(232),
    minimumPressureBar: barGauge(35),
    gas: { ...gas, helium: fraction(0), role: "bottom" },
    maximumPPO2: barAbsolute(1.6),
    role: "bottom",
    revision: 1,
    archived: false,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
  });
  // Tank Bank's new-cylinder defaults; it names a record's gas id after the gas, so this one breathes "air".
  const newCylinder = record("bank-new", "New cylinder", 24, { id: "air", name: "Air", oxygen: fraction(0.21) });
  const stage = record("bank-stage", "Stage 11 L", 11, { id: "ean50", name: "EAN50", oxygen: fraction(0.5) });
  const bank = [newCylinder, stage];

  /** Selects `cylinderId` as the source of each draft gas in `keys`, in either breathing mode. */
  function withSource(draft: PlanDraft, keys: readonly string[], cylinderId: string | undefined): PlanDraft {
    const set = (gas: GasDraft): GasDraft => keys.includes(gas.key) ? { ...gas, cylinderId } : gas;
    return {
      ...draft,
      bottomGas: set(draft.bottomGas),
      travelGas: set(draft.travelGas),
      decoGases: draft.decoGases.map(set),
      diluent: set(draft.diluent),
      bailoutGases: draft.bailoutGases.map(set),
    };
  }
  const shared = withSource(DEFAULT_PLAN_DRAFT, ["bottom", "deco-o2"], newCylinder.id);
  const messages = (
    draft: PlanDraft,
    tankBank: TankBankSnapshot | readonly TankRecord[] = bank,
    environment?: DivePlanInput["environment"],
  ) => sharedTankSourceDiagnostics(draft, tankBank, environment).map((item) => item.message);

  it("names both gases and the record where the planner reports only a duplicated gas identifier", () => {
    expect(sharedTankSourceDiagnostics(shared, bank)).toEqual([{
      code: "TANK_SOURCE_SHARED",
      severity: "error",
      message: "Bottom gas Tx18/45 and deco gas Oxygen both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a plan needs one cylinder per gas.",
      cylinderId: newCylinder.id,
    }]);

    // Resolution and domain validation are unchanged: both gases resolve to the record's own gas and to one
    // cylinder, and the planner rejects that input with the bare identifier message Plan used to show.
    const resolved = resolvePlanInput(shared, bank);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "plan-gas-deco-50", "air"]);
    expect(resolved.cylinders.map((cylinder) => cylinder.id)).toEqual([newCylinder.id, "plan-cylinder-deco-50"]);
    const result = calculateDivePlan(calculable(resolved));
    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([expect.objectContaining({ code: "GAS_ID_DUPLICATE", message: "Gas identifier air is duplicated.", field: "gases.2.id" })]);
  });

  it("names every gas on each shared record in plan order, in both breathing modes and in Cave", () => {
    expect(messages(withSource(DEFAULT_PLAN_DRAFT, ["bottom", "deco-50", "deco-o2"], newCylinder.id))).toEqual([
      "Bottom gas Tx18/45, deco gas EAN50 and deco gas Oxygen all use Tank Bank cylinder “New cylinder”. Choose another cylinder for all but one of them; a plan needs one cylinder per gas.",
    ]);
    const twoRecords = withSource(
      withSource({ ...DEFAULT_PLAN_DRAFT, travelGasEnabled: true }, ["deco-50", "deco-o2"], stage.id),
      ["bottom", "travel"],
      newCylinder.id,
    );
    expect(sharedTankSourceDiagnostics(twoRecords, bank).map((item) => [item.cylinderId, item.message])).toEqual([
      [newCylinder.id, "Bottom gas Tx18/45 and travel gas Travel air both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a plan needs one cylinder per gas."],
      [stage.id, "Deco gas EAN50 and deco gas Oxygen both use Tank Bank cylinder “Stage 11 L”. Choose another cylinder for one of them; a plan needs one cylinder per gas."],
    ]);
    expect(messages(withSource({ ...DEFAULT_PLAN_DRAFT, mode: "ccr" }, ["diluent", "bailout-50"], newCylinder.id))).toEqual([
      "Diluent Tx18/45 diluent and bailout gas EAN50 bailout both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a plan needs one cylinder per gas.",
    ]);
    expect(messages(shared, bank, "cave")).toEqual([
      "Bottom gas Tx18/45 and deco gas Oxygen both use Tank Bank cylinder “New cylinder”. Choose another cylinder for one of them; a cave plan needs one cylinder per gas.",
    ]);
  });

  it("lists every loaded record an active gas selects so each source control can name the other gases", () => {
    const draft = withSource(withSource(DEFAULT_PLAN_DRAFT, ["bottom"], newCylinder.id), ["deco-50"], stage.id);
    const [ean50, oxygen] = draft.decoGases as [GasDraft, GasDraft];
    expect(selectedTankSources(draft, bank)).toEqual([
      { record: newCylinder, gases: [draft.bottomGas] },
      { record: stage, gases: [ean50] },
    ]);
    expect(sharedTankSourceDiagnostics(draft, bank)).toEqual([]);
    expect(selectedTankSources(shared, bank)).toEqual([{ record: newCylinder, gases: [shared.bottomGas, shared.decoGases[1]] }]);

    expect(tankSourceOptionLabel(stage, [])).toBe("Stage 11 L · EAN50");
    expect(tankSourceOptionLabel(newCylinder, [draft.bottomGas])).toBe("New cylinder · Air · used by bottom gas Tx18/45");
    expect(tankSourceOptionLabel(newCylinder, [draft.bottomGas, ean50])).toBe("New cylinder · Air · used by bottom gas Tx18/45 and deco gas EAN50");
    expect(sharedTankSourceText([oxygen])).toBe("Deco gas Oxygen also uses this cylinder. Give each gas its own cylinder.");
    expect(sharedTankSourceText([draft.bottomGas, { ...ean50, name: " " }])).toBe(
      "Bottom gas Tx18/45 and deco gas Plan gas also use this cylinder. Give each gas its own cylinder.",
    );
  });

  it("ignores gases that take no part in the calculation and sources that do not load", () => {
    const withoutOxygen: PlanDraft = { ...shared, decoGases: shared.decoGases.map((gas) => gas.key === "deco-o2" ? { ...gas, enabled: false } : gas) };
    expect(messages(withoutOxygen)).toEqual([]);
    expect(selectedTankSources(withoutOxygen, bank)).toEqual([{ record: newCylinder, gases: [shared.bottomGas] }]);

    const travel = withSource(DEFAULT_PLAN_DRAFT, ["bottom", "travel"], newCylinder.id);
    expect(messages(travel)).toEqual([]);
    expect(messages({ ...travel, travelGasEnabled: true })).toHaveLength(1);

    const loop = withSource(DEFAULT_PLAN_DRAFT, ["diluent", "bailout-bottom"], newCylinder.id);
    expect(messages(loop)).toEqual([]);
    expect(messages({ ...loop, mode: "ccr" })).toHaveLength(1);

    // Gas-only plans carry no cylinders, but Cave always plans with them.
    const gasOnly: PlanDraft = { ...shared, gasPlanning: "gas-only" };
    expect(messages(gasOnly)).toEqual([]);
    expect(resolvePlanInput(gasOnly, bank).gases.map((gas) => gas.id)).toEqual(["plan-gas-bottom", "plan-gas-deco-50", "plan-gas-deco-o2"]);
    expect(messages(gasOnly, bank, "cave")).toHaveLength(1);

    // A record that does not load is reported once per gas as an unavailable source, never as shared.
    const unloaded: readonly (TankBankSnapshot | readonly TankRecord[])[] = [
      [{ ...newCylinder, archived: true }, stage],
      [stage],
      { readable: true, records: [stage], quarantined: [{ id: newCylinder.id, name: "New cylinder" }] },
      { readable: false, message: "Stored data failed runtime validation." },
    ];
    for (const tankBank of unloaded) {
      expect(messages(shared, tankBank)).toEqual([]);
      expect(resolvePlanInput(shared, tankBank).unavailableSources.map((source) => source.gasKey)).toEqual(["bottom", "deco-o2"]);
    }
  });

  it("resolves and calculates once each gas has its own cylinder", () => {
    for (const separated of [
      withSource(shared, ["deco-o2"], undefined),
      withSource(shared, ["deco-o2"], stage.id),
      withSource(shared, ["bottom"], undefined),
    ]) {
      expect(sharedTankSourceDiagnostics(separated, bank)).toEqual([]);
      expect(calculateDivePlan(calculable(resolvePlanInput(separated, bank))).ok).toBe(true);
    }
  });
});

describe("gas-planning mode and switch-depth entry", () => {
  const tank: TankRecord = {
    id: "doubles",
    name: "Doubles",
    waterVolumeL: liters(24),
    workingPressureBar: barGauge(232),
    currentPressureBar: barGauge(210),
    gas: { id: "tank-tx2135", name: "Tx21/35", oxygen: fraction(0.21), helium: fraction(0.35), role: "bottom" },
    maximumPPO2: barAbsolute(1.2),
    revision: 1,
    createdAt: "2026-09-23T00:00:00.000Z",
    updatedAt: "2026-09-23T00:00:00.000Z",
  };

  it("carries a Tank Bank mix, name, and maximum PPO₂ into gas-only planning", () => {
    const draft: PlanDraft = { ...DEFAULT_PLAN_DRAFT, bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: "doubles" } };
    const next = withGasPlanning(draft, "gas-only", [tank]);
    expect(next.gasPlanning).toBe("gas-only");
    expect(next.bottomGas).toMatchObject({ name: "Tx21/35", oxygenPercent: 21, heliumPercent: 35, maximumPPO2Bar: 1.2, cylinderId: "doubles" });
    const resolved = calculable(resolvePlanInput(next, [tank]));
    expect(resolved.gasOnly).toBe(true);
    expect(resolved.mode === "oc" && resolved.bottomGas).toMatchObject({ oxygen: 0.21, helium: 0.35, maximumPPO2: 1.2 });
    expect(next.decoGases).toEqual(draft.decoGases);
    expect(withGasPlanning(next, "cylinders", [tank])).toEqual({ ...next, gasPlanning: "cylinders" });
  });

  it("leaves ad hoc gases and archived tanks untouched", () => {
    const archived = { ...tank, archived: true };
    const draft: PlanDraft = { ...DEFAULT_PLAN_DRAFT, bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: "doubles" } };
    expect(withGasPlanning(draft, "gas-only", [archived]).bottomGas).toEqual(draft.bottomGas);
    expect(withGasPlanning(DEFAULT_PLAN_DRAFT, "gas-only", [tank]).bottomGas).toEqual(DEFAULT_PLAN_DRAFT.bottomGas);
  });

  it.each([
    [20, "imperial", 6],
    [19.7, "imperial", 6],
    [10, "imperial", 3],
    [0, "imperial", 0],
    [30, "imperial", 9],
  ] as const)("snaps %d ft to the %d m stop grid", (value, units, expected) => {
    expect(switchDepthToCanonical(value, units)).toBe(expected);
  });

  it("keeps depths away from the grid and all metric entries exact", () => {
    expect(switchDepthToCanonical(15, "imperial")).toBeCloseTo(15 / 3.280839895, 9);
    expect(switchDepthToCanonical(5.9, "metric")).toBe(5.9);
    expect(switchDepthToCanonical(6, "metric")).toBe(6);
  });
});

describe("Tank Bank records whose gases share an identifier", () => {
  // Tank Bank names a new record's gas after the gas ("Air" is `air`), and Duplicate copies it.
  const bankRecord = (id: string, name: string, overrides: Partial<TankRecord> = {}): TankRecord => ({
    id,
    name,
    waterVolumeL: liters(24),
    workingPressureBar: barGauge(232),
    currentPressureBar: barGauge(210),
    minimumPressureBar: barGauge(35),
    gas: { id: "air", name: "Air", oxygen: fraction(0.21), helium: fraction(0), role: "bottom" },
    maximumPPO2: barAbsolute(1.4),
    role: "bottom",
    revision: 1,
    archived: false,
    createdAt: "2026-09-25T00:00:00.000Z",
    updatedAt: "2026-09-25T00:00:00.000Z",
    ...overrides,
  });
  const ean50 = { id: "ean50", name: "EAN50", oxygen: fraction(0.5), helium: fraction(0), role: "deco" } as const;
  const backGas = bankRecord("bank-back-gas", "Back gas");
  const pony = bankRecord("bank-pony", "Pony", { waterVolumeL: liters(3) });

  /** Selects a Tank Bank record, by draft gas key, as the cylinder source of each listed gas. */
  function withSources(draft: PlanDraft, sources: Readonly<Record<string, string>>): PlanDraft {
    const set = (gas: PlanDraft["bottomGas"]) => sources[gas.key] === undefined ? gas : { ...gas, cylinderId: sources[gas.key] };
    return {
      ...structuredClone(draft),
      bottomGas: set(draft.bottomGas),
      travelGas: set(draft.travelGas),
      decoGases: draft.decoGases.map(set),
      diluent: set(draft.diluent),
      bailoutGases: draft.bailoutGases.map(set),
    };
  }
  const ponyDraft = withSources(DEFAULT_PLAN_DRAFT, { bottom: backGas.id, "deco-o2": pony.id });
  // The pony in the EAN50 slot: from its 21 m switch depth it ties with the back gas on every rank but the identifier.
  const ponyAt21 = withSources(DEFAULT_PLAN_DRAFT, { bottom: backGas.id, "deco-50": pony.id });
  /** The cylinders a calculated plan breathes from, in gas-ledger order. */
  function breathedCylinders(draft: PlanDraft, bank: readonly TankRecord[]): readonly (string | undefined)[] {
    const plan = calculateDivePlan(calculable(resolvePlanInput(draft, bank)));
    if (!plan.ok) throw new Error(plan.errors.map((item) => item.code).join(", "));
    return plan.value.gasLedger.map((item) => item.cylinderId);
  }

  it("gives a later record's gas its own identifier, and each cylinder that gas as its snapshot", () => {
    const resolved = resolvePlanInput(ponyDraft, [backGas, pony]);
    const input = calculable(resolved);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "plan-gas-deco-50", "air~2"]);
    expect(resolved.cylinders.map((cylinder) => cylinder.id)).toEqual([backGas.id, "plan-cylinder-deco-50", pony.id]);
    resolved.gases.forEach((gas, index) => {
      expect(gas.cylinderId).toBe(resolved.cylinders[index]!.id);
      expect(resolved.cylinders[index]!.gas).toEqual(gas);
    });
    expect(resolved.gases[2]).toMatchObject({ name: "Air", oxygen: 0.21, helium: 0, role: "deco", switchDepthM: 6 });
    // Validation used to reject this input with GAS_ID_DUPLICATE at gases.2.id, naming neither gas nor cylinder.
    const plan = calculateDivePlan(input);
    if (!plan.ok) throw new Error(plan.errors.map((item) => item.code).join(", "));
    expect(plan.errors ?? []).toEqual([]);
    expect(pony.gas.id).toBe("air");
  });

  it("changes nothing but the repeated identifier, and nothing at all when identifiers differ", () => {
    const renamed = resolvePlanInput(ponyDraft, [backGas, pony]);
    // Exactly the input a Tank Bank whose pony already carried `air~2` resolves to, byte for byte.
    const alreadyDistinct = resolvePlanInput(ponyDraft, [backGas, { ...pony, gas: { ...pony.gas, id: "air~2" } }]);
    expect(JSON.stringify(renamed)).toBe(JSON.stringify(alreadyDistinct));
    const unique = resolvePlanInput(ponyDraft, [backGas, { ...pony, gas: { ...pony.gas, id: "pony-air" } }]);
    expect(unique.gases.map((gas) => gas.id)).toEqual(["air", "plan-gas-deco-50", "pony-air"]);
    // A record that takes no part in the calculation takes no identifier either.
    const excluded = withSources(ponyDraft, {});
    const off = resolvePlanInput({ ...excluded, decoGases: excluded.decoGases.map((gas) => gas.key === "deco-o2" ? { ...gas, enabled: false } : gas) }, [backGas, pony]);
    expect(off.gases.map((gas) => gas.id)).toEqual(["air", "plan-gas-deco-50"]);
    // Gas-only plans take no Tank Bank source, so selecting two records with one identifier changes nothing.
    const gasOnly = resolvePlanInput({ ...ponyDraft, gasPlanning: "gas-only" }, [backGas, pony]);
    expect(JSON.stringify(gasOnly)).toBe(JSON.stringify(resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, gasPlanning: "gas-only" }, [])));
  });

  it("charges each cylinder for its own gas when identical mixes from two records are both breathed", () => {
    const stage = bankRecord("bank-stage", "EAN50 stage", { waterVolumeL: liters(11), gas: ean50, maximumPPO2: barAbsolute(1.6), role: "deco" });
    const copy = bankRecord("bank-stage-copy", "EAN50 stage copy", { waterVolumeL: liters(11), gas: ean50, maximumPPO2: barAbsolute(1.6), role: "deco" });
    const [deco50, oxygen] = DEFAULT_PLAN_DRAFT.decoGases;
    // The copy is listed second but switched to deeper, so both stages are breathed.
    const draft = withSources({
      ...DEFAULT_PLAN_DRAFT,
      decoGases: [{ ...deco50!, switchDepthM: 15 }, { ...deco50!, key: "deco-50-copy", switchDepthM: 21 }, oxygen!],
    }, { "deco-50": stage.id, "deco-50-copy": copy.id });
    const resolved = resolvePlanInput(draft, [stage, copy]);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["plan-gas-bottom", "ean50", "ean50~2", "plan-gas-deco-o2"]);
    const plan = calculateDivePlan(calculable(resolved));
    if (!plan.ok) throw new Error(plan.errors.map((item) => item.code).join(", "));
    // The copy is breathed from 21 m; the first-listed stage wins the tie between identical mixes once it is eligible at 15 m.
    const firstUse = (gasId: string) => plan.value.segments.find((segment) => segment.gasId === gasId);
    expect(firstUse("ean50~2")?.startDepthM).toBe(21);
    expect(firstUse("ean50")?.startDepthM).toBe(15);
    const entry = (cylinderId: string) => plan.value.gasLedger.find((item) => item.cylinderId === cylinderId);
    expect(entry(stage.id)).toMatchObject({ gasId: "ean50", cylinderName: "EAN50 stage" });
    expect(entry(copy.id)).toMatchObject({ gasId: "ean50~2", cylinderName: "EAN50 stage copy" });
    expect(entry(stage.id)!.totalUsedL).toBeGreaterThan(0);
    expect(entry(copy.id)!.totalUsedL).toBeGreaterThan(0);
    const control = calculateDivePlan(calculable(resolvePlanInput(draft, [stage, { ...copy, gas: { ...ean50, id: "ean50~2" } }])));
    expect(control.ok && control.value.gasLedger).toEqual(plan.value.gasLedger);
    expect(control.ok && control.value.segments).toEqual(plan.value.segments);
  });

  it("gives the first-listed gas the tie between identical mixes, so an unused pony stays full", () => {
    const resolved = resolvePlanInput(ponyAt21, [backGas, pony]);
    const [back, ponyGas] = resolved.gases;
    expect([back!.id, ponyGas!.id]).toEqual(["air", "air~2"]);
    // The pony is switch-eligible from 21 m and loses to the back gas on the identifier alone.
    expect(isSwitchEligible(ponyGas!, meters(21), calculable(resolved))).toBe(true);
    expect(compareGasPreference(back!, ponyGas!)).toBeLessThan(0);
    expect(breathedCylinders(ponyAt21, [backGas, pony])).toEqual([backGas.id, "plan-cylinder-deco-o2"]);
  });

  it("characterizes the remaining limitation: identical mixes whose identifiers already differ tie by identifier", () => {
    // Nothing is renamed when the stored identifiers already differ, and `air` sorts before `back-gas-air`,
    // so the same rig switches to the 3 L pony at its 21 m switch depth and charges it.
    const renamedBack = { ...backGas, gas: { ...backGas.gas, id: "back-gas-air" } };
    expect(breathedCylinders(ponyAt21, [renamedBack, pony])).toEqual([backGas.id, pony.id, "plan-cylinder-deco-o2"]);
  });

  it("keeps one identifier per record, so one record selected for two gases is still rejected", () => {
    const draft = withSources(DEFAULT_PLAN_DRAFT, { bottom: backGas.id, "deco-50": backGas.id, "deco-o2": pony.id });
    const resolved = resolvePlanInput(draft, [backGas, pony]);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "air", "air~2"]);
    expect(resolved.cylinders.map((cylinder) => cylinder.id)).toEqual([backGas.id, pony.id]);
    const plan = calculateDivePlan(calculable(resolved));
    expect(plan.ok ? [] : plan.errors.map((item) => [item.code, item.field])).toEqual([["GAS_ID_DUPLICATE", "gases.1.id"]]);
  });

  it("renames a record's gas, never an ad hoc gas, when the two share an identifier", () => {
    // A gas named "Plan gas bottom" in Tank Bank gets the ad hoc bottom gas's identifier.
    const stage = bankRecord("bank-stage", "Stage", { gas: { ...ean50, id: "plan-gas-bottom" }, maximumPPO2: barAbsolute(1.6) });
    const resolved = resolvePlanInput(withSources(DEFAULT_PLAN_DRAFT, { "deco-50": stage.id }), [stage]);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["plan-gas-bottom", "plan-gas-bottom~2", "plan-gas-deco-o2"]);
    expect(resolved.cylinders[1]!.gas.id).toBe("plan-gas-bottom~2");
    expect(calculateDivePlan(calculable(resolved)).ok).toBe(true);
    // A record listed first is renamed too when a later ad hoc gas has its identifier, so that ad hoc gas wins a tie.
    const bottom = bankRecord("bank-bottom", "Bottom", { gas: { ...backGas.gas, id: "plan-gas-deco-50" } });
    const first = resolvePlanInput(withSources(DEFAULT_PLAN_DRAFT, { bottom: bottom.id }), [bottom]);
    expect(first.gases.map((gas) => gas.id)).toEqual(["plan-gas-deco-50~2", "plan-gas-deco-50", "plan-gas-deco-o2"]);
    expect(calculateDivePlan(calculable(first)).ok).toBe(true);
  });

  it("never repeats an identifier, even one stored with a suffix Tank Bank does not write", () => {
    // Tank Bank's gas-name slug has no `~`, but a hand-edited record could already carry `air~2`.
    const [first, second] = [bankRecord("bank-first", "First"), bankRecord("bank-second", "Second")];
    const suffixed = bankRecord("bank-suffixed", "Suffixed", { gas: { ...backGas.gas, id: "air~2" } });
    const draft = withSources(DEFAULT_PLAN_DRAFT, { bottom: first.id, "deco-50": second.id, "deco-o2": suffixed.id });
    const resolved = resolvePlanInput(draft, [first, second, suffixed]);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "air~2", "air~2~2"]);
    expect([...resolved.gases].sort(compareGasPreference)).toEqual(resolved.gases);
    expect(calculateDivePlan(calculable(resolved)).ok).toBe(true);
  });

  it("numbers later records in plan order, zero-padded so identifier order is plan order", () => {
    const stages = Array.from({ length: 10 }, (_, index) =>
      bankRecord(`bank-stage-${index + 1}`, `Stage ${index + 1}`, { gas: ean50, maximumPPO2: barAbsolute(1.6) }));
    const decoGases = stages.map((stage, index) => ({ ...DEFAULT_PLAN_DRAFT.decoGases[0]!, key: `deco-${index + 1}`, cylinderId: stage.id }));
    const resolved = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), decoGases }, stages);
    const stageGases = resolved.gases.slice(1);
    expect(stageGases.map((gas) => gas.id)).toEqual(["ean50", "ean50~02", "ean50~03", "ean50~04", "ean50~05", "ean50~06", "ean50~07", "ean50~08", "ean50~09", "ean50~10"]);
    expect(stageGases.map((gas) => gas.cylinderId)).toEqual(stages.map((stage) => stage.id));
    // The planner breaks the tie between identical mixes by identifier, which is now plan order.
    expect([...stageGases].sort(compareGasPreference)).toEqual(stageGases);
  });

  it("plans a CCR air diluent with an air bailout from another record and charges the bailout cylinder", () => {
    const diluent = bankRecord("bank-diluent", "Diluent 3 L", { waterVolumeL: liters(3), role: "diluent" });
    const bailout = bankRecord("bank-bailout", "Bailout 11 L", { waterVolumeL: liters(11), role: "bailout" });
    const draft = withSources({ ...DEFAULT_PLAN_DRAFT, mode: "ccr" }, { diluent: diluent.id, "bailout-bottom": bailout.id });
    const resolved = resolvePlanInput(draft, [diluent, bailout]);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "air~2", "plan-gas-bailout-50"]);
    const plan = calculateDivePlan(calculable(resolved));
    if (!plan.ok) throw new Error(plan.errors.map((item) => item.code).join(", "));
    const bailoutLedger = plan.value.bailoutPlan?.gasLedger ?? [];
    expect(bailoutLedger.find((item) => item.cylinderId === bailout.id)).toMatchObject({ gasId: "air~2", cylinderName: "Bailout 11 L" });
    expect(bailoutLedger.find((item) => item.cylinderId === bailout.id)!.totalUsedL).toBeGreaterThan(0);
    expect(bailoutLedger.some((item) => item.cylinderId === diluent.id)).toBe(false);

    // Dil-out: the dedicated bailout still comes before the diluent for the identical mix, by role, not identifier.
    const dilOut = calculateDivePlan(calculable(resolvePlanInput({ ...draft, diluentBailout: true, diluentPreBailoutUseL: 100 }, [diluent, bailout])));
    if (!dilOut.ok) throw new Error(dilOut.errors.map((item) => item.code).join(", "));
    expect(dilOut.value.bailoutPlan?.segments.find((segment) => segment.kind === "gas-switch")?.gasId).toBe("air~2");
  });

  it("offers Cave both cylinders and breathes the second one after the back gas is lost", () => {
    const stage = bankRecord("bank-stage", "Stage 11 L", { waterVolumeL: liters(11), role: "stage" });
    const initial = createInitialCaveWorkspaceSession().draft;
    const draft = withSources({ ...initial, decoGases: [{ ...initial.decoGases[0]!, switchDepthM: 18 }] }, { bottom: backGas.id, "deco-50": stage.id });
    const resolved = resolvePlanInput(draft, [backGas, stage], "cave");
    const dive = calculable(resolved);
    expect(resolved.gases.map((gas) => gas.id)).toEqual(["air", "air~2"]);
    const input: CavePlanInput = {
      mode: "oc",
      dive,
      route: [{
        id: "route-1",
        startDepthM: meters(0),
        endDepthM: meters(18),
        durationSeconds: seconds(300),
        distanceM: meters(60),
        propulsion: "fins",
        accessibleCylinderIds: resolved.cylinders.map((cylinder) => cylinder.id),
      }],
      reserve: dive.reservePolicy,
      scenarios: [{ kind: "oc-lost-gas", targetLegId: "route-1" }],
    };
    const result = calculateCavePlan(input);
    if (!result.ok) throw new Error(result.errors.map((item) => item.code).join(", "));
    const used = (ledger: CavePlanResult["gasLedger"], cylinderId: string) => ledger.find((item) => item.cylinderId === cylinderId)?.totalUsedL ?? 0;
    // Back gas wins the tie on the route; with it lost, the exit is breathed from the stage.
    expect(used(result.value.base.gasLedger, backGas.id)).toBeGreaterThan(0);
    expect(used(result.value.base.gasLedger, stage.id)).toBe(0);
    const lost = result.value.scenarios[0]!.plan!.gasLedger;
    expect(lost.find((item) => item.cylinderId === stage.id)).toMatchObject({ gasId: "air~2" });
    expect(used(lost, backGas.id)).toBeGreaterThan(0);
    expect(used(lost, stage.id)).toBeGreaterThan(0);
  });
});

describe("hidden inputs and Tank Bank source tracking", () => {
  const bankTank = (revision: number, switchDepthM?: number): TankRecord => ({
    id: "o2-stage",
    name: "O₂ stage",
    waterVolumeL: liters(7),
    workingPressureBar: barGauge(200),
    currentPressureBar: barGauge(200),
    gas: { id: "bank-o2", name: "Oxygen", oxygen: fraction(1), helium: fraction(0), role: "deco", ...(switchDepthM === undefined ? {} : { switchDepthM: meters(switchDepthM) }) },
    maximumPPO2: barAbsolute(1.6),
    revision,
    createdAt: "2026-09-24T00:00:00.000Z",
    updatedAt: "2026-09-24T00:00:00.000Z",
  });

  it("drops a hidden bottom-gas switch depth when no travel gas is in use", () => {
    const draft: PlanDraft = { ...DEFAULT_PLAN_DRAFT, bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, switchDepthM: 30 } };
    const withoutTravel = resolvePlanInput(draft, []);
    const input = calculable(withoutTravel);
    expect(input.mode === "oc" && "switchDepthM" in input.bottomGas).toBe(false);
    const bottomCylinder = withoutTravel.cylinders.find((cylinder) => cylinder.id === withoutTravel.gases[0]!.cylinderId);
    expect(bottomCylinder && "switchDepthM" in bottomCylinder.gas).toBe(false);
    const withTravel = calculable(resolvePlanInput({ ...draft, travelGasEnabled: true }, []));
    expect(withTravel.mode === "oc" && withTravel.bottomGas.switchDepthM).toBe(30);
  });

  it("drops a Tank Bank switch depth on the bottom gas when no travel gas is in use", () => {
    const tank = { ...bankTank(1, 6), id: "bank-bottom" };
    const draft: PlanDraft = { ...DEFAULT_PLAN_DRAFT, bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: tank.id } };
    const input = calculable(resolvePlanInput(draft, [tank]));
    expect(input.mode === "oc" && "switchDepthM" in input.bottomGas).toBe(false);
  });

  it("treats switching a Tank Bank gas on or off as an edit, not a changed source", () => {
    const draft: PlanDraft = {
      ...DEFAULT_PLAN_DRAFT,
      decoGases: [DEFAULT_PLAN_DRAFT.decoGases[0]!, { ...DEFAULT_PLAN_DRAFT.decoGases[1]!, cylinderId: "o2-stage" }],
    };
    const excluded: PlanDraft = { ...draft, decoGases: [draft.decoGases[0]!, { ...draft.decoGases[1]!, enabled: false }] };
    const tanks = [bankTank(1)];
    expect(tankSourceSignature(excluded, tanks)).toBe(tankSourceSignature(draft, tanks));
    expect(tankSourceSignature({ ...draft, travelGasEnabled: true }, tanks)).toBe(tankSourceSignature(draft, tanks));
    expect(tankSourceSignature(draft, [bankTank(2)])).not.toBe(tankSourceSignature(draft, tanks));
    expect(tankSourceSignature(excluded, [bankTank(2)])).not.toBe(tankSourceSignature(excluded, tanks));
  });
});
