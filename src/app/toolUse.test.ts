import { describe, expect, it } from "vitest";
import { DEFAULT_PLAN_DRAFT, type PlanDraft } from "./planning";
import { applyToolPlanPatch, describeToolPlanPatch, toolPlanPatchError, type ToolPlanPatch } from "./toolUse";

const customizedDraft = (): PlanDraft => ({
  ...structuredClone(DEFAULT_PLAN_DRAFT),
  mode: "oc",
  depthM: 67,
  bottomTimeMinutes: 31,
  gfLowPercent: 25,
  gfHighPercent: 75,
  bottomRmvLpm: 18,
  decoRmvLpm: 14,
  bailoutRmvLpm: 33,
  bailoutDecoRmvLpm: 22,
  bottomGas: {
    ...DEFAULT_PLAN_DRAFT.bottomGas,
    name: "Current Tx",
    oxygenPercent: 18,
    heliumPercent: 45,
    cylinderId: "bank-doubles",
  },
  reserve: { kind: "fixed", minimumPressureBar: 40 },
});

describe("exact Tools plan patches", () => {
  it("copies only a Best Mix result and clears an incompatible cylinder", () => {
    const before = customizedDraft();
    const patch: ToolPlanPatch = {
      kind: "best-mix",
      name: "Best mix Tx20/43",
      oxygenPercent: 20,
      heliumPercent: 43,
    };
    const after = applyToolPlanPatch(before, patch);

    expect(after.bottomGas).toEqual({
      ...before.bottomGas,
      name: "Best mix Tx20/43",
      oxygenPercent: 20,
      heliumPercent: 43,
      cylinderId: undefined,
    });
    expect({ ...after, bottomGas: before.bottomGas }).toEqual(before);
    expect(describeToolPlanPatch(before, patch)).toContain("will be cleared");
  });

  it("preserves a cylinder only when App resolves an exact Tank Bank match", () => {
    const before = customizedDraft();
    const after = applyToolPlanPatch(before, {
      kind: "best-mix",
      name: "Analyzed Tx18/45",
      oxygenPercent: 18,
      heliumPercent: 45,
      preserveCylinderId: "bank-doubles",
    });
    expect(after.bottomGas.cylinderId).toBe("bank-doubles");
  });

  it.each([
    ["bottomRmvLpm", "oc"],
    ["decoRmvLpm", "oc"],
    ["bailoutRmvLpm", "ccr"],
    ["bailoutDecoRmvLpm", "ccr"],
  ] as const)("patches only %s for %s", (target, mode) => {
    const before = { ...customizedDraft(), mode };
    const after = applyToolPlanPatch(before, { kind: "rmv", target, valueLpm: 17.5 });
    expect(after[target]).toBe(17.5);
    expect({ ...after, [target]: before[target] }).toEqual(before);
  });

  it("copies only rock-bottom assumptions, not a calculated pressure or schedule", () => {
    const before = customizedDraft();
    const after = applyToolPlanPatch(before, {
      kind: "rock-bottom",
      teamSize: 3,
      stressedRmvLpm: 42,
    });
    expect(after.reserve).toEqual({ kind: "rock-bottom", teamSize: 3, stressedRmvLpm: 42 });
    expect({ ...after, reserve: before.reserve }).toEqual(before);
    expect(describeToolPlanPatch(before, { kind: "rock-bottom", teamSize: 3, stressedRmvLpm: 42 })).toContain("not copied");
  });

  it("rejects patches that do not map exactly to the current mode", () => {
    const ccr = { ...customizedDraft(), mode: "ccr" as const };
    expect(toolPlanPatchError(ccr, { kind: "best-mix", name: "Tx", oxygenPercent: 20, heliumPercent: 40 })).toMatch(/open-circuit/);
    expect(toolPlanPatchError(ccr, { kind: "rock-bottom", teamSize: 2, stressedRmvLpm: 40 })).toMatch(/open-circuit/);
    expect(toolPlanPatchError(ccr, { kind: "rmv", target: "bottomRmvLpm", valueLpm: 20 })).toMatch(/breathing mode/);
    expect(toolPlanPatchError(customizedDraft(), { kind: "rmv", target: "bailoutRmvLpm", valueLpm: 20 })).toMatch(/breathing mode/);
    expect(toolPlanPatchError(customizedDraft(), { kind: "best-mix", name: "Invalid", oxygenPercent: 80, heliumPercent: 30 })).toMatch(/fractions/);
  });
});
