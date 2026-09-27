import { describe, expect, it } from "vitest";
import { buildCaveTimeline } from "./caveTimeline";
import type { RouteCylinder } from "./caveRoute";
import { initialScenarioTriggers } from "./caveScenarios";
import type { RouteDraft } from "./caveWorkspace";

const route: readonly RouteDraft[] = [
  { id: "entry", startDepthM: 0, endDepthM: 12, durationMinutes: 4, distanceM: 80, propulsion: "fins", stageAction: "none" },
  { id: "scooter", startDepthM: 12, endDepthM: 24, durationMinutes: 6, distanceM: 240, propulsion: "scooter", stageAction: "drop", stageGasKey: "oxygen" },
  { id: "exit", startDepthM: 24, endDepthM: 6, durationMinutes: 8, distanceM: 160, propulsion: "fins", stageAction: "recover", stageGasKey: "oxygen" },
];

const cylinders: readonly RouteCylinder[] = [{ id: "oxygen-cylinder", name: "Oxygen stage", gases: [{ key: "oxygen", label: "deco gas Oxygen" }] }];

describe("buildCaveTimeline", () => {
  it("lays legs cumulatively on distance and preserves entered time and depths", () => {
    const model = buildCaveTimeline(route, cylinders, [], initialScenarioTriggers("oc", route));

    expect(model.totalDistanceM).toBe(480);
    expect(model.totalTimeMinutes).toBe(18);
    expect(model.segments).toEqual([
      expect.objectContaining({ legId: "entry", startDistanceM: 0, endDistanceM: 80, startTimeMinutes: 0, endTimeMinutes: 4, startDepthM: 0, endDepthM: 12 }),
      expect.objectContaining({ legId: "scooter", startDistanceM: 80, endDistanceM: 320, startTimeMinutes: 4, endTimeMinutes: 10, startDepthM: 12, endDepthM: 24 }),
      expect.objectContaining({ legId: "exit", startDistanceM: 320, endDistanceM: 480, startTimeMinutes: 10, endTimeMinutes: 18, startDepthM: 24, endDepthM: 6 }),
    ]);
  });

  it("uses scenario applicability and trigger interpolation, and resolves stage events through routeStageCylinder", () => {
    const triggers = {
      ...initialScenarioTriggers("oc", route),
      "scooter-failure": { targetLegId: "scooter", targetDistanceM: 200 },
      "stage-failure": { targetLegId: "scooter", targetDistanceM: 200 },
    };
    const model = buildCaveTimeline(route, cylinders, ["scooter-failure", "stage-failure"], triggers);

    expect(model.markers).toEqual(expect.arrayContaining([
      { type: "scenario", kind: "scooter-failure", label: "Scooter failure", distanceM: 200, depthM: 18 },
      { type: "scenario", kind: "stage-failure", label: "Stage failure", distanceM: 200, depthM: 18 },
      { type: "stage", action: "drop", cylinderName: "Oxygen stage", legId: "scooter", distanceM: 320 },
      { type: "stage", action: "recover", cylinderName: "Oxygen stage", legId: "exit", distanceM: 480 },
    ]));
  });

  it("omits inapplicable scenario markers and unresolved stage cylinders", () => {
    const noStage = route.map((leg) => ({ ...leg, stageGasKey: undefined }));
    const model = buildCaveTimeline(noStage, [], ["scooter-failure", "stage-failure"], initialScenarioTriggers("oc", noStage));

    expect(model.markers).toEqual([
      expect.objectContaining({ type: "scenario", kind: "scooter-failure" }),
    ]);
  });
});
