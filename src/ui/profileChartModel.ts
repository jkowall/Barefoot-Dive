export type ChartSegmentInput = {
  readonly id: string;
  readonly kind: string;
  readonly startRuntimeSeconds: number;
  readonly endRuntimeSeconds: number;
  readonly startDepth: number;
  readonly endDepth: number;
  readonly breathingLabel: string;
  readonly planMode: string;
  readonly setpoint?: number;
  readonly endpointCeiling?: number;
};

export type ReserveCrossingInput = {
  readonly id: string;
  readonly runtimeSeconds: number;
  readonly depth: number;
  readonly label?: string;
  readonly detail?: string;
  readonly tone?: ChartMarkerTone;
};

export type ChartPoint = {
  readonly runtimeSeconds: number;
  readonly depth: number;
  readonly xPercent: number;
};

export type ChartBoundary = ChartPoint & {
  readonly id: string;
  readonly segmentId: string;
  readonly label: string;
  readonly breathingLabel: string;
  readonly planMode: string;
  readonly setpoint?: number;
};

export type ChartMarkerTone = "default" | "warning" | "danger";

export type ChartMarker = ChartPoint & {
  readonly id: string;
  readonly kind: "gas-switch" | "setpoint-switch" | "reserve-crossing";
  readonly label: string;
  readonly detail?: string;
  readonly tone?: ChartMarkerTone;
};

export type ProfileChartModel = {
  readonly runtimeMaximum: number;
  readonly depthMaximum: number;
  readonly runtimeTicks: readonly number[];
  readonly depthTicks: readonly number[];
  readonly depthPoints: readonly ChartPoint[];
  readonly ceilingPoints: readonly ChartPoint[];
  readonly boundaries: readonly ChartBoundary[];
  readonly boundaryTimes: readonly number[];
  readonly markers: readonly ChartMarker[];
};

export type ChartModelOptions = {
  readonly runtimeTickCount?: number;
  readonly depthTickCount?: number;
};

const EPSILON = 1e-9;

export function runtimeToPercent(runtime: number, runtimeMaximum: number): number {
  if (runtimeMaximum <= 0) return 0;
  return Math.max(0, Math.min(100, (runtime / runtimeMaximum) * 100));
}

function niceStep(span: number, targetTickCount: number): number {
  const roughStep = span / Math.max(1, targetTickCount - 1);
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function niceTicks(minimum: number, maximum: number, targetTickCount = 5): readonly number[] {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum)) return [];
  if (maximum < minimum) return niceTicks(maximum, minimum, targetTickCount);
  if (Math.abs(maximum - minimum) <= EPSILON) return [minimum];

  const step = niceStep(maximum - minimum, targetTickCount);
  const first = Math.floor(minimum / step) * step;
  const last = Math.ceil(maximum / step) * step;
  const precision = Math.max(0, -Math.floor(Math.log10(step)) + 2);
  const ticks: number[] = [];
  for (let tick = first; tick <= last + step * EPSILON; tick += step) {
    ticks.push(Number(tick.toFixed(precision)));
  }
  return ticks;
}

export function phaseLabel(kind: string): string {
  const known: Readonly<Record<string, string>> = {
    descent: "Descent",
    bottom: "Bottom",
    ascent: "Ascent",
    stop: "Deco stop",
    "gas-switch": "Gas switch",
    "setpoint-switch": "Setpoint switch",
    penetration: "Penetration",
    exit: "Exit",
    bailout: "Bailout",
  };
  if (known[kind]) return known[kind];
  const words = kind.replaceAll("-", " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Profile event";
}

/**
 * Finds the segment active at a runtime. Positive-duration segments use
 * half-open intervals, except that the final endpoint belongs to the final
 * segment. A zero-duration event is selectable exactly at its runtime.
 */
export function findActiveSegment(
  segments: readonly ChartSegmentInput[],
  runtime: number,
): ChartSegmentInput | undefined {
  const zeroDuration = segments.find((segment) =>
    segment.endRuntimeSeconds === segment.startRuntimeSeconds &&
    Math.abs(segment.startRuntimeSeconds - runtime) <= EPSILON
  );
  if (zeroDuration) return zeroDuration;

  const finalRuntime = segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.endRuntimeSeconds),
    0,
  );
  return segments.find((segment) => {
    if (segment.endRuntimeSeconds <= segment.startRuntimeSeconds) return false;
    const endRuntime = segment.endRuntimeSeconds;
    return runtime >= segment.startRuntimeSeconds - EPSILON &&
      (runtime < endRuntime - EPSILON || (
        Math.abs(runtime - finalRuntime) <= EPSILON &&
        Math.abs(endRuntime - finalRuntime) <= EPSILON
      ));
  });
}

/** Interpolates only the planned linear depth path within one segment. */
export function interpolatePlannedDepth(segment: ChartSegmentInput, runtime: number): number {
  const duration = segment.endRuntimeSeconds - segment.startRuntimeSeconds;
  if (duration <= 0) return segment.endDepth;
  const fraction = Math.max(0, Math.min(1, (runtime - segment.startRuntimeSeconds) / duration));
  return segment.startDepth + (segment.endDepth - segment.startDepth) * fraction;
}

function appendPoint(points: ChartPoint[], runtimeSeconds: number, depth: number, runtimeMaximum: number): void {
  const previous = points.at(-1);
  if (previous && Math.abs(previous.runtimeSeconds - runtimeSeconds) <= EPSILON && Math.abs(previous.depth - depth) <= EPSILON) {
    return;
  }
  points.push({ runtimeSeconds, depth, xPercent: runtimeToPercent(runtimeSeconds, runtimeMaximum) });
}

