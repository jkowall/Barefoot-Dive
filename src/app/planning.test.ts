import { describe, expect, it } from "vitest";
import type { DivePlanInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
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
