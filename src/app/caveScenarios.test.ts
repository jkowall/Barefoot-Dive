import { describe, expect, it } from "vitest";
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
});
