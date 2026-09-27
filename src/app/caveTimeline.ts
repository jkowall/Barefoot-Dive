import type { CaveScenarioKind } from "../cave";
import { routeStageCylinder, type RouteCylinder } from "./caveRoute";
import {
  scenarioApplicability,
  scenarioLabel,
  scenarioTriggerPoint,
  type CaveScenarioTrigger,
} from "./caveScenarios";
import type { RouteDraft } from "./caveWorkspace";

export type CaveTimelineSegment = {
  readonly legId: string;
  readonly startDistanceM: number;
  readonly endDistanceM: number;
  readonly startTimeMinutes: number;
  readonly endTimeMinutes: number;
  readonly startDepthM: number;
  readonly endDepthM: number;
  readonly propulsion: RouteDraft["propulsion"];
  readonly stageAction: RouteDraft["stageAction"];
};

export type CaveTimelineMarker =
  | {
    readonly type: "scenario";
    readonly kind: CaveScenarioKind;
    readonly label: string;
    readonly distanceM: number;
    readonly depthM: number;
  }
  | {
    readonly type: "stage";
    readonly action: Exclude<RouteDraft["stageAction"], "none">;
    readonly cylinderName: string;
    readonly legId: string;
    readonly distanceM: number;
  };

export type CaveTimelineModel = {
  readonly totalDistanceM: number;
  readonly totalTimeMinutes: number;
  readonly segments: readonly CaveTimelineSegment[];
  readonly markers: readonly CaveTimelineMarker[];
};

/**
 * Builds a display-only route axis from draft geometry. It deliberately reuses
 * the scenario and stage helpers that determine the actual cave input.
 */
export function buildCaveTimeline(
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[],
  enabledScenarios: readonly CaveScenarioKind[],
  triggers: Readonly<Record<CaveScenarioKind, CaveScenarioTrigger>>,
): CaveTimelineModel {
  let distanceM = 0;
  let timeMinutes = 0;
  const segments = route.map((leg) => {
    const segment: CaveTimelineSegment = {
      legId: leg.id,
      startDistanceM: distanceM,
      endDistanceM: distanceM + leg.distanceM,
      startTimeMinutes: timeMinutes,
      endTimeMinutes: timeMinutes + leg.durationMinutes,
      startDepthM: leg.startDepthM,
      endDepthM: leg.endDepthM,
      propulsion: leg.propulsion,
      stageAction: leg.stageAction,
    };
    distanceM = segment.endDistanceM;
    timeMinutes = segment.endTimeMinutes;
    return segment;
  });
  const markers: CaveTimelineMarker[] = [];

  for (const kind of enabledScenarios) {
    const trigger = triggers[kind];
    if (!trigger || !scenarioApplicability(kind, route, cylinders).applicable) continue;
    const point = scenarioTriggerPoint(trigger, route);
    if (point) markers.push({
      type: "scenario",
      kind,
      label: scenarioLabel(kind),
      distanceM: point.distanceM,
      depthM: point.depthM,
    });
  }

  for (const segment of segments) {
    const leg = route.find((candidate) => candidate.id === segment.legId);
    if (!leg || leg.stageAction === "none") continue;
    const cylinder = routeStageCylinder(leg, cylinders);
    if (cylinder) markers.push({
      type: "stage",
      action: leg.stageAction,
      cylinderName: cylinder.name,
      legId: leg.id,
      distanceM: segment.endDistanceM,
    });
  }

  return { totalDistanceM: distanceM, totalTimeMinutes: timeMinutes, segments, markers };
}