function meaningfulBoundaries(
  segments: readonly ChartSegmentInput[],
  runtimeMaximum: number,
): readonly ChartBoundary[] {
  if (segments.length === 0) return [];
  const boundaries: ChartBoundary[] = [];
  segments.forEach((segment, index) => {
    const previous = segments[index - 1];
    const meaningful = index === 0 ||
      segment.kind !== previous.kind ||
      segment.breathingLabel !== previous.breathingLabel ||
      segment.planMode !== previous.planMode ||
      segment.setpoint !== previous.setpoint ||
      segment.kind === "gas-switch" ||
      segment.kind === "setpoint-switch";
    if (meaningful) {
      boundaries.push({
        id: `${segment.id}-start`,
        segmentId: segment.id,
        runtimeSeconds: segment.startRuntimeSeconds,
        depth: segment.startDepth,
        xPercent: runtimeToPercent(segment.startRuntimeSeconds, runtimeMaximum),
        label: phaseLabel(segment.kind),
        breathingLabel: segment.breathingLabel,
        planMode: segment.planMode,
        ...(segment.setpoint === undefined ? {} : { setpoint: segment.setpoint }),
      });
    }
  });

  const final = segments.reduce((latest, segment) =>
    segment.endRuntimeSeconds >= latest.endRuntimeSeconds ? segment : latest
  );
  boundaries.push({
    id: `${final.id}-end`,
    segmentId: final.id,
    runtimeSeconds: final.endRuntimeSeconds,
    depth: final.endDepth,
    xPercent: runtimeToPercent(final.endRuntimeSeconds, runtimeMaximum),
    label: "Profile end",
    breathingLabel: final.breathingLabel,
    planMode: final.planMode,
    ...(final.setpoint === undefined ? {} : { setpoint: final.setpoint }),
  });
  return boundaries;
}

export function buildProfileChartModel(
  segments: readonly ChartSegmentInput[],
  reserveCrossings: readonly ReserveCrossingInput[] = [],
  options: ChartModelOptions = {},
): ProfileChartModel {
  const runtimeMaximum = segments.reduce(
    (maximum, segment) => Math.max(maximum, segment.endRuntimeSeconds),
    0,
  );
  const depthMaximum = Math.max(
    0,
    ...segments.flatMap((segment) => [segment.startDepth, segment.endDepth, segment.endpointCeiling ?? 0]),
    ...reserveCrossings.map((crossing) => crossing.depth),
  );
  const depthPoints: ChartPoint[] = [];
  const ceilingPoints: ChartPoint[] = [];
  for (const segment of segments) {
    appendPoint(depthPoints, segment.startRuntimeSeconds, segment.startDepth, runtimeMaximum);
    appendPoint(
      depthPoints,
      segment.endRuntimeSeconds,
      segment.endDepth,
      runtimeMaximum,
    );
    if (segment.endpointCeiling !== undefined) {
      appendPoint(
        ceilingPoints,
        segment.endRuntimeSeconds,
        segment.endpointCeiling,
        runtimeMaximum,
      );
    }
  }

  const switchMarkers: ChartMarker[] = segments
    .filter((segment): segment is ChartSegmentInput & { kind: "gas-switch" | "setpoint-switch" } =>
      segment.kind === "gas-switch" || segment.kind === "setpoint-switch"
    )
    .map((segment) => ({
      id: `${segment.id}-marker`,
      kind: segment.kind,
      runtimeSeconds: segment.startRuntimeSeconds,
      depth: segment.startDepth,
      xPercent: runtimeToPercent(segment.startRuntimeSeconds, runtimeMaximum),
      label: `${phaseLabel(segment.kind)} · ${segment.breathingLabel}`,
      ...(segment.setpoint === undefined ? {} : { detail: `Setpoint ${segment.setpoint.toFixed(2)} bar` }),
    }));
  const reserveMarkers: ChartMarker[] = reserveCrossings.map((crossing) => ({
    id: crossing.id,
    kind: "reserve-crossing",
    runtimeSeconds: crossing.runtimeSeconds,
    depth: crossing.depth,
    xPercent: runtimeToPercent(crossing.runtimeSeconds, runtimeMaximum),
    label: crossing.label ?? "Reserve crossing",
    ...(crossing.detail === undefined ? {} : { detail: crossing.detail }),
    ...(crossing.tone === undefined ? {} : { tone: crossing.tone }),
  }));

  const boundaryTimes = [...new Set([
    0,
    ...segments.flatMap((segment) => [segment.startRuntimeSeconds, segment.endRuntimeSeconds]),
    ...reserveCrossings.map((crossing) => crossing.runtimeSeconds),
    runtimeMaximum,
  ])].sort((left, right) => left - right);

  const markers = [...switchMarkers, ...reserveMarkers].sort((left, right) =>
    left.runtimeSeconds - right.runtimeSeconds || left.label.localeCompare(right.label)
  );

  return {
    runtimeMaximum,
    depthMaximum,
    runtimeTicks: niceTicks(0, runtimeMaximum, options.runtimeTickCount),
    depthTicks: niceTicks(0, depthMaximum, options.depthTickCount),
    depthPoints,
    ceilingPoints,
    boundaries: meaningfulBoundaries(segments, runtimeMaximum),
    boundaryTimes,
    markers,
  };
}
