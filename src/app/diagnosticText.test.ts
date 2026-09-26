import { describe, expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import type { CcrDiveInput, Diagnostic, OcDiveInput } from "../domain/types";
import { barAbsolute, fraction, meters, seconds } from "../domain/units";
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
    const diagnostic: Diagnostic = { code: "EXAMPLE", severity: "warning", message: "Checked 121.3 min in; hypoxic at 21.3 m.", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe("Checked 121.3 min in; hypoxic at 70 ft.");
    const mentioned: Diagnostic = {
      code: "EXAMPLE",
      severity: "warning",
      message: "Between 11.5 min and 1.5 m.",
      depthMentions: [{ valueM: meters(1.5), rounding: "nearest" }],
    };
    expect(formatDiagnostic(mentioned, "imperial")).toBe("Between 11.5 min and 5 ft.");
  });

  it("restates every depth of a multi-depth warning saved before depth mentions existed", () => {
    // Saved by 0.5.1 and earlier: every depth printed to the nearest 0.1 m, no depthMentions.
    const switchDown: Diagnostic = {
      code: "CCR_SWITCH_DOWN_DEEPENED",
      severity: "warning",
      message: "The loop cannot hold the 1.30 bar high setpoint shallower than 3.6 m, so the plan switches to the low setpoint at 3.6 m instead of 0.0 m.",
      field: "setpointDeactivationDepthM",
      depthM: meters(3.627),
      actual: 0,
      limit: 3.627,
    };
    expect(formatDiagnostic(switchDown, "imperial")).toBe(
      "The loop cannot hold the 1.30 bar high setpoint shallower than 12 ft, so the plan switches to the low setpoint at 12 ft instead of 0 ft.",
    );
    const gap: Diagnostic = {
      code: "CCR_BAILOUT_COVERAGE_GAP",
      severity: "error",
      message: "No bailout gas is breathable between 21.3 m and 45.0 m. Add a bailout gas for that range or adjust switch depths.",
      field: "bailoutGases",
      depthM: meters(45),
      actual: 21.336,
      limit: 45,
    };
    expect(formatDiagnostic(gap, "imperial")).toBe("No bailout gas is breathable between 70 ft and 148 ft. Add a bailout gas for that range or adjust switch depths.");
  });

  it("keeps a message in metres rather than mixing units when a depth cannot be restated", () => {
    const diagnostic: Diagnostic = { code: "EXAMPLE", severity: "warning", message: "Switch at 6.1 m, then stop at 9.0 m.", depthM: meters(6.096) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe(diagnostic.message);
    // "21.3 m" inside "121.3 m" is not that depth; converting it would print "170 ft".
    const longer: Diagnostic = { code: "EXAMPLE", severity: "warning", message: "Checked at 121.3 m; hypoxic at 21.3 m.", depthM: meters(21.336) };
    expect(formatDiagnostic(longer, "imperial")).toBe(longer.message);
    // A gas name that reads like a depth does not hold a message back in metres.
    const named: Diagnostic = { code: "EXAMPLE", severity: "error", message: "EAN50 21 m is hypoxic on open circuit at 21.3 m.", depthM: meters(21.336) };
    expect(formatDiagnostic(named, "imperial")).toBe("EAN50 21 m is hypoxic on open circuit at 70 ft.");
  });

  it("leaves minutes that print like the depth alone", () => {
    // RESERVE_CROSSED prints the crossing depth and runtime with one decimal each.
    const diagnostic: Diagnostic = { code: "RESERVE_CROSSED", severity: "error", message: "Tx18/45 cylinder crosses reserve at 21.3 m and 21.3 min.", depthM: meters(21.336) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe("Tx18/45 cylinder crosses reserve at 70 ft and 21.3 min.");
  });

  it("restates the travel-to-bottom switch depth in feet", () => {
    const input: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(70),
      bottomTimeSeconds: seconds(20 * 60),
      bottomGas: { id: "tx10-70", name: "Tx10/70", oxygen: fraction(0.1), helium: fraction(0.7), role: "bottom", switchDepthM: meters(60) },
      travelGas: { ...AIR, id: "travel-air", role: "travel" },
      decoGases: [],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = validateDiveInput(input);
    const diagnostic = (result.ok ? [] : result.errors).find((item) => item.code === "TRAVEL_GAS_OPERATING_RANGE");
    expect(diagnostic).toBeDefined();
    expect(formatDiagnostic(diagnostic!, "imperial")).toBe("Air reaches PPO₂ 1.470 bar at the 197 ft travel-to-bottom switch, above the 1.40 bar travel-gas limit.");
  });

  it("leaves messages without a depth unchanged", () => {
    const diagnostic: Diagnostic = { code: "EXAMPLE", severity: "error", message: "Reaches PPO₂ 1.60 bar at target depth.", depthM: meters(45) };
    expect(formatDiagnostic(diagnostic, "imperial")).toBe(diagnostic.message);
  });
});
