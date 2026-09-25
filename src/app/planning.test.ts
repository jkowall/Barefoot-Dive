import { describe, expect, it } from "vitest";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
import type { TankRecord } from "../storage";
import { switchDepthToCanonical } from "./helpers";
import { calculateDivePlan } from "../engine/planner";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput, tankSourceSignature, withGasPlanning, type PlanDraft } from "./planning";

describe("plan input resolution", () => {
  it("creates distinct immutable ad hoc cylinders for every active OC gas", () => {
    const resolved = resolvePlanInput(DEFAULT_PLAN_DRAFT, []);
    expect(resolved.input.mode).toBe("oc");
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
    expect(resolved.input.mode === "oc" && resolved.input.bottomGas).toMatchObject({
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
    expect(resolved.input.mode).toBe("ccr");
    if (resolved.input.mode !== "ccr") return;
    expect(resolved.input.environment).toBe("cave");
    expect(resolved.input.bailoutTriggerSecondsAtDepth).toBe(600);
    expect(resolved.input.bailoutGases).toHaveLength(2);
    expect(resolved.cylinders).toHaveLength(3);
  });

  it("excludes a switched-off deco gas and its cylinder without deleting the draft entry", () => {
    const draft = structuredClone(DEFAULT_PLAN_DRAFT);
    const disabled = { ...draft.decoGases[1]!, enabled: false as const };
    const resolved = resolvePlanInput({ ...draft, decoGases: [draft.decoGases[0]!, disabled] }, []);
    expect(resolved.gases.map((gas) => gas.name)).toEqual([draft.bottomGas.name, draft.decoGases[0]!.name]);
    expect(resolved.cylinders).toHaveLength(2);
    expect(resolved.input.mode === "oc" ? resolved.input.decoGases : []).toHaveLength(1);
  });

  it("keeps a switched-off bailout gas out of the CCR bailout list", () => {
    const draft = structuredClone(DEFAULT_PLAN_DRAFT);
    const bailout = draft.bailoutGases.map((gas, index) => index === 0 ? { ...gas, enabled: false as const } : gas);
    const resolved = resolvePlanInput({ ...draft, mode: "ccr", bailoutGases: bailout }, []);
    expect(resolved.input.mode === "ccr" ? resolved.input.bailoutGases.length : -1).toBe(draft.bailoutGases.length - 1);
  });

  it("resolves gas-only plans without cylinders or Tank Bank sources and keeps per-gas PPO₂ ceilings", () => {
    const draft: PlanDraft = {
      ...structuredClone(DEFAULT_PLAN_DRAFT),
      gasPlanning: "gas-only",
      bottomGas: { ...DEFAULT_PLAN_DRAFT.bottomGas, cylinderId: "bank-doubles" },
    };
    const resolved = resolvePlanInput(draft, []);
    expect(resolved.cylinders).toEqual([]);
    expect(resolved.input.cylinders).toEqual([]);
    expect(resolved.input.gasOnly).toBe(true);
    expect(resolved.gases.every((gas) => gas.cylinderId === undefined)).toBe(true);
    expect(resolved.gases[0]).toMatchObject({ id: "plan-gas-bottom", oxygen: 0.18, helium: 0.45, maximumPPO2: 1.4 });
    expect(tankSourceSignature(draft, [])).toBe("[]");
  });

  it("ignores gas-only planning in Cave and does not emit gas-only fields for cylinder plans", () => {
    const draft: PlanDraft = { ...structuredClone(DEFAULT_PLAN_DRAFT), gasPlanning: "gas-only" };
    const cave = resolvePlanInput(draft, [], "cave");
    expect(cave.input.gasOnly).toBeUndefined();
    expect(cave.cylinders.length).toBeGreaterThan(0);
    const cylinders = resolvePlanInput(DEFAULT_PLAN_DRAFT, []);
    expect("gasOnly" in cylinders.input).toBe(false);
    expect(cylinders.gases.every((gas) => gas.maximumPPO2 === undefined)).toBe(true);
  });

  it("emits the low setpoint and switch-down depth for every new CCR plan and dil-out only when enabled", () => {
    const ccr = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr" }, []).input;
    expect(ccr.mode).toBe("ccr");
    if (ccr.mode !== "ccr") return;
    expect(ccr.lowSetpointBar).toBe(0.7);
    expect(ccr.setpointDeactivationDepthM).toBe(6);
    expect("diluentBailout" in ccr).toBe(false);
    expect("diluentPreBailoutUseL" in ccr).toBe(false);
    const dilOut = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr", diluentBailout: true, diluentPreBailoutUseL: 150 }, []).input;
    expect(dilOut).toMatchObject({ diluentBailout: true, diluentPreBailoutUseL: 150 });
    const blank = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr", diluentBailout: true }, []).input;
    expect("diluentPreBailoutUseL" in blank).toBe(false);
  });

  it("charges the bottom RMV until the first stop for new open-water OC plans only", () => {
    const oc = resolvePlanInput(DEFAULT_PLAN_DRAFT, []).input;
    expect(oc.mode === "oc" && oc.decoRmvFrom).toBe("first-stop");
    const gasOnly = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), gasPlanning: "gas-only" }, []).input;
    expect(gasOnly.mode === "oc" && gasOnly.decoRmvFrom).toBe("first-stop");
    const off = resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), bottomRmvUntilFirstStop: false }, []).input;
    expect("decoRmvFrom" in off).toBe(false);
    expect("decoRmvFrom" in resolvePlanInput(DEFAULT_PLAN_DRAFT, [], "cave").input).toBe(false);
    expect("decoRmvFrom" in resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), mode: "ccr" }, []).input).toBe(false);
  });

  it("adds only the default draft's climb volume to its bottom gas", () => {
    const legacy = calculateDivePlan(resolvePlanInput({ ...structuredClone(DEFAULT_PLAN_DRAFT), bottomRmvUntilFirstStop: false }, []).input);
    const current = calculateDivePlan(resolvePlanInput(DEFAULT_PLAN_DRAFT, []).input);
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
    const resolved = resolvePlanInput(next, [tank]).input;
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
