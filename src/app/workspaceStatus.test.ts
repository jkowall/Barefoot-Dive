import { describe, expect, it } from "vitest";
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

  it("changes a session only when it has an unmarked calculation", () => {
    const empty = { attemptedInputSignature: "input-a" };
    expect(invalidateForUnavailableSource(empty)).toBe(empty);
    const marked = { calculated: { ...calculated, sourceInvalidated: true }, extra: "kept" };
    expect(invalidateForUnavailableSource(marked)).toBe(marked);
    expect(invalidateForUnavailableSource({ calculated, extra: "kept" })).toMatchObject({ extra: "kept", calculated: { sourceInvalidated: true } });
  });
});
