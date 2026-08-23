import { describe, expect, it } from "vitest";
import {
  buildProfileChartModel,
  findActiveSegment,
  interpolatePlannedDepth,
  niceTicks,
  phaseLabel,
  runtimeToPercent,
  summarizeTimelinePhases,
  type ChartSegmentInput,
} from "./profileChartModel";

const segments: readonly ChartSegmentInput[] = [
  { id: "descent", kind: "descent", startRuntimeSeconds: 0, endRuntimeSeconds: 60, startDepth: 0, endDepth: 30, endpointCeiling: 0, breathingLabel: "Air", planMode: "OC" },
  { id: "bottom", kind: "bottom", startRuntimeSeconds: 60, endRuntimeSeconds: 600, startDepth: 30, endDepth: 30, endpointCeiling: 3, breathingLabel: "Air", planMode: "OC" },
  { id: "switch", kind: "gas-switch", startRuntimeSeconds: 600, endRuntimeSeconds: 600, startDepth: 30, endDepth: 30, endpointCeiling: 3, breathingLabel: "EAN50", planMode: "OC" },
  { id: "ascent", kind: "ascent", startRuntimeSeconds: 600, endRuntimeSeconds: 900, startDepth: 30, endDepth: 0, endpointCeiling: 0, breathingLabel: "EAN50", planMode: "OC" },
];

