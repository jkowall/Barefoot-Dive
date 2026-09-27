import type { CSSProperties } from "react";
import type { CaveScenarioKind } from "../cave";
import { depthFromCanonical, depthUnit, type UnitPreferences } from "./helpers";
import type { CaveTimelineMarker, CaveTimelineModel } from "./caveTimeline";

const percentage = (value: number, total: number): number => total <= 0 ? 0 : (value / total) * 100;

function stageActionLabel(action: Extract<CaveTimelineMarker, { type: "stage" }>["action"]): string {
  return action === "drop" ? "Drop" : "Recover";
}

/** Presentational distance-axis route timeline. Named distinctly from `caveTimeline.ts` so case-insensitive filesystems do not collide. */
export function CaveRouteTimeline({
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
  const markerSpotIndex = model.markers.map((marker, index) => {
    let spotIndex = 0;
    for (let earlier = 0; earlier < index; earlier += 1) {
      if (Math.abs(model.markers[earlier].distanceM - marker.distanceM) <= 1e-6) spotIndex += 1;
    }
    return spotIndex;
  });
  const pinStackRows = markerSpotIndex.reduce((max, spotIndex) => Math.max(max, spotIndex + 1), 0);

  return <section aria-label={readOnly ? "Calculated cave route timeline" : "Cave route timeline"} className="bf-cave-timeline">
    <header className="bf-cave-timeline__intro">
      <div>
        <strong>Penetration timeline</strong>
        <span>Distance from entrance · entered time as labels</span>
      </div>
      <p>
        {readOnly
          ? "Route geometry from the current calculation. Select a scenario marker to review its result."
          : "Select a leg or scenario event to edit it. Editors remain the source of route changes."}
      </p>
    </header>

    <div className="bf-metric-grid bf-cave-timeline__totals">
      <div className="bf-metric">
        <span>Total distance</span>
        <strong>{distance(model.totalDistanceM)}</strong>
      </div>
      <div className="bf-metric">
        <span>Entered time</span>
        <strong>{time(model.totalTimeMinutes)}</strong>
      </div>
      <div className="bf-metric">
        <span>Legs</span>
        <strong>{model.segments.length}</strong>
      </div>
    </div>

    <div className="bf-cave-timeline__plot">
      <ol className="bf-cave-timeline__axis" aria-label="Route legs by distance from entrance">
        {model.segments.map((segment) => {
          const width = percentage(segment.endDistanceM - segment.startDistanceM, model.totalDistanceM);
          const name = `${segment.legId}, ${distance(segment.startDistanceM)} to ${distance(segment.endDistanceM)}, ${distance(segment.startDepthM)} to ${distance(segment.endDepthM)} depth, ${segment.propulsion}`;
          return <li className="bf-cave-timeline__segment" key={segment.legId} style={{ "--bf-timeline-width": `${Math.max(width, 0)}%` } as CSSProperties}>
            <button aria-label={name} onClick={() => onSegmentActivate?.(segment.legId)} type="button">
              <strong>{segment.legId}</strong>
              <span>{distance(segment.startDepthM)} → {distance(segment.endDepthM)}</span>
              <small>{segment.propulsion} · {time(segment.endTimeMinutes)}</small>
            </button>
          </li>;
        })}
      </ol>

      {model.markers.length > 0 && <div
        aria-hidden="true"
        className="bf-cave-timeline__pins"
        style={{ "--bf-timeline-pin-rows": String(pinStackRows) } as CSSProperties}
      >
        {model.markers.map((marker, index) => {
          const position = percentage(marker.distanceM, model.totalDistanceM);
          const shift = position <= 0 ? "0%" : position >= 100 ? "-100%" : "-50%";
          return <span
            className={`bf-cave-timeline__pin bf-cave-timeline__pin--${marker.type}`}
            key={marker.type === "scenario" ? marker.kind : `${marker.legId}-${marker.action}`}
            style={{
              "--bf-timeline-position": `${position}%`,
              "--bf-timeline-shift": shift,
              "--bf-timeline-stack": `${markerSpotIndex[index] * 1.15}rem`,
            } as CSSProperties}
          >{index + 1}</span>;
        })}
      </div>}

      <div aria-hidden="true" className="bf-cave-timeline__scale">
        <span>0 {unit}</span>
        <span>{distance(model.totalDistanceM)}</span>
      </div>
    </div>

    {model.markers.length > 0 && <section aria-label="Route events" className="bf-cave-timeline__events">
      <div className="bf-cave-timeline__events-heading">
        <strong>Route events</strong>
        <span>Numbers match the pins on the distance strip.</span>
      </div>
      <ol className="bf-cave-timeline__event-list">
        {model.markers.map((marker, index) => {
          if (marker.type === "scenario") {
            return <li key={marker.kind}>
              <button
                aria-label={`${marker.label} trigger at ${distance(marker.distanceM)}, ${distance(marker.depthM)} depth`}
                onClick={() => onScenarioActivate?.(marker.kind)}
                type="button"
              >
                <span aria-hidden="true" className="bf-cave-timeline__event-number" data-kind="scenario">{index + 1}</span>
                <span className="bf-cave-timeline__event-copy">
                  <strong>{marker.label}</strong>
                  <small>{distance(marker.distanceM)} · {distance(marker.depthM)}</small>
                </span>
              </button>
            </li>;
          }
          return <li key={`${marker.legId}-${marker.action}`}>
            <div className="bf-cave-timeline__event-static">
              <span aria-hidden="true" className="bf-cave-timeline__event-number" data-kind="stage">{index + 1}</span>
              <span
                aria-label={`${marker.action} ${marker.cylinderName} at ${distance(marker.distanceM)}`}
                className="bf-cave-timeline__event-copy"
              >
                <strong>{stageActionLabel(marker.action)} {marker.cylinderName}</strong>
                <small>{distance(marker.distanceM)} · end of {marker.legId}</small>
              </span>
            </div>
          </li>;
        })}
      </ol>
    </section>}
  </section>;
}
