import type { RouteDraft } from "./caveWorkspace";
import {
  routeCylinderAccess,
  routeStageCylinder,
  unsetRouteCylinders,
  type RouteCylinder,
} from "./caveRoute";
import { formatDepth, type UnitPreferences } from "./helpers";

export type CaveAccessCellState =
  | "carried"
  | "not carried"
  | "dropped at the end of this leg"
  | "recovered on this leg"
  | "shared (locked)"
  | "not set";

export function caveAccessCellState(
  leg: RouteDraft,
  cylinder: RouteCylinder,
  cylinders: readonly RouteCylinder[],
): CaveAccessCellState {
  if (cylinder.gases.length > 1) return "shared (locked)";
  if (unsetRouteCylinders(leg, cylinders).some((candidate) => candidate.id === cylinder.id)) return "not set";
  const stage = routeStageCylinder(leg, cylinders);
  if (stage?.id === cylinder.id && leg.stageAction === "drop") return "dropped at the end of this leg";
  if (stage?.id === cylinder.id && leg.stageAction === "recover") return "recovered on this leg";
  return routeCylinderAccess(leg, cylinder) === "accessible" ? "carried" : "not carried";
}

export function CaveAccessTable({
  route,
  cylinders,
  preferences,
}: {
  readonly route: readonly RouteDraft[];
  readonly cylinders: readonly RouteCylinder[];
  readonly preferences: UnitPreferences;
}) {
  return <div className="bf-scroll-table bf-cave-access-table">
    <table>
      <caption>Cylinder access by leg</caption>
      <thead>
        <tr>
          <th scope="col">Cylinder / gas</th>
          {route.map((leg, index) => <th key={`${leg.id}-${index}`} scope="col">
            <span>{leg.id.trim() || `Leg ${index + 1}`}</span>
            <small>{formatDepth(leg.distanceM, preferences.depth)} · {formatDepth(leg.startDepthM, preferences.depth)}–{formatDepth(leg.endDepthM, preferences.depth)}</small>
          </th>)}
        </tr>
      </thead>
      <tbody>
        {cylinders.map((cylinder) => <tr key={cylinder.id}>
          <th scope="row">
            <span>{cylinder.name}</span>
            <small>{cylinder.gases.map((gas) => gas.label).join("; ") || "No active gas"}</small>
          </th>
          {route.map((leg, index) => <td key={`${leg.id}-${index}`}>{caveAccessCellState(leg, cylinder, cylinders)}</td>)}
        </tr>)}
      </tbody>
    </table>
    <p className="bf-panel__note">The exit runs the legs in reverse; a stage dropped on a leg is picked up when the exit reaches it.</p>
  </div>;
}
