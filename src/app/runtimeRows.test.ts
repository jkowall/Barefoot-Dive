import { describe, expect, it } from "vitest";
import { groupRuntimeSegments, type RuntimeSegment } from "./runtimeRows";

function stop(start: number, depth: number, gas = "Oxygen", setpointBar?: number): RuntimeSegment {
  return { kind: "stop", startRuntimeSeconds: start, durationSeconds: 60, endDepthM: depth, gasName: gas, ...(setpointBar === undefined ? {} : { setpointBar }) };
}

describe("groupRuntimeSegments", () => {
  it("folds a sixteen-minute stop into one row with the summed duration", () => {
    const segments = Array.from({ length: 16 }, (_, index) => stop(1200 + index * 60, 6));
    const rows = groupRuntimeSegments(segments);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "stop", startRuntimeSeconds: 1200, durationSeconds: 960, endDepthM: 6, gasName: "Oxygen", count: 16 });
  });

  it("splits a run at a gas switch and keeps the switch row", () => {
    const segments: RuntimeSegment[] = [
      stop(0, 21, "EAN50"),
      stop(60, 21, "EAN50"),
      { kind: "gas-switch", startRuntimeSeconds: 120, durationSeconds: 0, endDepthM: 21, gasName: "Oxygen" },
      stop(120, 21, "Oxygen"),
      stop(180, 21, "Oxygen"),
    ];
    const rows = groupRuntimeSegments(segments);
    expect(rows.map((row) => [row.kind, row.gasName, row.durationSeconds, row.count])).toEqual([
      ["stop", "EAN50", 120, 2],
      ["gas-switch", "Oxygen", 0, 1],
      ["stop", "Oxygen", 120, 2],
    ]);
  });

  it("never folds ascent segments that end at different depths", () => {
    const segments: RuntimeSegment[] = [
      { kind: "ascent", startRuntimeSeconds: 0, durationSeconds: 60, endDepthM: 18, gasName: "Tx18/45" },
      { kind: "ascent", startRuntimeSeconds: 60, durationSeconds: 60, endDepthM: 15, gasName: "Tx18/45" },
      { kind: "ascent", startRuntimeSeconds: 120, durationSeconds: 60, endDepthM: 12, gasName: "Tx18/45" },
    ];
    expect(groupRuntimeSegments(segments)).toHaveLength(3);
  });

  it("splits on a setpoint change and preserves the total duration", () => {
    const segments = [stop(0, 6, "Diluent", 1.3), stop(60, 6, "Diluent", 1.3), stop(120, 6, "Diluent", 1.6), stop(180, 6, "Diluent", 1.6)];
    const rows = groupRuntimeSegments(segments);
    expect(rows).toHaveLength(2);
    expect(rows.reduce((total, row) => total + row.durationSeconds, 0)).toBe(segments.reduce((total, row) => total + row.durationSeconds, 0));
  });

  it("does not fold segments that are not contiguous in runtime", () => {
    expect(groupRuntimeSegments([stop(0, 6), stop(120, 6)])).toHaveLength(2);
  });
});
