import { describe, expect, it } from "vitest";
import { calculateDivePlan } from "../engine/planner";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput } from "./planning";
import { groupRuntimeSegments, runtimeScheduleRows, type RuntimeSegment } from "./runtimeRows";

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

function segment(kind: string, start: number, duration: number, from: number, to: number, gas = "EAN50", setpointBar?: number): RuntimeSegment {
  return { kind, startRuntimeSeconds: start, durationSeconds: duration, startDepthM: from, endDepthM: to, gasName: gas, ...(setpointBar === undefined ? {} : { setpointBar }) };
}

describe("runtimeScheduleRows", () => {
  const summary = (rows: ReturnType<typeof runtimeScheduleRows>) => rows.map((row) => [row.kind, row.endDepthM, row.durationSeconds, row.includedTravelSeconds ?? null]);

  it("folds the ascent between two stops into the stop it reaches", () => {
    const rows = runtimeScheduleRows([
      segment("bottom", 0, 1500, 36, 36, "Tx18/45"),
      segment("ascent", 1500, 104, 36, 18, "Tx18/45"),
      segment("stop", 1604, 60, 18, 18),
      segment("ascent", 1664, 60, 18, 15),
      segment("stop", 1724, 60, 15, 15),
      segment("ascent", 1784, 60, 15, 12),
      segment("stop", 1844, 60, 12, 12),
      segment("stop", 1904, 60, 12, 12),
      segment("ascent", 1964, 240, 12, 0),
    ]);
    expect(summary(rows)).toEqual([
      ["bottom", 36, 1500, null],
      ["ascent", 18, 104, null],
      ["stop", 18, 60, null],
      ["stop", 15, 120, 60],
      ["stop", 12, 180, 60],
      ["ascent", 0, 240, null],
    ]);
    expect(rows[3].startRuntimeSeconds).toBe(1664);
  });

  it("folds a gas switch made on arrival and names it", () => {
    const rows = runtimeScheduleRows([
      segment("stop", 0, 60, 9, 9),
      segment("ascent", 60, 60, 9, 6),
      segment("gas-switch", 120, 0, 6, 6, "Oxygen"),
      segment("stop", 120, 60, 6, 6, "Oxygen"),
      segment("stop", 180, 60, 6, 6, "Oxygen"),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({ kind: "stop", gasName: "Oxygen", startRuntimeSeconds: 60, durationSeconds: 180, includedTravelSeconds: 60, arrivalSwitch: "gas-switch" });
    // The row starts on the travel gas, so it keeps that gas as well as the stop's.
    expect(rows[1]!.travelGasName).toBe("EAN50");
    expect(rows[0]!.travelGasName).toBeUndefined();
  });

  it("keeps a setpoint switch made when leaving a stop as its own row", () => {
    const rows = runtimeScheduleRows([
      segment("stop", 0, 60, 9, 9, "Diluent", 1.3),
      segment("setpoint-switch", 60, 0, 9, 9, "Diluent", 0.7),
      segment("ascent", 60, 60, 9, 6, "Diluent", 0.7),
      segment("stop", 120, 60, 6, 6, "Diluent", 0.7),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["stop", "setpoint-switch", "stop"]);
    expect(rows[2]).toMatchObject({ durationSeconds: 120, includedTravelSeconds: 60 });
    expect(rows[2]!.travelGasName).toBeUndefined();
  });

  it("keeps a leg that is split mid-way as separate rows", () => {
    const rows = runtimeScheduleRows([
      segment("stop", 0, 60, 9, 9, "Diluent", 1.3),
      segment("ascent", 60, 30, 9, 7.5, "Diluent", 1.3),
      segment("setpoint-switch", 90, 0, 7.5, 7.5, "Diluent", 0.7),
      segment("ascent", 90, 30, 7.5, 6, "Diluent", 0.7),
      segment("stop", 120, 60, 6, 6, "Diluent", 0.7),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(["stop", "ascent", "setpoint-switch", "ascent", "stop"]);
  });

  it("folds bailout travel between stops but never a cave exit leg", () => {
    const bailout = runtimeScheduleRows([
      segment("stop", 0, 60, 12, 12, "Bailout"),
      segment("bailout", 60, 60, 12, 9, "Bailout"),
      segment("stop", 120, 60, 9, 9, "Bailout"),
    ]);
    expect(bailout).toHaveLength(2);
    const exit = runtimeScheduleRows([
      segment("stop", 0, 60, 12, 12),
      segment("exit", 60, 300, 12, 12),
      segment("stop", 360, 60, 12, 12),
    ]);
    expect(exit.map((row) => row.kind)).toEqual(["stop", "exit", "stop"]);
  });

  it("preserves every second and the order of a calculated plan", () => {
    const result = calculateDivePlan(resolvePlanInput(DEFAULT_PLAN_DRAFT, []).input!);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const rows = runtimeScheduleRows(result.value.segments);
    const total = result.value.segments.reduce((sum, item) => sum + item.durationSeconds, 0);
    expect(rows.reduce((sum, row) => sum + row.durationSeconds, 0)).toBe(total);
    rows.slice(1).forEach((row, index) => {
      expect(row.startRuntimeSeconds).toBe(rows[index].startRuntimeSeconds + rows[index].durationSeconds);
    });
    // Only the ascent to the first stop and the final ascent keep their own travel rows.
    const firstStop = rows.findIndex((row) => row.kind === "stop");
    const lastStop = rows.length - 1 - [...rows].reverse().findIndex((row) => row.kind === "stop");
    expect(rows.slice(firstStop, lastStop + 1).some((row) => row.kind === "ascent")).toBe(false);
  });
});
