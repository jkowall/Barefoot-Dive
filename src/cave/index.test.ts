import { describe, expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV, OXYGEN } from "../domain/defaults";
import type { CavePlanInput, RouteLeg } from "./index";
import { calculateCavePlan } from "./index";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";

const leg = (id: string, startDepthM: number, endDepthM: number, propulsion: RouteLeg["propulsion"] = "fins"): RouteLeg => ({
  id, startDepthM: meters(startDepthM), endDepthM: meters(endDepthM), durationSeconds: seconds(60), distanceM: meters(20), propulsion, accessibleCylinderIds: ["back"],
});

describe("cave route planning", () => {
  it("builds a deterministic OC penetration and reverse exit timeline", () => {
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "thirds" },
      dive: { mode: "oc", environment: "open-water", depthM: meters(30), bottomTimeSeconds: seconds(60), bottomGas: AIR, decoGases: [], cylinders: [{ id: "back", name: "Back gas", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: AIR, maximumPPO2: barAbsolute(1.4), revision: 1 }], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [leg("in", 0, 30, "scooter")], maximumPenetrationDistanceM: meters(100), maximumPenetrationTimeSeconds: seconds(600), turnPressureBar: barGauge(70),
    };
    const first = calculateCavePlan(input); const second = calculateCavePlan(input);
    expect(first).toEqual(second); expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.experimental).toBe(true); expect(first.value.exitTimeline[0].startDepthM).toBe(30);
    expect(first.value.base.segments.some((segment) => segment.kind === "penetration")).toBe(true);
    expect(first.value.base.segments.some((segment) => segment.kind === "exit")).toBe(true);
    expect(first.value.scenarios.map((scenario) => scenario.kind)).toEqual(["oc-lost-gas", "lost-buddy", "scooter-failure", "stage-failure"]);
  });

  it("models CCR loop failure as an independent bailout plan", () => {
    const diluent = { ...AIR, id: "diluent", role: "diluent" as const, oxygen: fraction(0.18) };
    const bailout = { ...AIR, id: "bailout", role: "bailout" as const, cylinderId: "bailout-cylinder" };
    const input: CavePlanInput = {
      mode: "ccr", reserve: { kind: "custom", reserveVolumeL: liters(500) },
      dive: { mode: "ccr", environment: "open-water", depthM: meters(30), bottomTimeSeconds: seconds(120), diluent, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [bailout], cylinders: [{ id: "back", name: "Back gas", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: diluent, maximumPPO2: barAbsolute(1.4), revision: 1 }, { id: "bailout-cylinder", name: "Bailout", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bailout, maximumPPO2: barAbsolute(1.6), revision: 1 }], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [{ ...leg("deep", 6, 30), accessibleCylinderIds: ["back", "bailout-cylinder"] }], scenarios: [{ kind: "ccr-loop-failure", targetLegId: "deep" }],
    };
    const result = calculateCavePlan(input); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarios).toHaveLength(1); expect(result.value.scenarios[0].plan).toBeDefined();
    expect(result.value.scenarios[0].plan).not.toBe(result.value.base);
    expect(result.value.scenarios[0].plan?.gasLedger.some((entry) => entry.gasId === bailout.id && entry.totalUsedL > 0)).toBe(true);
  });

  it("activates and deactivates the CCR setpoint when a cave route begins at the surface", () => {
    const diluent = { ...AIR, id: "surface-diluent", role: "diluent" as const, cylinderId: "diluent-cylinder" };
    const bailout = { ...AIR, id: "surface-bailout", role: "bailout" as const, cylinderId: "surface-bailout-cylinder" };
    const input: CavePlanInput = {
      mode: "ccr",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(35) },
      dive: {
        mode: "ccr", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(120),
        diluent, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [bailout],
        cylinders: [
          { id: "diluent-cylinder", name: "Diluent", waterVolumeL: liters(3), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: diluent, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "surface-bailout-cylinder", name: "Bailout", waterVolumeL: liters(20), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bailout, maximumPPO2: barAbsolute(1.6), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("surface-entry", 0, 30), accessibleCylinderIds: ["diluent-cylinder", "surface-bailout-cylinder"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.base.segments.some((segment) => segment.setpointBar === barAbsolute(1.3))).toBe(true);
    expect(result.value.base.segments.at(0)?.setpointBar).toBeUndefined();
    expect(result.value.base.segments.at(-1)?.setpointBar).toBeUndefined();
  });

  it("runs every OC failure scenario with actual accessible-gas transformations", () => {
    const bottom = { ...AIR, id: "back-air", cylinderId: "back", switchDepthM: meters(10) };
    const stageGas = { ...AIR, id: "stage-air", name: "Stage air", role: "travel" as const, cylinderId: "stage" };
    const routeLeg: RouteLeg = {
      ...leg("scooter-stage", 0, 20, "scooter"),
      accessibleCylinderIds: ["back", "stage"],
      stageAction: "drop",
      stageCylinderId: "stage",
    };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "thirds" },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(20), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, travelGas: stageGas, decoGases: [],
        cylinders: [
          { id: "back", name: "Back gas", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(220), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "stage", name: "Stage", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: stageGas, maximumPPO2: barAbsolute(1.4), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [routeLeg],
      scenarios: [
        { kind: "oc-lost-gas", targetLegId: routeLeg.id },
        { kind: "lost-buddy", targetLegId: routeLeg.id },
        { kind: "scooter-failure", targetLegId: routeLeg.id },
        { kind: "stage-failure", targetLegId: routeLeg.id },
      ],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarios).toHaveLength(4);
    expect(result.value.scenarios.every((scenario) => scenario.plan)).toBe(true);
    const lostGas = result.value.scenarios.find((scenario) => scenario.kind === "oc-lost-gas")?.plan;
    expect(lostGas?.segments.some((segment) => segment.kind === "exit" && segment.gasId === stageGas.id)).toBe(true);
    const scooter = result.value.scenarios.find((scenario) => scenario.kind === "scooter-failure")?.plan;
    expect(scooter?.segments.filter((segment) => segment.kind === "exit").reduce((sum, segment) => sum + segment.durationSeconds, 0)).toBe(routeLeg.durationSeconds * 2);
  });

  it("returns structured diagnostics for discontinuous and invalid stage routes", () => {
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "sixths" },
      dive: { mode: "oc", environment: "open-water", depthM: meters(20), bottomTimeSeconds: seconds(60), bottomGas: AIR, decoGases: [], cylinders: [], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [{ ...leg("a", 0, 10), stageAction: "recover", stageCylinderId: "missing" }, leg("b", 12, 20)],
    };
    const result = calculateCavePlan(input); expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["LEG_DISCONTINUITY", "CYLINDER_INACCESSIBLE", "STAGE_RECOVERY_ORDER"]));
  });

  it("validates scenario target distance instead of silently ignoring it", () => {
    const bottom = { ...AIR, cylinderId: "back" };
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "fixed", minimumPressureBar: barGauge(35) },
      dive: { mode: "oc", environment: "open-water", depthM: meters(20), bottomTimeSeconds: seconds(60), bottomGas: bottom, decoGases: [], cylinders: [{ id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [{ ...leg("a", 0, 20), accessibleCylinderIds: ["back"] }], scenarios: [{ kind: "lost-buddy", targetDistanceM: meters(100) }],
    };
    const result = calculateCavePlan(input); expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.scenarios[0].safe).toBe(false);
    expect(result.value.scenarios[0].diagnostics.some((item) => item.code === "SCENARIO_TARGET_INVALID")).toBe(true);
  });

  it("rejects an overhead exit profile that crosses its calculated ceiling", () => {
    const bottom = { ...AIR, cylinderId: "large-back" };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(40), bottomTimeSeconds: seconds(30 * 60),
        bottomGas: bottom, decoGases: [],
        cylinders: [{ id: "large-back", name: "Large back gas", waterVolumeL: liters(100), workingPressureBar: barGauge(300), currentPressureBar: barGauge(300), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [
        { ...leg("down", 0, 40), durationSeconds: seconds(120), accessibleCylinderIds: ["large-back"] },
        { ...leg("deep", 40, 40), durationSeconds: seconds(30 * 60), accessibleCylinderIds: ["large-back"] },
      ],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "EXPOSURE_CEILING_VIOLATION")).toBe(true);
  });

  it("rejects a base cave leg when the breathing cylinder is not accessible", () => {
    const bottom = { ...AIR, id: "inaccessible-bottom", cylinderId: "back" };
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: { mode: "oc", environment: "cave", depthM: meters(20), bottomTimeSeconds: seconds(60), bottomGas: bottom, decoGases: [], cylinders: [{ id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [{ ...leg("in", 0, 20), accessibleCylinderIds: [] }], scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "CYLINDER_INACCESSIBLE")).toBe(true);
  });

  it("breathes the only assigned accessible stage on a base route leg", () => {
    const bottom = { ...AIR, id: "stage-route-bottom", cylinderId: "back", switchDepthM: meters(10) };
    const stage = { ...AIR, id: "stage-route-travel", role: "travel" as const, cylinderId: "stage" };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(10), bottomTimeSeconds: seconds(60), bottomGas: bottom, travelGas: stage, decoGases: [],
        cylinders: [
          { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "stage", name: "Stage", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: stage, maximumPPO2: barAbsolute(1.4), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("stage-only", 0, 10), accessibleCylinderIds: ["stage"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.base.segments.filter((segment) => segment.kind === "penetration" || segment.kind === "exit").every((segment) => segment.gasId === stage.id)).toBe(true);
    expect(result.value.turnCylinderId).toBe("stage");
    expect(result.value.maximumPermittedPenetrationDistanceM).toBeGreaterThan(input.route[0].distanceM);
    expect(result.value.maximumPermittedPenetrationDistanceM).toBeLessThan(10_000);
  });

  it("enforces stage drop and recovery state across route legs", () => {
    const stage = { ...AIR, id: "stage-gas", role: "travel" as const, cylinderId: "stage" };
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: { mode: "oc", environment: "cave", depthM: meters(20), bottomTimeSeconds: seconds(60), bottomGas: { ...AIR, id: "back-gas", cylinderId: "back" }, travelGas: stage, decoGases: [], cylinders: [
        { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: { ...AIR, id: "back-gas", cylinderId: "back" }, maximumPPO2: barAbsolute(1.4), revision: 1 },
        { id: "stage", name: "Stage", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: stage, maximumPPO2: barAbsolute(1.4), revision: 1 },
      ], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY },
      route: [{ ...leg("drop", 0, 10), accessibleCylinderIds: ["back", "stage"], stageAction: "drop", stageCylinderId: "stage" }, { ...leg("after-drop", 10, 20), accessibleCylinderIds: ["back", "stage"] }], scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "STAGE_ACCESS_AFTER_DROP")).toBe(true);
  });

  it("derives cave turn pressure from reserve semantics and emergency gas", () => {
    const bottom = { ...AIR, id: "reserve-bottom", cylinderId: "reserve-back" };
    const cylinder = { id: "reserve-back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 };
    const dive = { mode: "oc" as const, environment: "cave" as const, depthM: meters(30), bottomTimeSeconds: seconds(60), bottomGas: bottom, decoGases: [], cylinders: [cylinder], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY };
    const route = [{ ...leg("in", 0, 30), durationSeconds: seconds(60), accessibleCylinderIds: ["reserve-back"] }];
    const expected: readonly [CavePlanInput["reserve"], number, number][] = [
      [{ kind: "thirds" }, 133.3333333333, 68.75],
      [{ kind: "sixths" }, 166.6666666667, 135.4166666667],
      [{ kind: "fixed", minimumPressureBar: barGauge(35) }, 37.0833333333, 37.0833333333],
      [{ kind: "custom", reserveVolumeL: liters(500) }, 22.9166666667, 22.9166666667],
      [{ kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(30) }, 8.3333333333, 8.3333333333],
    ];
    for (const [reserve, turnPressure, minimumAtTurn] of expected) {
      const result = calculateCavePlan({ mode: "oc", dive, route, reserve, scenarios: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.turnPressureBar).toBeCloseTo(turnPressure, 6);
      expect(result.value.minimumRequiredAtTurnPressureBar).toBeCloseTo(minimumAtTurn, 6);
      expect(result.value.turnPressureBar).toBeGreaterThan(0);
    }
  });

  it("does not use a deco cylinder that is inaccessible at a submerged entrance", () => {
    const bottom = { ...AIR, id: "submerged-back-gas", cylinderId: "back" };
    const oxygen = { ...OXYGEN, id: "inaccessible-o2", cylinderId: "o2", switchDepthM: meters(6) };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, decoGases: [oxygen],
        cylinders: [
          { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "o2", name: "Oxygen stage", waterVolumeL: liters(7), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: oxygen, maximumPPO2: barAbsolute(1.6), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("submerged-entry", 10, 30), accessibleCylinderIds: ["back"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    if (!result.ok) return;
    expect(result.value.base.segments.filter((segment) => segment.kind === "ascent").every((segment) => segment.gasId !== oxygen.id)).toBe(true);
  });

  it("includes the submerged entrance-to-surface ascent in rock-bottom minimum gas", () => {
    const bottom = { ...AIR, id: "rock-bottom-back", cylinderId: "back" };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(30) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, decoGases: [],
        cylinders: [{ id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("submerged-entry", 10, 30), accessibleCylinderIds: ["back"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.minimumRequiredAtTurnPressureBar).toBeGreaterThan(10);
  });

  it("keeps thirds and sixths turn pressure operationally distinct from minimum required gas", () => {
    const bottom = { ...AIR, id: "fractional-back", cylinderId: "back" };
    const dive = {
      mode: "oc" as const, environment: "cave" as const, depthM: meters(30), bottomTimeSeconds: seconds(60),
      bottomGas: bottom, decoGases: [],
      cylinders: [{ id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
      settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    for (const [reserve, expected] of [[{ kind: "thirds" as const }, 200 * 2 / 3], [{ kind: "sixths" as const }, 200 * 5 / 6]] as const) {
      const result = calculateCavePlan({ mode: "oc", dive, route: [{ ...leg("long-exit", 10, 30), durationSeconds: seconds(1800), accessibleCylinderIds: ["back"] }], reserve, scenarios: [] });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.value.turnPressureBar).toBeCloseTo(expected, 6);
      expect(result.value.minimumRequiredAtTurnPressureBar).toBeGreaterThan(expected);
    }
  });

  it("rejects nonfinite cave-only limits before planning", () => {
    const bottom = { ...AIR, id: "nonfinite-bottom", cylinderId: "nonfinite-back" };
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(20), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, decoGases: [],
        cylinders: [{ id: "nonfinite-back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("nonfinite", 0, 20), accessibleCylinderIds: ["nonfinite-back"] }],
      turnPressureBar: Number.NaN as CavePlanInput["turnPressureBar"],
      maximumPenetrationTimeSeconds: Number.POSITIVE_INFINITY as CavePlanInput["maximumPenetrationTimeSeconds"],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toEqual(expect.arrayContaining(["TURN_PRESSURE_INVALID", "PENETRATION_TIME_INVALID"]));
  });

  it("derives CCR penetration limits from the recalculated bailout ledger", () => {
    const makeInput = (bailoutPressureBar: number): CavePlanInput => {
      const diluent = { ...AIR, id: "limit-diluent", role: "diluent" as const, cylinderId: "limit-diluent-cylinder" };
      const bailout = { ...AIR, id: "limit-bailout", role: "bailout" as const, cylinderId: "limit-bailout-cylinder" };
      return {
        mode: "ccr",
        reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
        dive: {
          mode: "ccr", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(60),
          diluent, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [bailout],
          cylinders: [
            { id: "limit-diluent-cylinder", name: "Diluent", waterVolumeL: liters(3), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: diluent, maximumPPO2: barAbsolute(1.4), revision: 1 },
            { id: "limit-bailout-cylinder", name: "Bailout", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(bailoutPressureBar), gas: bailout, maximumPPO2: barAbsolute(1.6), revision: 1 },
          ],
          settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
          rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
        },
        route: [{
          ...leg("ccr-limit-flat", 30, 30),
          durationSeconds: seconds(120),
          distanceM: meters(60),
          accessibleCylinderIds: ["limit-diluent-cylinder", "limit-bailout-cylinder"],
        }],
        scenarios: [],
      };
    };
    const lowGas = calculateCavePlan(makeInput(100));
    const highGas = calculateCavePlan(makeInput(200));
    expect(lowGas.ok).toBe(true);
    expect(highGas.ok).toBe(true);
    if (!lowGas.ok || !highGas.ok) return;
    expect(lowGas.value.turnCylinderId).toBe("limit-bailout-cylinder");
    expect(lowGas.value.limitingCylinderId).toBe("limit-bailout-cylinder");
    expect(lowGas.value.gasLedger.some((entry) => entry.cylinderId === "limit-bailout-cylinder" && entry.totalUsedL > 0)).toBe(true);
    expect(highGas.value.limitingCylinderId).toBe("limit-bailout-cylinder");
    expect(highGas.value.gasLedger.every((entry) => entry.cylinderId === "limit-bailout-cylinder")).toBe(true);
    expect(lowGas.value.maximumPermittedPenetrationDistanceM).toBeDefined();
    expect(lowGas.value.maximumPermittedPenetrationDistanceM!).toBeGreaterThan(0);
    expect(lowGas.value.maximumPermittedPenetrationDistanceM)
      .toBeLessThan(highGas.value.maximumPermittedPenetrationDistanceM!);
  });

  it("recalculates nonlinear decompression at the gas-derived penetration bound", () => {
    const bottom = { ...AIR, id: "nonlinear-bottom", cylinderId: "nonlinear-back" };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, decoGases: [],
        cylinders: [{ id: "nonlinear-back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("nonlinear-flat", 30, 30), durationSeconds: seconds(120), distanceM: meters(60), accessibleCylinderIds: ["nonlinear-back"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.base.stops).toHaveLength(0);
    const maximumDistance = result.value.maximumPermittedPenetrationDistanceM;
    expect(maximumDistance).toBeDefined();
    expect(maximumDistance!).toBeGreaterThan(input.route[0].distanceM);
    const safeScale = maximumDistance! / input.route[0].distanceM * 0.99;
    const unsafeScale = maximumDistance! / input.route[0].distanceM * 1.01;
    const scaled = (scale: number): CavePlanInput => ({
      ...input,
      route: input.route.map((routeLeg) => ({
        ...routeLeg,
        durationSeconds: seconds(routeLeg.durationSeconds * scale),
        distanceM: meters(routeLeg.distanceM * scale),
      })),
    });
    const nearBound = calculateCavePlan(scaled(safeScale));
    expect(nearBound.ok).toBe(true);
    if (!nearBound.ok) return;
    expect(nearBound.value.base.stops.length).toBeGreaterThan(result.value.base.stops.length);
    expect(nearBound.value.base.gasLedger.every((entry) => entry.sufficient)).toBe(true);
    const aboveBound = calculateCavePlan(scaled(unsafeScale));
    expect(aboveBound.ok).toBe(true);
    if (!aboveBound.ok) return;
    expect(
      aboveBound.value.base.safetyStatus === "unsafe" ||
      aboveBound.errors?.some((item) => item.code === "GAS_DISTANCE_LIMIT_EXCEEDED"),
    ).toBe(true);
  });

  it("omits an uncertified maximum without dropping valid turn-cylinder context", () => {
    const bottom = { ...AIR, id: "cap-bottom", cylinderId: "cap-back" };
    const input: CavePlanInput = {
      mode: "oc",
      reserve: { kind: "fixed", minimumPressureBar: barGauge(20) },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(10), bottomTimeSeconds: seconds(60),
        bottomGas: bottom, decoGases: [],
        cylinders: [{ id: "cap-back", name: "Huge test cylinder", waterVolumeL: liters(1_000_000_000), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT,
        rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [{ ...leg("cap-route", 0, 10), accessibleCylinderIds: ["cap-back"] }],
      scenarios: [],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.errors?.some((item) => item.code === "GAS_LIMIT_UNDETERMINED")).toBe(true);
    expect(result.value.maximumPermittedPenetrationDistanceM).toBeUndefined();
    expect(result.value.maximumPermittedPenetrationTimeSeconds).toBeUndefined();
    expect(result.value.turnCylinderId).toBe("cap-back");
    expect(result.value.turnPressureBar).toBeDefined();
    expect(result.value.minimumRequiredAtTurnPressureBar).toBeDefined();
  });
});