describe("profile chart model", () => {
  it("uses actual elapsed time for unequal-duration segment geometry", () => {
    const model = buildProfileChartModel(segments);
    expect(model.runtimeMaximum).toBe(900);
    expect(model.depthPoints[1]).toEqual({ runtimeSeconds: 60, depth: 30, xPercent: 60 / 9 });
    expect(model.depthPoints.at(-1)).toEqual({ runtimeSeconds: 900, depth: 0, xPercent: 100 });
    expect(runtimeToPercent(600, model.runtimeMaximum)).toBeCloseTo(66.6666667);
  });

  it("retains the initial and final profile endpoints", () => {
    const model = buildProfileChartModel(segments);
    expect(model.depthPoints[0]).toEqual({ runtimeSeconds: 0, depth: 0, xPercent: 0 });
    expect(model.boundaries[0]).toMatchObject({ runtimeSeconds: 0, label: "Descent" });
    expect(model.boundaries.at(-1)).toMatchObject({ runtimeSeconds: 900, depth: 0, label: "Profile end" });
    expect(model.boundaryTimes).toEqual([0, 60, 600, 900]);
  });

  it("creates stable nice ticks, including a degenerate range", () => {
    expect(niceTicks(0, 37, 5)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0, 600, 6)).toEqual([0, 200, 400, 600]);
    expect(niceTicks(4, 4)).toEqual([4]);
  });

  it("uses half-open intervals at ordinary segment boundaries", () => {
    const withoutSwitch = segments.filter((segment) => segment.id !== "switch");
    expect(findActiveSegment(withoutSwitch, 59.999)?.id).toBe("descent");
    expect(findActiveSegment(withoutSwitch, 60)?.id).toBe("bottom");
    expect(findActiveSegment(withoutSwitch, 900)?.id).toBe("ascent");
    expect(findActiveSegment(withoutSwitch, 901)).toBeUndefined();
  });

  it("selects a zero-duration switch exactly at its marker runtime", () => {
    expect(findActiveSegment(segments, 600)?.id).toBe("switch");
    expect(findActiveSegment(segments, 600.001)?.id).toBe("ascent");
  });

  it("interpolates only planned depth and clamps outside a segment", () => {
    expect(interpolatePlannedDepth(segments[0], 30)).toBe(15);
    expect(interpolatePlannedDepth(segments[0], -10)).toBe(0);
    expect(interpolatePlannedDepth(segments[0], 90)).toBe(30);
    expect(interpolatePlannedDepth(segments[2], 600)).toBe(30);
  });

  it("passes unit-fed depth values through without conversion", () => {
    const imperial = [{ ...segments[0], startDepth: 0, endDepth: 98.4, endpointCeiling: 9.8 }];
    const model = buildProfileChartModel(imperial);
    expect(model.depthMaximum).toBe(98.4);
    expect(model.depthPoints.at(-1)?.depth).toBe(98.4);
    expect(model.ceilingPoints[0].depth).toBe(9.8);
  });

  it("places switch and reserve markers by actual runtime", () => {
    const model = buildProfileChartModel(segments, [
      { id: "reserve-backgas", runtimeSeconds: 450, depth: 30, label: "Back gas reserve", detail: "100 bar", tone: "danger" },
    ]);
    expect(model.markers).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "gas-switch", runtimeSeconds: 600, depth: 30, label: "Gas switch · EAN50" }),
      expect.objectContaining({ kind: "reserve-crossing", runtimeSeconds: 450, depth: 30, xPercent: 50, label: "Back gas reserve", detail: "100 bar", tone: "danger" }),
    ]));
    expect(model.markers.find((marker) => marker.kind === "gas-switch")?.xPercent).toBeCloseTo(600 / 9);
    expect(model.markers.map((marker) => marker.runtimeSeconds)).toEqual([450, 600]);
    expect(model.boundaryTimes).toEqual([0, 60, 450, 600, 900]);
  });

  it("returns a complete empty model and handles one segment", () => {
    expect(buildProfileChartModel([])).toEqual({
      runtimeMaximum: 0,
      depthMaximum: 0,
      runtimeTicks: [0],
      depthTicks: [0],
      depthPoints: [],
      ceilingPoints: [],
      boundaries: [],
      boundaryTimes: [0],
      markers: [],
    });
    const single = buildProfileChartModel([segments[0]]);
    expect(single.depthPoints).toHaveLength(2);
    expect(single.boundaries.map((boundary) => boundary.label)).toEqual(["Descent", "Profile end"]);
  });

  it("provides readable labels for known and custom phases", () => {
    expect(phaseLabel("stop")).toBe("Deco stop");
    expect(phaseLabel("lost-gas-exit")).toBe("Lost gas exit");
  });

  it("sums emitted timeline durations by meaningful travel and hold phases", () => {
    const summaries = summarizeTimelinePhases([
      ...segments,
      { id: "penetration", kind: "penetration", startRuntimeSeconds: 900, endRuntimeSeconds: 1_200, startDepth: 0, endDepth: 20, breathingLabel: "Air", planMode: "OC" },
      { id: "exit", kind: "exit", startRuntimeSeconds: 1_200, endRuntimeSeconds: 1_500, startDepth: 20, endDepth: 0, breathingLabel: "Air", planMode: "OC" },
      { id: "bailout", kind: "bailout", startRuntimeSeconds: 1_500, endRuntimeSeconds: 1_620, startDepth: 20, endDepth: 10, breathingLabel: "EAN50", planMode: "CCR" },
      { id: "stop", kind: "stop", startRuntimeSeconds: 1_620, endRuntimeSeconds: 1_680, startDepth: 10, endDepth: 10, breathingLabel: "EAN50", planMode: "CCR" },
      { id: "stop-2", kind: "stop", startRuntimeSeconds: 1_680, endRuntimeSeconds: 1_740, startDepth: 6, endDepth: 6, breathingLabel: "Oxygen", planMode: "CCR" },
    ]);

    expect(summaries).toEqual([
      { key: "descent", kind: "descent", label: "Descent travel", durationSeconds: 60 },
      { key: "bottom", kind: "bottom", label: "Bottom time", durationSeconds: 540 },
      { key: "ascent", kind: "ascent", label: "Ascent travel", durationSeconds: 300 },
      { key: "penetration", kind: "penetration", label: "Penetration travel", durationSeconds: 300 },
      { key: "exit", kind: "exit", label: "Exit travel", durationSeconds: 300 },
      { key: "bailout", kind: "bailout", label: "Bailout travel", durationSeconds: 120 },
      { key: "stop", kind: "stop", label: "Deco stops", durationSeconds: 120 },
    ]);
  });
});
