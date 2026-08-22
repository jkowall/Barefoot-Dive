import { describe, expect, it } from "vitest";
import type { CavePlanResult } from "../cave";
import type { Diagnostic } from "../domain/types";
import { liters } from "../domain/units";
import { collectCaveDiagnostics } from "./caveDiagnostics";

const result = (diagnostics: readonly Diagnostic[], safe = false): CavePlanResult => ({
  experimental: true,
  base: {} as CavePlanResult["base"],
  route: {} as CavePlanResult["route"],
  exitTimeline: [],
  gasLedger: [],
  limitingResource: "none",
  reserveMarginL: liters(0),
  scenarios: [{ kind: "stage-failure", diagnostics, safe }],
});

describe("collectCaveDiagnostics", () => {
  it("promotes nested scenario errors into snapshot diagnostics", () => {
    const diagnostics = collectCaveDiagnostics([], result([{
      code: "STAGE_FAILURE_TARGET_REQUIRED",
      severity: "error",
      message: "A stage target is required.",
    }]));
    expect(diagnostics).toEqual([expect.objectContaining({
      code: "STAGE_FAILURE_TARGET_REQUIRED",
      severity: "error",
      field: "scenarios.0",
    })]);
    expect(diagnostics[0].message).toContain("stage failure");
  });

  it("fails closed when an unsafe scenario has no explicit error", () => {
    expect(collectCaveDiagnostics([], result([], false))).toEqual([expect.objectContaining({
      code: "CAVE_SCENARIO_UNSAFE",
      severity: "error",
    })]);
  });
});
