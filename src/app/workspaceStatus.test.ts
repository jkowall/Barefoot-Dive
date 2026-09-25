import { describe, expect, it } from "vitest";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
import type { TankRecord } from "../storage";
import { DEFAULT_PLAN_DRAFT, tankSourceSignature, type PlanDraft } from "./planning";
import { invalidateForUnavailableSource, workspaceStatus, type WorkspaceCalculation } from "./workspaceStatus";

const calculated: WorkspaceCalculation = { inputSignature: "input-a", sourceSignature: "source-a" };

describe("workspace status", () => {
  it.each([
    ["source-unavailable", { inputSignature: undefined, sourceSignature: "source-a", calculated }],
    ["draft", { inputSignature: "input-a", sourceSignature: "source-a" }],
    ["current", { inputSignature: "input-a", sourceSignature: "source-a", calculated }],
    ["updating", { inputSignature: "input-b", sourceSignature: "source-a", calculated }],
    ["source-changed", { inputSignature: "input-b", sourceSignature: "source-b", calculated }],
    ["needs-attention", { inputSignature: "input-b", sourceSignature: "source-b", calculated, attemptedInputSignature: "input-b" }],
    ["needs-attention", { inputSignature: "input-b", sourceSignature: "source-a", attemptedInputSignature: "input-b" }],
  ] as const)("reports %s", (expected, state) => {
    expect(workspaceStatus(state)).toBe(expected);
  });

  it("keeps a result superseded after its source returns unchanged, until an explicit recalculation", () => {
    const session = { calculated, attemptedInputSignature: "input-a" };
    const unchanged = { inputSignature: "input-a", sourceSignature: "source-a" };
    expect(workspaceStatus({ ...unchanged, ...session })).toBe("current");

    // The source became unavailable: the session is marked while no input exists.
    const invalidated = invalidateForUnavailableSource(session);
    expect(invalidated).toEqual({ calculated: { ...calculated, sourceInvalidated: true }, attemptedInputSignature: undefined });
    expect(workspaceStatus({ inputSignature: undefined, sourceSignature: "source-a", ...invalidated })).toBe("source-unavailable");

    // The identical record and input return, but the old result stays hidden behind an explicit Update.
    expect(workspaceStatus({ ...unchanged, ...invalidated })).toBe("source-changed");
    // A failed Update reports its diagnostics; a successful one replaces the calculation.
    expect(workspaceStatus({ ...unchanged, ...invalidated, attemptedInputSignature: "input-a" })).toBe("needs-attention");
    expect(workspaceStatus({ ...unchanged, calculated, attemptedInputSignature: "input-a" })).toBe("current");
  });

  it("asks for an explicit update only when a cylinder the calculation used changed in Tank Bank", () => {
    const stage = (revision: number): TankRecord => ({
      id: "o2-stage",
      name: "O₂ stage",
      waterVolumeL: liters(7),
      workingPressureBar: barGauge(200),
      currentPressureBar: barGauge(200),
      gas: { id: "bank-o2", name: "Oxygen", oxygen: fraction(1), helium: fraction(0), role: "deco" },
      maximumPPO2: barAbsolute(1.6),
      revision,
      createdAt: "2026-09-25T00:00:00.000Z",
      updatedAt: "2026-09-25T00:00:00.000Z",
    });
    const [ean50, oxygen] = DEFAULT_PLAN_DRAFT.decoGases;
    const used: PlanDraft = { ...DEFAULT_PLAN_DRAFT, decoGases: [ean50!, { ...oxygen!, cylinderId: "o2-stage" }] };
    const off: PlanDraft = { ...used, decoGases: [ean50!, { ...oxygen!, cylinderId: "o2-stage", enabled: false }] };
    const status = (calculatedDraft: PlanDraft, draft: PlanDraft, inputSignature: string) => workspaceStatus({
      inputSignature,
      sourceSignature: tankSourceSignature(draft, [stage(2)]),
      calculated: { inputSignature: "input-a", sourceSignature: tankSourceSignature(calculatedDraft, [stage(1)]) },
    });
    // The switched-off gas's cylinder changed: the result stays current, and the next edit recalculates.
    expect(status(off, off, "input-a")).toBe("current");
    expect(status(off, off, "input-b")).toBe("updating");
    expect(status(off, used, "input-b")).toBe("updating");
    // A cylinder the calculation used changed: the next edit waits for an explicit update.
    expect(status(used, used, "input-b")).toBe("source-changed");
  });

  it("changes a session only when it has an unmarked calculation", () => {
    const empty = { attemptedInputSignature: "input-a" };
    expect(invalidateForUnavailableSource(empty)).toBe(empty);
    const marked = { calculated: { ...calculated, sourceInvalidated: true }, extra: "kept" };
    expect(invalidateForUnavailableSource(marked)).toBe(marked);
    expect(invalidateForUnavailableSource({ calculated, extra: "kept" })).toMatchObject({ extra: "kept", calculated: { sourceInvalidated: true } });
  });
});
