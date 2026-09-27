import type { CaveScenarioKind, CaveScenarioRequest } from "../cave";
import { meters, seconds } from "../domain/units";
import { routeStageCylinder, type RouteCylinder } from "./caveRoute";
import type { RouteDraft } from "./caveWorkspace";

export type CaveScenarioTrigger = {
  readonly targetLegId: string;
  /** Omitted means the end of the selected leg. */
  readonly targetDistanceM?: number;
  /** A route edit repaired this choice; clear this after the diver edits the trigger. */
  readonly repairNote?: string;
};

export type ScenarioApplicability = {
  readonly applicable: boolean;
  readonly reason?: string;
  readonly eligibleLegIds: readonly string[];
};

export const scenarioLabel = (kind: CaveScenarioKind): string => ({
  "oc-lost-gas": "Lost back gas",
  "lost-buddy": "Lost buddy",
  "scooter-failure": "Scooter failure",
  "stage-failure": "Stage failure",
  "ccr-loop-failure": "CCR loop failure",
})[kind];

export const scenarioModelLine = (kind: CaveScenarioKind): string => ({
  "oc-lost-gas": "Turns at the trigger and exits without the bottom-gas cylinder, on other cylinders accessible on each exit leg. No teammate gas. Legs beyond the trigger are not included.",
  "lost-buddy": "Turns at the trigger; every exit leg takes twice as long. Legs beyond the trigger are not included.",
  "scooter-failure": "Turns at the trigger; exit legs ridden on a scooter take twice as long. Fin and tow legs are unchanged. Legs beyond the trigger are not included.",
  "stage-failure": "Turns at the trigger and exits without the stage cylinder dropped or recovered on the trigger leg. Legs beyond the trigger are not included.",
  "ccr-loop-failure": "Bails out to open circuit at the trigger, a 1 s event, and exits on the bailout gases accessible on each exit leg. Legs beyond the trigger are not included.",
})[kind];

export function scenarioApplicability(
  kind: CaveScenarioKind,
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[],
): ScenarioApplicability {
  if (kind === "scooter-failure") {
    const eligibleLegIds = route.filter((leg) => leg.propulsion === "scooter").map((leg) => leg.id);
    return eligibleLegIds.length ? { applicable: true, eligibleLegIds } : { applicable: false, reason: "Needs a scooter leg", eligibleLegIds };
  }
  if (kind === "stage-failure") {
    const eligibleLegIds = route.filter((leg) => leg.stageAction !== "none" && routeStageCylinder(leg, cylinders)).map((leg) => leg.id);
    return eligibleLegIds.length ? { applicable: true, eligibleLegIds } : { applicable: false, reason: "Needs a leg that drops or recovers a stage", eligibleLegIds };
  }
  return { applicable: true, eligibleLegIds: route.map((leg) => leg.id) };
}

export function defaultScenarioTrigger(
  kind: CaveScenarioKind,
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[],
): CaveScenarioTrigger {
  const applicability = scenarioApplicability(kind, route, cylinders);
  const targetLegId = applicability.eligibleLegIds.at(-1) ?? route.at(-1)?.id ?? "";
  return { targetLegId };
}

export function isScenarioDistanceValid(trigger: CaveScenarioTrigger, route: readonly RouteDraft[]): boolean {
  if (trigger.targetDistanceM === undefined) return route.some((leg) => leg.id === trigger.targetLegId);
  let before = 0;
  for (const leg of route) {
    if (leg.id === trigger.targetLegId) {
      const fraction = leg.distanceM === 0 ? 0 : (trigger.targetDistanceM - before) / leg.distanceM;
      return trigger.targetDistanceM >= before && trigger.targetDistanceM <= before + leg.distanceM
        && seconds(leg.durationMinutes * 60 * fraction) >= 1;
    }
    before += leg.distanceM;
  }
  return false;
}

export function repairScenarioTriggers(
  triggers: Readonly<Record<CaveScenarioKind, CaveScenarioTrigger>>,
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[],
): Record<CaveScenarioKind, CaveScenarioTrigger> {
  return (Object.keys(triggers) as CaveScenarioKind[]).reduce<Record<CaveScenarioKind, CaveScenarioTrigger>>((next, kind) => {
    const trigger = triggers[kind];
    const applicability = scenarioApplicability(kind, route, cylinders);
    const validLeg = applicability.eligibleLegIds.includes(trigger.targetLegId);
    if (!validLeg) {
      next[kind] = { ...defaultScenarioTrigger(kind, route, cylinders), repairNote: "Trigger returned to this scenario’s default after the route changed." };
    } else if (!isScenarioDistanceValid(trigger, route)) {
      next[kind] = { targetLegId: trigger.targetLegId, repairNote: "Trigger distance returned to the end of its leg after the route changed." };
    } else next[kind] = trigger;
    return next;
  }, {} as Record<CaveScenarioKind, CaveScenarioTrigger>);
}

export function buildScenarioRequests(
  enabled: readonly CaveScenarioKind[],
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[],
  triggers: Readonly<Record<CaveScenarioKind, CaveScenarioTrigger>>,
): readonly CaveScenarioRequest[] {
  return enabled
    .filter((kind) => scenarioApplicability(kind, route, cylinders).applicable)
    .map((kind) => {
      const trigger = triggers[kind];
      return {
        kind,
        targetLegId: trigger.targetLegId,
        ...(trigger.targetDistanceM === undefined ? {} : { targetDistanceM: meters(trigger.targetDistanceM) }),
      };
    });
}

export function scenarioTriggerPoint(trigger: CaveScenarioTrigger, route: readonly RouteDraft[]) {
  let before = 0;
  for (const leg of route) {
    if (leg.id === trigger.targetLegId) {
      const distanceM = trigger.targetDistanceM ?? before + leg.distanceM;
      const fraction = leg.distanceM === 0 ? 1 : (distanceM - before) / leg.distanceM;
      return { leg, distanceM, depthM: leg.startDepthM + fraction * (leg.endDepthM - leg.startDepthM) };
    }
    before += leg.distanceM;
  }
  return undefined;
}

export function initialScenarioTriggers(
  mode: "oc" | "ccr",
  route: readonly RouteDraft[],
  cylinders: readonly RouteCylinder[] = [],
): Record<CaveScenarioKind, CaveScenarioTrigger> {
  const kinds: readonly CaveScenarioKind[] = mode === "oc"
    ? ["oc-lost-gas", "lost-buddy", "scooter-failure", "stage-failure"]
    : ["ccr-loop-failure"];
  return kinds.reduce(
    (all, kind) => ({ ...all, [kind]: defaultScenarioTrigger(kind, route, cylinders) }),
    {} as Record<CaveScenarioKind, CaveScenarioTrigger>,
  );
}
