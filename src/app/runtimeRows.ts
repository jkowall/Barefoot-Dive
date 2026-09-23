/**
 * Presentation-only grouping of consecutive runtime-schedule segments.
 *
 * The planner emits one segment per stop-time quantum, so a 16-minute stop arrives as sixteen
 * identical one-minute `stop` segments. For the runtime table those rows are folded into one row
 * when the phase, end depth, gas, and setpoint are all identical. The chart and the profile data
 * table keep the raw segments. Nothing here changes calculated values.
 */
export type RuntimeSegment = {
  readonly kind: string;
  readonly startRuntimeSeconds: number;
  readonly durationSeconds: number;
  readonly endDepthM: number;
  readonly gasName: string;
  readonly setpointBar?: number;
};

export type GroupedRuntimeSegment = {
  readonly kind: string;
  readonly startRuntimeSeconds: number;
  readonly durationSeconds: number;
  readonly endDepthM: number;
  readonly gasName: string;
  readonly setpointBar?: number;
  /** Number of source segments folded into this row. */
  readonly count: number;
};

function sameGroup(a: RuntimeSegment, b: RuntimeSegment): boolean {
  return a.kind === b.kind
    && a.endDepthM === b.endDepthM
    && a.gasName === b.gasName
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
        endDepthM: segment.endDepthM,
        gasName: segment.gasName,
        ...(segment.setpointBar === undefined ? {} : { setpointBar: segment.setpointBar }),
        count: 1,
      });
    }
  }
  return rows;
}
