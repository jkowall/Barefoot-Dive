import { describe, expect, it } from "vitest";
import { calculateCavePlan, type CavePlanInput, type CavePlanResult } from "../cave";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import type { Diagnostic } from "../domain/types";
import { barAbsolute, barGauge, liters, meters, seconds } from "../domain/units";
import { collectCaveDiagnostics, formatCaveCeilingViolation } from "./caveDiagnostics";
import type { RouteDraft } from "./caveWorkspace";

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

const route = (entries: readonly [string, number, number][]): readonly RouteDraft[] => entries.map(([id, startDepthM, endDepthM]) => ({
  id, startDepthM, endDepthM, durationMinutes: 5, distanceM: 60, propulsion: "fins", stageAction: "none",
}));
const ceiling = (depthM: number): Diagnostic => ({
  code: "EXPOSURE_CEILING_VIOLATION",
  severity: "error",
  message: "Internal engine message.",
  field: "events.5.endDepthM",
  depthM: meters(depthM),
  limit: meters(1.4),
  runtimeSeconds: seconds(50 * 60),
});
const basicDive: CavePlanInput["dive"] = {
  mode: "oc",
  environment: "cave",
  depthM: meters(40),
  bottomTimeSeconds: seconds(30 * 60),
  bottomGas: { ...AIR, cylinderId: "back" },
  decoGases: [],
  cylinders: [{
    id: "back", name: "Back gas", waterVolumeL: liters(100), workingPressureBar: barGauge(300), currentPressureBar: barGauge(300),
    gas: { ...AIR, cylinderId: "back" }, maximumPPO2: barAbsolute(1.4), revision: 1,
  }],
  settings: DEFAULT_PLANNER_SETTINGS,
  environmentSettings: DEFAULT_ENVIRONMENT,
  rmv: DEFAULT_RMV,
  reservePolicy: DEFAULT_RESERVE_POLICY,
};

describe("formatCaveCeilingViolation", () => {
  it("names the entrance exit and prints the conservative ceiling in display units", () => {
    const diagnostic = ceiling(0);
    expect(formatCaveCeilingViolation(diagnostic, { route: route([["entrance", 0, 9], ["scooter", 9, 18], ["tunnel", 18, 21]]), dive: basicDive, units: "imperial" }))
      .toBe("The exit of leg “entrance” ends at 0 ft at 50:00, above the 5 ft decompression ceiling there.");
    expect(formatCaveCeilingViolation(diagnostic, { route: route([["entrance", 0, 9]]), dive: basicDive, units: "metric" }))
      .toContain("above the 2 m decompression ceiling");
  });

  it("names ascending outbound matches as penetration, not exit", () => {
    expect(formatCaveCeilingViolation(ceiling(18), {
      route: route([["up-tunnel", 30, 18]]),
      dive: basicDive,
      units: "imperial",
    })).toBe("The penetration of leg “up-tunnel” ends at 59 ft at 50:00, above the 5 ft decompression ceiling there.");
  });

  it("does not name a leg for duplicate, non-endpoint, or switch-depth matches", () => {
    const duplicated = formatCaveCeilingViolation(ceiling(0), { route: route([["one", 0, 9], ["two", 0, 18]]), dive: basicDive, units: "imperial" });
    const between = formatCaveCeilingViolation(ceiling(5), { route: route([["one", 0, 9]]), dive: basicDive, units: "imperial" });
    const travelDive = { ...basicDive, travelGas: { ...AIR, id: "travel", cylinderId: "back" }, bottomGas: { ...basicDive.bottomGas, switchDepthM: meters(6) } };
    const travelSplit = formatCaveCeilingViolation(ceiling(6), { route: route([["switch", 6, 18]]), dive: travelDive, units: "imperial" });
    const ccrDive: CavePlanInput["dive"] = {
      mode: "ccr", environment: "cave", depthM: meters(18), bottomTimeSeconds: seconds(60),
      diluent: AIR, setpointBar: barAbsolute(1.3), lowSetpointBar: barAbsolute(.7),
      setpointActivationDepthM: meters(6), setpointDeactivationDepthM: meters(9), bailoutGases: [],
      cylinders: [], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const ccrSwitches = [
      formatCaveCeilingViolation(ceiling(6), { route: route([["up", 6, 18]]), dive: ccrDive, units: "imperial" }),
      formatCaveCeilingViolation(ceiling(9), { route: route([["down", 9, 18]]), dive: ccrDive, units: "imperial" }),
    ];
    expect([duplicated, between, travelSplit, ...ccrSwitches]).toEqual(expect.arrayContaining([
      expect.stringMatching(/^An explicit route leg ends/),
    ]));
    expect([duplicated, between, travelSplit, ...ccrSwitches].every((message) => !message?.includes("The exit of leg"))).toBe(true);
  });

  it("uses a cave calculation diagnostic end to end", () => {
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: basicDive,
      route: [
        { id: "entrance", startDepthM: meters(0), endDepthM: meters(40), durationSeconds: seconds(120), distanceM: meters(60), propulsion: "fins", accessibleCylinderIds: ["back"] },
        { id: "deep", startDepthM: meters(40), endDepthM: meters(40), durationSeconds: seconds(30 * 60), distanceM: meters(60), propulsion: "fins", accessibleCylinderIds: ["back"] },
      ],
      scenarios: [],
    };
    const calculated = calculateCavePlan(input);
    expect(calculated.ok).toBe(false);
    if (calculated.ok) return;
    const diagnostic = calculated.errors.find((item) => item.code === "EXPOSURE_CEILING_VIOLATION");
    expect(diagnostic).toBeDefined();
    expect(formatCaveCeilingViolation(diagnostic!, { route: route([["entrance", 0, 40], ["deep", 40, 40]]), dive: input.dive, units: "imperial" }))
      .toContain("The exit of leg “entrance”");
  });
});
