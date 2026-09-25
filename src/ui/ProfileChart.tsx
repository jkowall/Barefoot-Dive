import {
  type KeyboardEvent,
  type PointerEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildProfileChartModel,
  findActiveSegment,
  interpolatePlannedDepth,
  phaseLabel,
  summarizeTimelinePhases,
  type ChartMarker,
  type ChartSegmentInput,
  type ReserveCrossingInput,
} from "./profileChartModel";

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 330;
const PLOT_LEFT = 62;
const PLOT_RIGHT = 704;
const PLOT_TOP = 24;
const PLOT_BOTTOM = 238;
const PHASE_TOP = 250;
const PHASE_HEIGHT = 14;
const EPSILON = 1e-6;

const wholeNumber = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
/** Feet read as whole numbers; metres keep one decimal. */
const depthFormatter = (unit: string): Intl.NumberFormat => unit === "ft" ? wholeNumber : oneDecimal;
/** A ceiling is a depth to stay below, so it rounds deeper at display precision. */
function formatCeiling(value: number, unit: string): string {
  const factor = unit === "ft" ? 1 : 10;
  return depthFormatter(unit).format(Math.ceil(value * factor - 1e-7) / factor);
}

function formatRuntime(valueSeconds: number): string {
  const total = Math.max(0, Math.round(valueSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const seconds = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function phaseClass(kind: string): string {
  return kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
}

function breathingState(segment: ChartSegmentInput): string {
  if (segment.setpoint !== undefined) return "CCR";
  if (segment.kind === "bailout") return "Open-circuit bailout";
  return "Open circuit";
}

function boundedRuntimeTicks(ticks: readonly number[], maximum: number): readonly number[] {
  if (maximum <= 0) return [0];
  return [...new Set([
    ...ticks.filter((tick) => tick >= 0 && tick < maximum - EPSILON),
    maximum,
  ])].sort((left, right) => left - right);
}

function markerShape(marker: ChartMarker, x: number, y: number, number: number) {
  const title = `${marker.label} at ${formatRuntime(marker.runtimeSeconds)}${marker.detail ? `; ${marker.detail}` : ""}`;
  if (marker.kind === "reserve-crossing") {
    return <g className="bf-profile__marker bf-profile__marker--reserve" data-tone={marker.tone ?? "warning"}>
      <title>{title}</title>
      <polygon points={`${x},${y - 10} ${x - 9},${y + 7} ${x + 9},${y + 7}`} />
      <text className="bf-profile__marker-number" dominantBaseline="central" textAnchor="middle" x={x} y={y + 1}>{number}</text>
    </g>;
  }
  if (marker.kind === "setpoint-switch") {
    return <g className="bf-profile__marker bf-profile__marker--setpoint">
      <title>{title}</title>
      <line x1={x} x2={x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
      <circle cx={x} cy={y} r="7.5" />
      <text className="bf-profile__marker-number" dominantBaseline="central" textAnchor="middle" x={x} y={y}>{number}</text>
    </g>;
  }
  return <g className="bf-profile__marker bf-profile__marker--gas">
    <title>{title}</title>
    <line x1={x} x2={x} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
    <polygon points={`${x},${y - 8} ${x - 8},${y} ${x},${y + 8} ${x + 8},${y}`} />
    <text className="bf-profile__marker-number" dominantBaseline="central" textAnchor="middle" x={x} y={y}>{number}</text>
  </g>;
}

export type ProfileChartProps = {
  readonly segments: readonly ChartSegmentInput[];
  readonly reserveCrossings?: readonly ReserveCrossingInput[];
  readonly title?: string;
  readonly unit?: string;
};

export function ProfileChart({
  segments,
  reserveCrossings = [],
  title = "Dive profile timeline",
  unit = "m",
}: ProfileChartProps) {
  const depthNumber = depthFormatter(unit);
  const titleId = useId();
  const instructionsId = useId();
  const markersId = useId();
  const svgId = useId().replaceAll(":", "");
  const draggingRef = useRef(false);
  const [selectedRuntime, setSelectedRuntime] = useState(0);
  const model = useMemo(
    () => buildProfileChartModel(segments, reserveCrossings),
    [reserveCrossings, segments],
  );

  const selectedSegment = findActiveSegment(segments, selectedRuntime)
    ?? segments.at(-1);
  if (!selectedSegment) {
    return <section className="bf-profile" aria-labelledby={titleId}>
      <span className="bf-sr-only" id={titleId}>{title}</span>
      <p className="bf-profile__empty">No profile events are available.</p>
    </section>;
  }
  const selectedDepth = interpolatePlannedDepth(selectedSegment, selectedRuntime);
  const selectedMarkers = model.markers.filter((marker) =>
    Math.abs(marker.runtimeSeconds - selectedRuntime) <= EPSILON
  );
  const runtimeTicks = boundedRuntimeTicks(model.runtimeTicks, model.runtimeMaximum);
  const depthScaleMaximum = Math.max(1, model.depthTicks.at(-1) ?? model.depthMaximum);
  const plotWidth = PLOT_RIGHT - PLOT_LEFT;
  const plotHeight = PLOT_BOTTOM - PLOT_TOP;
  const xForRuntime = (runtime: number) => PLOT_LEFT + (
    model.runtimeMaximum <= 0 ? 0 : runtime / model.runtimeMaximum
  ) * plotWidth;
  const yForDepth = (depth: number) => PLOT_TOP + Math.max(0, Math.min(1, depth / depthScaleMaximum)) * plotHeight;
  const depthPolyline = model.depthPoints.map((point) =>
    `${xForRuntime(point.runtimeSeconds)},${yForDepth(point.depth)}`
  ).join(" ");
  const areaPath = model.depthPoints.length > 0
    ? `M ${xForRuntime(model.depthPoints[0].runtimeSeconds)} ${PLOT_TOP} L ${depthPolyline.replaceAll(",", " ")} L ${xForRuntime(model.depthPoints.at(-1)!.runtimeSeconds)} ${PLOT_TOP} Z`
    : "";
  const selectedX = xForRuntime(selectedRuntime);
  const selectedY = yForDepth(selectedDepth);
  const endpointCeiling = selectedSegment?.endpointCeiling;
  const endpointCeilingText = endpointCeiling === undefined
    ? undefined
    : endpointCeiling <= EPSILON
      ? `None at ${formatRuntime(selectedSegment.endRuntimeSeconds)}`
      : `${formatCeiling(endpointCeiling, unit)} ${unit} at ${formatRuntime(selectedSegment.endRuntimeSeconds)}`;
  const selectedCeilingValue = endpointCeiling !== undefined && endpointCeiling > EPSILON
    ? endpointCeiling
    : undefined;
  const hasEndpointCeiling = selectedCeilingValue !== undefined;
  const selectedCeilingX = xForRuntime(selectedSegment.endRuntimeSeconds);
  const selectedCeilingY = selectedCeilingValue === undefined
    ? undefined
    : yForDepth(selectedCeilingValue);
  const ceilingLabelAnchor = selectedCeilingX > PLOT_LEFT + plotWidth * .62 ? "end" : "start";
  const ceilingLabelX = selectedCeilingX + (ceilingLabelAnchor === "start" ? 9 : -9);
  const ceilingLabelY = selectedCeilingY === undefined
    ? undefined
    : selectedCeilingY < PLOT_TOP + 22 ? selectedCeilingY + 17 : selectedCeilingY - 10;
  const timelinePhases = summarizeTimelinePhases(segments);
  const markerText = selectedMarkers.map((marker) => marker.label).join("; ");
  const valueText = selectedSegment
    ? [
        formatRuntime(selectedRuntime),
        `${depthNumber.format(selectedDepth)} ${unit}`,
        phaseLabel(selectedSegment.kind),
        `plan ${selectedSegment.planMode}`,
        breathingState(selectedSegment),
        selectedSegment.breathingLabel,
        ...(selectedSegment.setpoint === undefined ? [] : [`setpoint ${selectedSegment.setpoint.toFixed(2)} bar`]),
        ...(endpointCeilingText === undefined ? [] : [
          hasEndpointCeiling
            ? `decompression ceiling at segment end ${endpointCeilingText}`
            : `no decompression ceiling at segment end ${formatRuntime(selectedSegment.endRuntimeSeconds)}`,
        ]),
        ...(markerText ? [markerText] : []),
      ].join(", ")
    : "No profile events";

  const updateFromPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (model.runtimeMaximum <= 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const viewX = (event.clientX - bounds.left) / Math.max(1, bounds.width) * VIEW_WIDTH;
    const fraction = Math.max(0, Math.min(1, (viewX - PLOT_LEFT) / plotWidth));
    setSelectedRuntime(fraction * model.runtimeMaximum);
  };
  const finishPointer = (event: PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    let next: number | undefined;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = model.runtimeMaximum;
    if (event.key === "ArrowRight") {
      next = model.boundaryTimes.find((runtime) => runtime > selectedRuntime + EPSILON)
        ?? model.runtimeMaximum;
    }
    if (event.key === "ArrowLeft") {
      next = [...model.boundaryTimes].reverse().find((runtime) => runtime < selectedRuntime - EPSILON)
        ?? 0;
    }
    if (next === undefined) return;
    event.preventDefault();
    setSelectedRuntime(next);
  };

  return <section className="bf-profile" aria-labelledby={titleId}>
    <span className="bf-sr-only" id={titleId}>{title}</span>
    <div className="bf-profile__intro">
      <div><strong>Planned profile</strong><span>Runtime · Depth ({unit})</span></div>
      <p id={instructionsId}>Move across the graph with a mouse or finger. Use Left/Right, Home, or End from the keyboard.</p>
    </div>
    <div className="bf-profile__chart-shell">
    <div className="bf-profile__readout" data-testid="profile-readout">
      <span><small>Runtime</small><strong>{formatRuntime(selectedRuntime)}</strong></span>
      <span><small>Depth</small><strong>{depthNumber.format(selectedDepth)} {unit}</strong></span>
      <span><small>Phase</small><strong>{phaseLabel(selectedSegment.kind)}</strong></span>
      <span><small>Plan mode</small><strong>{selectedSegment.planMode}</strong></span>
      <span><small>Breathing</small><strong>{breathingState(selectedSegment)}</strong></span>
      <span className="bf-profile__readout-gas"><small>Active gas / loop</small><strong>{selectedSegment.breathingLabel}</strong></span>
      {selectedSegment.setpoint !== undefined && <span><small>Setpoint</small><strong>{selectedSegment.setpoint.toFixed(2)} bar</strong></span>}
      {endpointCeilingText !== undefined && <span><small>Ceiling at this segment’s end</small><strong>{endpointCeilingText}</strong></span>}
      {selectedMarkers.length > 0 && <span className="bf-profile__readout-event"><small>Event marker</small><strong>{selectedMarkers.map((marker) => marker.label).join(" · ")}</strong></span>}
    </div>
    <div className="bf-profile__plot-frame">
      <svg
        aria-describedby={`${instructionsId} ${markersId}`}
        aria-label={title}
        aria-orientation="horizontal"
        aria-valuemax={Math.round(model.runtimeMaximum)}
        aria-valuemin={0}
        aria-valuenow={Math.round(selectedRuntime)}
        aria-valuetext={valueText}
        className="bf-profile__plot"
        data-testid="profile-scrubber"
        focusable="true"
        onKeyDown={onKeyDown}
        onPointerCancel={finishPointer}
        onPointerDown={(event) => {
          draggingRef.current = true;
          event.currentTarget.focus();
          if (event.nativeEvent.isTrusted) {
            event.currentTarget.setPointerCapture(event.pointerId);
          }
          updateFromPointer(event);
        }}
        onPointerMove={(event) => {
          if (event.pointerType === "mouse" || draggingRef.current) updateFromPointer(event);
        }}
        onPointerUp={finishPointer}
        role="slider"
        tabIndex={0}
        preserveAspectRatio="none"
        viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      >
        <defs>
          <clipPath id={`${svgId}-clip`}><rect height={plotHeight} width={plotWidth} x={PLOT_LEFT} y={PLOT_TOP} /></clipPath>
        </defs>
        <text className="bf-profile__axis-title" x={PLOT_LEFT} y="13">Depth ({unit})</text>
        {model.depthTicks.map((tick) => <g className="bf-profile__axis" key={`depth-${tick}`}>
          <line x1={PLOT_LEFT} x2={PLOT_RIGHT} y1={yForDepth(tick)} y2={yForDepth(tick)} />
          <text dominantBaseline="middle" textAnchor="end" x={PLOT_LEFT - 9} y={yForDepth(tick)}>{depthNumber.format(tick)}</text>
        </g>)}
        {runtimeTicks.map((tick) => <g className="bf-profile__axis" key={`runtime-${tick}`}>
          <line x1={xForRuntime(tick)} x2={xForRuntime(tick)} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
          <text
            textAnchor={tick <= EPSILON ? "start" : Math.abs(tick - model.runtimeMaximum) <= EPSILON ? "end" : "middle"}
            x={xForRuntime(tick)}
            y={PHASE_TOP + PHASE_HEIGHT + 24}
          >{formatRuntime(tick)}</text>
        </g>)}
        <g clipPath={`url(#${svgId}-clip)`}>
          {segments.filter((segment) => segment.kind === "stop" && segment.endRuntimeSeconds > segment.startRuntimeSeconds).map((segment) => <rect
            className="bf-profile__deco-window"
            height={plotHeight}
            key={`${segment.id}-deco`}
            width={Math.max(1, xForRuntime(segment.endRuntimeSeconds) - xForRuntime(segment.startRuntimeSeconds))}
            x={xForRuntime(segment.startRuntimeSeconds)}
            y={PLOT_TOP}
          />)}
          {areaPath && <path className="bf-profile__area" d={areaPath} />}
          {depthPolyline && <polyline className="bf-profile__line" points={depthPolyline} />}
          {model.markers.map((marker, index) => <g key={marker.id}>{markerShape(marker, xForRuntime(marker.runtimeSeconds), yForDepth(marker.depth), index + 1)}</g>)}
          {selectedCeilingValue !== undefined && selectedCeilingY !== undefined && <g aria-hidden="true" className="bf-profile__selected-ceiling">
            <circle className="bf-profile__ceiling-current" cx={selectedCeilingX} cy={selectedCeilingY} r="5" />
            <text
              className="bf-profile__ceiling-label"
              textAnchor={ceilingLabelAnchor}
              x={ceilingLabelX}
              y={ceilingLabelY}
            >Ceiling {formatCeiling(selectedCeilingValue, unit)} {unit} · {formatRuntime(selectedSegment.endRuntimeSeconds)}</text>
          </g>}
          <line className="bf-profile__crosshair" x1={selectedX} x2={selectedX} y1={PLOT_TOP} y2={PLOT_BOTTOM} />
          <circle className="bf-profile__current" cx={selectedX} cy={selectedY} r="5.5" />
        </g>
        <g aria-hidden="true" className="bf-profile__phase-strip">
          {segments.filter((segment) => segment.endRuntimeSeconds > segment.startRuntimeSeconds).map((segment) => <rect
            className={`bf-profile__phase bf-profile__phase--${phaseClass(segment.kind)}`}
            height={PHASE_HEIGHT}
            key={`${segment.id}-phase`}
            width={Math.max(1, xForRuntime(segment.endRuntimeSeconds) - xForRuntime(segment.startRuntimeSeconds))}
            x={xForRuntime(segment.startRuntimeSeconds)}
            y={PHASE_TOP}
          ><title>{phaseLabel(segment.kind)} · {formatRuntime(segment.endRuntimeSeconds - segment.startRuntimeSeconds)}</title></rect>)}
        </g>
        <text className="bf-profile__axis-title" textAnchor="middle" x={(PLOT_LEFT + PLOT_RIGHT) / 2} y={VIEW_HEIGHT - 4}>Runtime</text>
      </svg>
    </div>
    </div>
    <ul aria-label="Profile graph legend" className="bf-profile__legend">
      <li><span className="bf-profile__legend-line bf-profile__legend-line--depth" />Planned depth</li>
      <li><span className="bf-profile__legend-block bf-profile__legend-block--deco" />Deco stop</li>
      <li><span className="bf-profile__legend-marker bf-profile__legend-marker--switch" />Numbered gas / setpoint event</li>
      <li><span className="bf-profile__legend-marker bf-profile__legend-marker--reserve" />Numbered reserve event</li>
    </ul>
    <section aria-label="Timeline durations" className="bf-profile__phase-summary">
      <div className="bf-profile__phase-summary-heading"><strong>Timeline durations</strong><span>Colors match the strip below the graph.</span></div>
      <ul>{timelinePhases.map((phase) => <li key={phase.key}>
        <span aria-hidden="true" className={`bf-profile__phase-key bf-profile__phase-key--${phaseClass(phase.kind)}`} />
        <span>{phase.label}</span>
        <strong>{formatRuntime(phase.durationSeconds)}</strong>
      </li>)}</ul>
    </section>
    <aside className="bf-profile__ceiling-note">
      <span aria-hidden="true" className="bf-profile__legend-marker bf-profile__legend-marker--ceiling" />
      <p><strong>Selected segment’s decompression ceiling.</strong> The labeled amber marker uses horizontal position for segment-end time and vertical position for the model’s calculated shallow limit. No marker means no ceiling at that segment’s end; it jumps between exact checkpoints rather than drawing a continuous trace.</p>
    </aside>
    {model.markers.length > 0 && <section aria-labelledby={`${markersId}-title`} className="bf-profile__events">
      <div className="bf-profile__events-heading">
        <strong id={`${markersId}-title`}>Profile events</strong>
        <span>Numbers match the exact markers on the graph.</span>
      </div>
      <ol aria-label="Profile events" className="bf-profile__event-list" id={markersId}>
        {model.markers.map((marker, index) => {
          const active = Math.abs(marker.runtimeSeconds - selectedRuntime) <= EPSILON;
          return <li key={`${marker.id}-detail`}>
            <button
              aria-label={`Inspect ${marker.label} at ${formatRuntime(marker.runtimeSeconds)}`}
              data-active={active ? "" : undefined}
              onClick={() => setSelectedRuntime(marker.runtimeSeconds)}
              type="button"
            >
              <span aria-hidden="true" className="bf-profile__event-number" data-kind={marker.kind} data-tone={marker.tone ?? "default"}>{index + 1}</span>
              <span className="bf-profile__event-copy">
                <strong>{marker.label}</strong>
                <small>{formatRuntime(marker.runtimeSeconds)} · {depthNumber.format(marker.depth)} {unit}{marker.detail ? ` · ${marker.detail}` : ""}</small>
              </span>
            </button>
          </li>;
        })}
      </ol>
    </section>}
    {model.markers.length === 0 && <span className="bf-sr-only" id={markersId}>No switch or reserve markers.</span>}
    <details className="bf-profile__data">
      <summary>Profile data <span>{segments.length} segments</span></summary>
      <div className="bf-scroll-table">
        <table>
          <caption className="bf-sr-only">Profile segment data</caption>
          <thead><tr><th>Runtime</th><th>Depth ({unit})</th><th>End deco ceiling ({unit})</th><th>Phase</th><th>Breathing</th></tr></thead>
          <tbody>{segments.map((segment) => <tr key={segment.id}>
            <td>{formatRuntime(segment.startRuntimeSeconds)}–{formatRuntime(segment.endRuntimeSeconds)}</td>
            <td>{depthNumber.format(segment.startDepth)} → {depthNumber.format(segment.endDepth)}</td>
            <td>{segment.endpointCeiling === undefined ? "—" : formatCeiling(segment.endpointCeiling, unit)}</td>
            <td>{phaseLabel(segment.kind)}</td>
            <td>{segment.breathingLabel}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </section>;
}
