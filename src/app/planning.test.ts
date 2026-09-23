import { describe, expect, it } from "vitest";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
import type { TankRecord } from "../storage";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput } from "./planning";

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
});
