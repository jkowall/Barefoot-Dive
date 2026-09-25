/**
 * Presentation-only grouping of consecutive runtime-schedule segments.
 *
 * The planner emits one segment per stop-time quantum, so a 16-minute stop arrives as sixteen
 * identical one-minute `stop` segments. For the runtime table those rows are folded into one row
 * when the phase, end depth, gas, and setpoint are all identical. Gases are compared by identifier
 * when segments carry one, because two cylinders' gases can share a name ("Air" and "Air"). The
 * chart and the profile data table keep the raw segments. Nothing here changes calculated values.
 */
export type RuntimeSegment = {
  readonly kind: string;
  readonly startRuntimeSeconds: number;
  readonly durationSeconds: number;
  readonly startDepthM?: number;
  readonly endDepthM: number;
  /** The gas identifier; two gases can share a display name. */
  readonly gasId?: string;
  readonly gasName: string;
  readonly setpointBar?: number;
};

export type GroupedRuntimeSegment = {
  readonly kind: string;
  readonly startRuntimeSeconds: number;
  readonly durationSeconds: number;
  readonly startDepthM?: number;
  readonly endDepthM: number;
  readonly gasId?: string;
  readonly gasName: string;
  readonly setpointBar?: number;
  /** Number of source segments folded into this row. */
  readonly count: number;
  /** Travel from the previous stop folded into this stop row, in seconds. */
  readonly includedTravelSeconds?: number;
  /** A gas or setpoint switch made on arrival at this stop and folded into the row. */
  readonly arrivalSwitch?: string;
  /** Gas breathed on the folded travel when a switch on arrival changed it; `gasName` is the stop's gas. */
  readonly travelGasName?: string;
};

/** The same gas: by identifier when both carry one, otherwise by name. */
function sameGas(a: Pick<RuntimeSegment, "gasId" | "gasName">, b: Pick<RuntimeSegment, "gasId" | "gasName">): boolean {
  return a.gasId !== undefined && b.gasId !== undefined ? a.gasId === b.gasId : a.gasName === b.gasName;
}

function sameGroup(a: RuntimeSegment, b: RuntimeSegment): boolean {
  return a.kind === b.kind
    && a.endDepthM === b.endDepthM
    && sameGas(a, b)
    && a.setpointBar === b.setpointBar;
}

export function groupRuntimeSegments(segments: readonly RuntimeSegment[]): readonly GroupedRuntimeSegment[] {
  const rows: GroupedRuntimeSegment[] = [];
  for (const segment of segments) {
    const last = rows.at(-1);
    if (last && sameGroup(last, segment) && last.startRuntimeSeconds + last.durationSeconds === segment.startRuntimeSeconds) {
      rows[rows.length - 1] = { ...last, durationSeconds: last.durationSeconds + segment.durationSeconds, count: last.count + 1 };
    } else {
      rows.push({
        kind: segment.kind,
        startRuntimeSeconds: segment.startRuntimeSeconds,
        durationSeconds: segment.durationSeconds,
        ...(segment.startDepthM === undefined ? {} : { startDepthM: segment.startDepthM }),
        endDepthM: segment.endDepthM,
        ...(segment.gasId === undefined ? {} : { gasId: segment.gasId }),
        gasName: segment.gasName,
        ...(segment.setpointBar === undefined ? {} : { setpointBar: segment.setpointBar }),
        count: 1,
      });
    }
  }
  return rows;
}

const TRAVEL_KINDS = new Set(["ascent", "bailout"]);
const SWITCH_KINDS = new Set(["gas-switch", "setpoint-switch"]);
/** Switch rows last 0 s, or 5 s under the Shearwater preset. */
const MAX_SWITCH_SECONDS = 5;
const DEPTH_TOLERANCE_M = 1e-6;

const isSwitch = (row: GroupedRuntimeSegment | undefined): row is GroupedRuntimeSegment =>
  row !== undefined && SWITCH_KINDS.has(row.kind) && row.durationSeconds <= MAX_SWITCH_SECONDS;

/**
 * Fold each ascent between two stops into the stop it arrives at, so the stop row covers the
 * time from leaving the previous stop (a 1:00 ascent and a 1:00 stop read as one 2:00 stop).
 * Presentation only: the runtime, the order, and every segment keep their calculated values.
 *
 * A travel row folds only when it is a single leg that starts at the previous stop's depth and
 * ends at the next stop's depth. The ascent to the first stop, the final ascent to the surface,
 * cave exit legs, legs split at a switch or waypoint, and switches made when leaving a stop keep
 * their own rows. A switch made on arrival folds into the stop row and is named there; when it
 * changes the gas, the row also keeps the travel gas, because the row starts when the diver leaves
 * the previous stop, still on that gas.
 */
export function foldTravelIntoStops(rows: readonly GroupedRuntimeSegment[]): readonly GroupedRuntimeSegment[] {
  const folded: GroupedRuntimeSegment[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const travel = rows[index];
    if (!TRAVEL_KINDS.has(travel.kind) || travel.count !== 1) {
      folded.push(travel);
      continue;
    }
    let previousIndex = folded.length - 1;
    while (previousIndex >= 0 && isSwitch(folded[previousIndex])) previousIndex -= 1;
    const previous = folded[previousIndex];
    const arrival = isSwitch(rows[index + 1]) ? rows[index + 1] : undefined;
    const stop = rows[index + (arrival ? 2 : 1)];
    const fromPreviousStop = previous?.kind === "stop" && (
      travel.startDepthM === undefined || Math.abs(travel.startDepthM - previous.endDepthM) <= DEPTH_TOLERANCE_M
    );
    const toNextStop = stop?.kind === "stop"
      && Math.abs(stop.endDepthM - travel.endDepthM) <= DEPTH_TOLERANCE_M
      && (!arrival || Math.abs(arrival.endDepthM - travel.endDepthM) <= DEPTH_TOLERANCE_M);
    if (!fromPreviousStop || !toNextStop) {
      folded.push(travel);
      continue;
    }
    const arrivalSeconds = arrival?.durationSeconds ?? 0;
    folded.push({
      ...stop,
      startRuntimeSeconds: travel.startRuntimeSeconds,
      durationSeconds: travel.durationSeconds + arrivalSeconds + stop.durationSeconds,
      ...(travel.startDepthM === undefined ? {} : { startDepthM: travel.startDepthM }),
      count: stop.count + 1 + (arrival ? 1 : 0),
      includedTravelSeconds: travel.durationSeconds,
      ...(arrival ? { arrivalSwitch: arrival.kind } : {}),
      ...(sameGas(travel, stop) ? {} : { travelGasName: travel.gasName }),
    });
    index += arrival ? 2 : 1;
  }
  return folded;
}

/** Runtime-table rows: identical quanta grouped, then between-stop travel folded into its stop. */
export function runtimeScheduleRows(segments: readonly RuntimeSegment[]): readonly GroupedRuntimeSegment[] {
  return foldTravelIntoStops(groupRuntimeSegments(segments));
}
