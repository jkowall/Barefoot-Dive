import type { RouteLeg } from "../cave";
import type { Cylinder, Diagnostic, Gas } from "../domain/types";
import { meters, seconds } from "../domain/units";
import type { RouteDraft } from "./caveWorkspace";
import { activeGasDrafts, gasSourceLabel, sharedTankSourceMessage, type PlanDraft } from "./planning";

/** An active gas as a route leg records it. */
export type RouteGas = {
  readonly key: string;
  /** Role and name for diagnostics, lower case (`gasSourceLabel`): "deco gas EAN50". */
  readonly label: string;
};

/**
 * A plan cylinder as the route editor lists it, with the active gases that use it, in plan order.
 * Ad hoc cylinders belong to one gas; only a Tank Bank cylinder selected for several gases is shared.
 */
export type RouteCylinder = {
  readonly id: string;
  readonly name: string;
  readonly gases: readonly RouteGas[];
};

export type RouteCylinderAccess = "accessible" | "inaccessible" | "mixed";

/** The cave route built from the legs as edited, or why none can be built. */
export type NormalizedCaveRoute =
  | { readonly ok: true; readonly legs: readonly RouteLeg[]; readonly diagnostics: readonly [] }
  | { readonly ok: false; readonly legs?: undefined; readonly diagnostics: readonly Diagnostic[] };

/**
 * Pairs each plan cylinder with the gases that use it. `resolved` must come from
 * `resolvePlanInput(draft, …)`, which resolves `activeGasDrafts(draft)` one to one and in order.
 */
export function routeCylinders(
  draft: PlanDraft,
  resolved: { readonly gases: readonly Gas[]; readonly cylinders: readonly Cylinder[] },
): readonly RouteCylinder[] {
  const gasesByCylinder = new Map<string, RouteGas[]>();
  activeGasDrafts(draft).forEach((gas, index) => {
    const cylinderId = resolved.gases[index]?.cylinderId;
    if (!cylinderId) return;
    gasesByCylinder.set(cylinderId, [...(gasesByCylinder.get(cylinderId) ?? []), { key: gas.key, label: gasSourceLabel(gas) }]);
  });
  return resolved.cylinders.map((cylinder) => ({
    id: cylinder.id,
    name: cylinder.name,
    gases: gasesByCylinder.get(cylinder.id) ?? [],
  }));
}

/** A cylinder is accessible on a leg when every gas that uses it is recorded as accessible there. */
export function routeCylinderAccess(leg: RouteDraft, cylinder: RouteCylinder): RouteCylinderAccess {
  const listed = leg.accessibleGasKeys;
  if (listed === undefined) return "accessible";
  const count = cylinder.gases.filter((gas) => listed.includes(gas.key)).length;
  return count === 0 ? "inaccessible" : count === cylinder.gases.length ? "accessible" : "mixed";
}

/**
 * Sets a cylinder's access on a leg for the gases that use it. A leg's first access edit records the
 * gases then taking part, as listed, so a gas that takes part only later starts inaccessible there.
 */
export function withCylinderAccess(
  leg: RouteDraft,
  cylinder: RouteCylinder,
  accessible: boolean,
  cylinders: readonly RouteCylinder[],
): RouteDraft {
  const listed = leg.accessibleGasKeys ?? cylinders.flatMap((item) => item.gases.map((gas) => gas.key));
  const keys = cylinder.gases.map((gas) => gas.key);
  return {
    ...leg,
    accessibleGasKeys: accessible
      ? [...new Set([...listed, ...keys])]
      : listed.filter((key) => !keys.includes(key)),
  };
}

/** The cylinder the leg's stage gas uses now, while that gas takes part in the plan. */
export function routeStageCylinder(leg: RouteDraft, cylinders: readonly RouteCylinder[]): RouteCylinder | undefined {
  const key = leg.stageGasKey;
  return key === undefined ? undefined : cylinders.find((cylinder) => cylinder.gases.some((gas) => gas.key === key));
}

/** Records the chosen cylinder's gas as the leg's stage, or clears it. The editor offers only cylinders with one gas. */
export function withStageCylinder(leg: RouteDraft, cylinder: RouteCylinder | undefined): RouteDraft {
  return { ...leg, stageGasKey: cylinder?.gases[0]?.key };
}

function sharedCylinderDiagnostic(cylinder: RouteCylinder): Diagnostic {
  return {
    code: "ROUTE_CYLINDER_SHARED",
    severity: "error",
    message: sharedTankSourceMessage(cylinder.gases.map((gas) => gas.label), cylinder.name, "cave"),
    cylinderId: cylinder.id,
  };
}

/**
 * Builds the cave route from the legs as edited. Access and the stage follow each gas to its current
 * cylinder, so a source change never rewrites them; accessible cylinders keep plan order. A stage
 * whose gas no longer takes part is left out, which the cave layer rejects. A cylinder used by
 * several gases builds no route: access and stages are set per cylinder, and the planner rejects two
 * gases from one Tank Bank record.
 */
export function normalizeCaveRoute(route: readonly RouteDraft[], cylinders: readonly RouteCylinder[]): NormalizedCaveRoute {
  const diagnostics = cylinders.filter((cylinder) => cylinder.gases.length > 1).map(sharedCylinderDiagnostic);
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    legs: route.map((leg): RouteLeg => {
      const stage = leg.stageAction === "none" ? undefined : routeStageCylinder(leg, cylinders);
      return {
        id: leg.id,
        startDepthM: meters(leg.startDepthM),
        endDepthM: meters(leg.endDepthM),
        durationSeconds: seconds(leg.durationMinutes * 60),
        distanceM: meters(leg.distanceM),
        propulsion: leg.propulsion,
        accessibleCylinderIds: cylinders
          .filter((cylinder) => routeCylinderAccess(leg, cylinder) === "accessible")
          .map((cylinder) => cylinder.id),
        ...(leg.stageAction === "none" ? {} : { stageAction: leg.stageAction }),
        ...(stage ? { stageCylinderId: stage.id } : {}),
      };
    }),
    diagnostics: [],
  };
}
