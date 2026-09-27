import type { CSSProperties } from "react";
import type { CaveScenarioKind } from "../cave";
import { depthFromCanonical, depthUnit, type UnitPreferences } from "./helpers";
import type { CaveTimelineModel } from "./caveTimeline";

const percentage = (value: number, total: number): number => total <= 0 ? 0 : (value / total) * 100;

export function CaveTimeline({
  model,
  preferences,
  readOnly = false,
  onSegmentActivate,
  onScenarioActivate,
}: {
  readonly model: CaveTimelineModel;
  readonly preferences: UnitPreferences;
  readonly readOnly?: boolean;
  readonly onSegmentActivate?: (legId: string) => void;
  readonly onScenarioActivate?: (kind: CaveScenarioKind) => void;
}) {
  const unit = depthUnit(preferences.depth);
  const distance = (value: number) => `${depthFromCanonical(value, preferences.depth).toFixed(0)} ${unit}`;
  const time = (value: number) => `${value.toFixed(value % 1 === 0 ? 0 : 1)} min`;

  return <section aria-label={readOnly ? "Calculated cave route timeline" : "Cave route timeline"} className="bf-cave-timeline">
    <header className="bf-cave-timeline__header">
      <div>
        <p className="bf-eyebrow">DISTANCE AXIS</p>
        <h3>Penetration timeline</h3>
      </div>
      <p>{distance(model.totalDistanceM)} · {time(model.totalTimeMinutes)}</p>
    </header>
    <p className="bf-cave-timeline__note">
      {readOnly
        ? "Route geometry from the current calculation. Select a scenario marker to review its result."
        : "Distance sets the axis; time labels retain each leg’s entered duration. Select a leg or scenario marker to edit it."}
    </p>
    <ol className="bf-cave-timeline__axis" aria-label="Route legs by distance from entrance">
      {model.segments.map((segment) => {
        const start = percentage(segment.startDistanceM, model.totalDistanceM);
        const width = percentage(segment.endDistanceM - segment.startDistanceM, model.totalDistanceM);
        const name = `${segment.legId}, ${distance(segment.startDistanceM)} to ${distance(segment.endDistanceM)}, ${distance(segment.startDepthM)} to ${distance(segment.endDepthM)} depth, ${segment.propulsion}`;
        return <li className="bf-cave-timeline__segment" key={segment.legId} style={{ "--bf-timeline-start": `${start}%`, "--bf-timeline-width": `${width}%` } as CSSProperties}>
          <button aria-label={name} onClick={() => onSegmentActivate?.(segment.legId)} type="button">
            <strong>{segment.legId}</strong>
            <span>{distance(segment.startDepthM)} → {distance(segment.endDepthM)}</span>
            <small>{segment.propulsion} · {time(segment.endTimeMinutes)}</small>
          </button>
        </li>;
      })}
    </ol>
    {model.markers.length > 0 && <ul className="bf-cave-timeline__markers" aria-label="Route events">
      {model.markers.map((marker) => {
        const position = percentage(marker.distanceM, model.totalDistanceM);
        const markerStyle = {
          "--bf-timeline-position": `${position}%`,
          "--bf-timeline-shift": position <= 0 ? "0%" : position >= 100 ? "-100%" : "-50%",
        } as CSSProperties;
        if (marker.type === "scenario") {
          return <li className="bf-cave-timeline__marker bf-cave-timeline__marker--scenario" key={marker.kind} style={markerStyle}>
            <button aria-label={`${marker.label} trigger at ${distance(marker.distanceM)}, ${distance(marker.depthM)} depth`} onClick={() => onScenarioActivate?.(marker.kind)} type="button">
              <span>{marker.label}</span>
              <small>{distance(marker.distanceM)}</small>
            </button>
          </li>;
        }
        return <li className="bf-cave-timeline__marker bf-cave-timeline__marker--stage" key={`${marker.legId}-${marker.action}`} style={markerStyle}>
          <span aria-label={`${marker.action} ${marker.cylinderName} at ${distance(marker.distanceM)}`}>
            {marker.action} {marker.cylinderName} · {distance(marker.distanceM)}
          </span>
        </li>;
      })}
    </ul>}
  </section>;
}
