import { describe, expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import type { CcrDiveInput, Diagnostic } from "../domain/types";
import { barAbsolute, meters, seconds } from "../domain/units";
import { validateDiveInput } from "../domain/validation";
import { formatDiagnostic } from "./diagnosticText";

describe("diagnostic depths in the user's unit", () => {
  it("leaves metric messages unchanged", () => {
    const diagnostic: Diagnostic = { code: "OC_GAS_HYPOXIC", severity: "error", message: "Tx10/70 is hypoxic on open circuit at 21.3 m.", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "metric")).toBe(diagnostic.message);
  });

  it("restates a printed depthM in whole feet from its exact value", () => {
    const diagnostic: Diagnostic = { code: "OC_GAS_HYPOXIC", severity: "error", message: "Tx10/70 is hypoxic on open circuit at 21.3 m (PPO₂ 0.31 bar).", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe("Tx10/70 is hypoxic on open circuit at 70 ft (PPO₂ 0.31 bar).");
  });

  it("restates explicit depth mentions in order with their rounding", () => {
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(45),
      bottomTimeSeconds: seconds(30 * 60),
      diluent: { ...AIR, id: "dil", role: "diluent" },
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      lowSetpointBar: barAbsolute(0.7),
      setpointDeactivationDepthM: meters(3),
      bailoutGases: [{ ...AIR, id: "bo", role: "bailout" }],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const warning = validateDiveInput(input).warnings.find((item) => item.code === "CCR_SWITCH_DOWN_DEEPENED");
    expect(warning).toBeDefined();
    // 3.627 m is a minimum, so it rounds up to 12 ft; the entered 3 m is 10 ft.
    expect(formatDiagnostic(warning!, "imperial")).toBe(
      "The loop cannot hold the 1.30 bar high setpoint shallower than 12 ft, so the plan switches to the low setpoint at 12 ft instead of 10 ft.",
    );
  });

  it("keeps the metre message when a mention cannot be matched", () => {
    const diagnostic: Diagnostic = {
      code: "EXAMPLE",
      severity: "warning",
      message: "A depth printed differently: 3.63 m.",
      depthMentions: [{ valueM: meters(3.627), rounding: "up" }],
    };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe(diagnostic.message);
  });

  it("converts only whole printed depths, never the tail of a longer number", () => {
    const diagnostic: Diagnostic = { code: "EXAMPLE", severity: "warning", message: "Checked at 121.3 m; hypoxic at 21.3 m.", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe("Checked at 121.3 m; hypoxic at 70 ft.");
    const mentioned: Diagnostic = {
      code: "EXAMPLE",
      severity: "warning",
      message: "Between 11.5 m and 1.5 m.",
      depthMentions: [{ valueM: meters(1.5), rounding: "nearest" }],
    };
    expect(formatDiagnostic(mentioned, "imperial")).toBe("Between 11.5 m and 5 ft.");
  });

  it("leaves minutes that print like the depth alone", () => {
    // RESERVE_CROSSED prints the crossing depth and runtime with one decimal each.
    const diagnostic: Diagnostic = { code: "RESERVE_CROSSED", severity: "error", message: "Tx18/45 cylinder crosses reserve at 21.3 m and 21.3 min.", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe("Tx18/45 cylinder crosses reserve at 70 ft and 21.3 min.");
  });

  it("leaves messages without a depth unchanged", () => {
    const diagnostic: Diagnostic = { code: "EXAMPLE", severity: "error", message: "Reaches PPO₂ 1.60 bar at target depth.", depthM: meters(45) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe(diagnostic.message);
  });
});
