import { describe, expect, it } from "vitest";
import { calculateCavePlan, type CavePlanInput, type RouteLeg } from "../cave";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import {
  buildScenarioRequests,
  defaultScenarioTrigger,
  initialScenarioTriggers,
  isScenarioDistanceValid,
  repairScenarioTriggers,
  scenarioApplicability,
  scenarioTriggerPoint,
} from "./caveScenarios";
import type { RouteDraft } from "./caveWorkspace";
import type { RouteCylinder } from "./caveRoute";

const route: readonly RouteDraft[] = [
  { id: "entry", startDepthM: 0, endDepthM: 10, durationMinutes: 3, distanceM: 60, propulsion: "fins", stageAction: "none" },
  { id: "scooter", startDepthM: 10, endDepthM: 20, durationMinutes: 12, distanceM: 700, propulsion: "scooter", stageAction: "drop", stageGasKey: "stage" },
  { id: "tunnel", startDepthM: 20, endDepthM: 21, durationMinutes: 10, distanceM: 250, propulsion: "fins", stageAction: "none" },
];
const cylinders: readonly RouteCylinder[] = [{ id: "stage", name: "Stage", gases: [{ key: "stage", label: "deco gas Stage" }] }];

describe("cave scenario session helpers", () => {
  it("gates scooter and stage scenarios from the route while CCR remains applicable", () => {
    expect(scenarioApplicability("scooter-failure", [route[0]], cylinders)).toMatchObject({ applicable: false, reason: "Needs a scooter leg" });
    expect(scenarioApplicability("scooter-failure", route, cylinders).eligibleLegIds).toEqual(["scooter"]);
    expect(scenarioApplicability("stage-failure", route, cylinders).eligibleLegIds).toEqual(["scooter"]);
    expect(scenarioApplicability("stage-failure", [{ ...route[1], stageGasKey: "missing" }], cylinders).applicable).toBe(false);
    expect(scenarioApplicability("ccr-loop-failure", [], cylinders).applicable).toBe(true);
  });

  it("uses the last applicable leg as each default", () => {
    expect(defaultScenarioTrigger("lost-buddy", route, cylinders).targetLegId).toBe("tunnel");
    expect(defaultScenarioTrigger("scooter-failure", route, cylinders).targetLegId).toBe("scooter");
    expect(defaultScenarioTrigger("stage-failure", route, cylinders).targetLegId).toBe("scooter");
  });

  it("repairs renamed, removed, resized, and too-short-distance triggers", () => {
    const triggers = { ...initialScenarioTriggers("oc", route), "lost-buddy": { targetLegId: "scooter", targetDistanceM: 100 } };
    const renamed = repairScenarioTriggers({ ...triggers, "lost-buddy": { targetLegId: "scooter-renamed", targetDistanceM: 100 } }, [{ ...route[0] }, { ...route[1], id: "scooter-renamed" }, route[2]], cylinders);
    expect(renamed["lost-buddy"].targetLegId).toBe("scooter-renamed");
    const removed = repairScenarioTriggers(triggers, [route[0], route[2]], cylinders);
    expect(removed["scooter-failure"].targetLegId).toBe("tunnel");
    const resized = repairScenarioTriggers(triggers, [{ ...route[0] }, { ...route[1], distanceM: 20 }, route[2]], cylinders);
    expect(resized["lost-buddy"]).toMatchObject({ targetLegId: "scooter", repairNote: expect.any(String) });
    expect(resized["lost-buddy"].targetDistanceM).toBeUndefined();
    expect(isScenarioDistanceValid({ targetLegId: "entry", targetDistanceM: 0.1 }, route)).toBe(false);
    expect(isScenarioDistanceValid({ targetLegId: "entry", targetDistanceM: 60 }, route)).toBe(true);
  });

  it("builds only enabled applicable requests and exposes interpolated trigger depth", () => {
    const triggers = { ...initialScenarioTriggers("oc", route), "lost-buddy": { targetLegId: "scooter", targetDistanceM: 410 } };
    expect(buildScenarioRequests(["lost-buddy", "scooter-failure", "stage-failure"], route, cylinders, triggers).map((request) => request.kind)).toEqual(["lost-buddy", "scooter-failure", "stage-failure"]);
    expect(buildScenarioRequests(["scooter-failure"], [route[0]], cylinders, triggers)).toEqual([]);
    expect(scenarioTriggerPoint(triggers["lost-buddy"], route)).toMatchObject({ distanceM: 410, depthM: 15 });
  });

  it("initializes each OC scenario on its last eligible leg, not always the route end", () => {
    const triggers = initialScenarioTriggers("oc", route, cylinders);
    expect(triggers["lost-buddy"].targetLegId).toBe("tunnel");
    expect(triggers["oc-lost-gas"].targetLegId).toBe("tunnel");
    expect(triggers["scooter-failure"].targetLegId).toBe("scooter");
    expect(triggers["stage-failure"].targetLegId).toBe("scooter");
  });

  it("characterizes multi-leg OC and CCR scenario models against calculateCavePlan", () => {
    const bottom = { ...AIR, id: "back-air", cylinderId: "back", switchDepthM: meters(10) };
    const stage = { ...AIR, id: "stage-air", name: "Stage air", role: "travel" as const, cylinderId: "stage" };
    const entry: RouteLeg = {
      id: "entry", startDepthM: meters(0), endDepthM: meters(10), durationSeconds: seconds(60), distanceM: meters(60),
      propulsion: "fins", accessibleCylinderIds: ["back", "stage"],
    };
    const scooter: RouteLeg = {
      id: "scooter", startDepthM: meters(10), endDepthM: meters(20), durationSeconds: seconds(120), distanceM: meters(700),
      propulsion: "scooter", accessibleCylinderIds: ["back", "stage"], stageAction: "drop", stageCylinderId: "stage",
    };
    const tunnel: RouteLeg = {
      id: "tunnel", startDepthM: meters(20), endDepthM: meters(21), durationSeconds: seconds(90), distanceM: meters(250),
      propulsion: "fins", accessibleCylinderIds: ["back"],
    };
    const ocInput: CavePlanInput = {
      mode: "oc", reserve: { kind: "thirds" },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(21), bottomTimeSeconds: seconds(60), bottomGas: bottom, travelGas: stage, decoGases: [],
        cylinders: [
          { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(220), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "stage", name: "Stage", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: stage, maximumPPO2: barAbsolute(1.4), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [entry, scooter, tunnel],
      scenarios: [
        { kind: "lost-buddy", targetLegId: "scooter", targetDistanceM: meters(410) },
        { kind: "scooter-failure", targetLegId: "scooter" },
        { kind: "stage-failure", targetLegId: "scooter" },
        { kind: "oc-lost-gas", targetLegId: "scooter" },
      ],
    };
    const oc = calculateCavePlan(ocInput);
    expect(oc.ok).toBe(true);
    if (!oc.ok) return;
    const byKind = new Map(oc.value.scenarios.map((scenario) => [scenario.kind, scenario]));

    // Interpolated mid-scooter trigger depth matches the turn / end of the truncated prefix.
    expect(scenarioTriggerPoint({ targetLegId: "scooter", targetDistanceM: 410 }, [
      { id: "entry", startDepthM: 0, endDepthM: 10, durationMinutes: 1, distanceM: 60, propulsion: "fins", stageAction: "none" },
      { id: "scooter", startDepthM: 10, endDepthM: 20, durationMinutes: 2, distanceM: 700, propulsion: "scooter", stageAction: "drop", stageGasKey: "stage" },
      { id: "tunnel", startDepthM: 20, endDepthM: 21, durationMinutes: 1.5, distanceM: 250, propulsion: "fins", stageAction: "none" },
    ])).toMatchObject({ distanceM: 410, depthM: 15 });
    const lostBuddy = byKind.get("lost-buddy")?.plan;
    const lostBuddyPenetrations = lostBuddy?.segments.filter((segment) => segment.kind === "penetration") ?? [];
    expect(lostBuddyPenetrations).toHaveLength(2);
    const turnDepth = lostBuddyPenetrations.at(-1)?.endDepthM;
    expect(turnDepth).toBe(meters(15));
    expect(lostBuddyPenetrations.map((segment) => segment.durationSeconds)).toEqual([60, 60]);
    expect(lostBuddy?.segments.filter((segment) => segment.kind === "exit").reduce((sum, segment) => sum + segment.durationSeconds, 0)).toBe(240);

    // Scooter failure doubles only scooter exit legs; fin exit (entry) stays 60 s.
    const scooterPlan = byKind.get("scooter-failure")?.plan;
    const scooterExits = scooterPlan?.segments.filter((segment) => segment.kind === "exit") ?? [];
    expect(scooterExits.map((segment) => segment.durationSeconds)).toEqual([240, 60]);
    // Legs beyond the trigger are excluded from the scenario plan (no third penetration).
    expect(scooterPlan?.segments.filter((segment) => segment.kind === "penetration")).toHaveLength(2);
    expect(scooterPlan?.segments.filter((segment) => segment.kind === "penetration").reduce((sum, segment) => sum + segment.durationSeconds, 0)).toBe(180);

    expect(byKind.get("oc-lost-gas")?.plan?.segments.some((segment) => segment.kind === "exit" && segment.gasId === bottom.id)).toBe(false);
    expect(byKind.get("stage-failure")?.plan?.segments.some((segment) => segment.kind === "exit" && segment.gasId === stage.id)).toBe(false);

    const diluent = { ...AIR, id: "diluent", role: "diluent" as const, oxygen: fraction(0.18), cylinderId: "back" };
    const bailout = { ...AIR, id: "bailout", role: "bailout" as const, cylinderId: "bailout-cylinder" };
    const ccr = calculateCavePlan({
      mode: "ccr", reserve: { kind: "custom", reserveVolumeL: liters(500) },
      dive: {
        mode: "ccr", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(120),
        diluent, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [bailout],
        cylinders: [
          { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: diluent, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "bailout-cylinder", name: "Bailout", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bailout, maximumPPO2: barAbsolute(1.6), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [
        { id: "entry", startDepthM: meters(0), endDepthM: meters(20), durationSeconds: seconds(60), distanceM: meters(50), propulsion: "fins", accessibleCylinderIds: ["back", "bailout-cylinder"] },
        { id: "deep", startDepthM: meters(20), endDepthM: meters(30), durationSeconds: seconds(120), distanceM: meters(80), propulsion: "fins", accessibleCylinderIds: ["back", "bailout-cylinder"] },
      ],
      scenarios: [{ kind: "ccr-loop-failure", targetLegId: "entry", targetDistanceM: meters(40) }],
    });
    expect(ccr.ok).toBe(true);
    if (!ccr.ok) return;
    const bailoutEvent = ccr.value.scenarios[0]?.plan?.segments.find((segment) => segment.kind === "bailout" && segment.durationSeconds === 1);
    expect(bailoutEvent).toBeDefined();
    expect(bailoutEvent?.startDepthM).toBe(bailoutEvent?.endDepthM);
    // Trigger mid-entry excludes the deep leg: no segment ends at the deep-leg terminus.
    expect(ccr.value.scenarios[0]?.plan?.segments.some((segment) => segment.endDepthM === meters(30) && segment.kind === "penetration")).toBe(false);
    expect(Math.max(...(ccr.value.scenarios[0]?.plan?.segments.map((segment) => segment.endDepthM) ?? [0]))).toBeLessThan(30);
  });

  it("characterizes the model lines against calculateCavePlan", () => {
    const bottom = { ...AIR, id: "back-air", cylinderId: "back", switchDepthM: meters(10) };
    const stage = { ...AIR, id: "stage-air", name: "Stage air", role: "travel" as const, cylinderId: "stage" };
    const leg: RouteLeg = {
      id: "scooter-stage", startDepthM: meters(0), endDepthM: meters(20), durationSeconds: seconds(60), distanceM: meters(100),
      propulsion: "scooter", accessibleCylinderIds: ["back", "stage"], stageAction: "drop", stageCylinderId: "stage",
    };
    const input: CavePlanInput = {
      mode: "oc", reserve: { kind: "thirds" },
      dive: {
        mode: "oc", environment: "cave", depthM: meters(20), bottomTimeSeconds: seconds(60), bottomGas: bottom, travelGas: stage, decoGases: [],
        cylinders: [
          { id: "back", name: "Back", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(220), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
          { id: "stage", name: "Stage", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: stage, maximumPPO2: barAbsolute(1.4), revision: 1 },
        ],
        settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY,
      },
      route: [leg],
      scenarios: ["oc-lost-gas", "lost-buddy", "scooter-failure", "stage-failure"].map((kind) => ({ kind, targetLegId: leg.id })) as CavePlanInput["scenarios"],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scenarios = new Map(result.value.scenarios.map((scenario) => [scenario.kind, scenario]));
    // Each transformation turns at this sole leg's endpoint; only loop failure would add a trigger event.
    expect(scenarios.get("lost-buddy")?.plan?.segments.filter((segment) => segment.kind === "exit").reduce((sum, segment) => sum + segment.durationSeconds, 0)).toBe(120);
    expect(scenarios.get("scooter-failure")?.plan?.segments.filter((segment) => segment.kind === "exit").reduce((sum, segment) => sum + segment.durationSeconds, 0)).toBe(120);
    expect(scenarios.get("oc-lost-gas")?.plan?.segments.some((segment) => segment.kind === "exit" && segment.gasId === bottom.id)).toBe(false);
    expect(scenarios.get("stage-failure")?.plan?.segments.some((segment) => segment.kind === "exit" && segment.gasId === stage.id)).toBe(false);
  });
});
