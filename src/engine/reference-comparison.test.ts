import { describe, expect, it } from "vitest";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
  EAN50,
} from "../domain/defaults";
import type { CcrDiveInput } from "../domain/types";
import { barAbsolute, meters, seconds } from "../domain/units";
import { calculateEventDivePlan, type ExposureEvent } from "./planner";

// Published comparison inputs and outputs are pinned to Abysner commit 43823b9:
// https://github.com/NeoTech-Software/Abysner/blob/43823b96cd2388aaf311f6969c26200cf5924365/readme.md#compared-to-other-planners
// These are comparison envelopes, not parity claims. Abysner records small
// schedule differences among itself, Subsurface, and DIVESOFT.APP. The source
// labels plans 2, 6, and 7 as salt water but does not expose the exact pressure
// conversion in this comparison table; Barefoot uses its documented 10 m/bar
// sea-level environment. Barefoot also models gas switches as zero-duration,
// while the published Abysner schedules include a one-minute switch. These
// deliberate input differences are why only broad published envelopes are used.
const comparisonSettings = {
  ...DEFAULT_PLANNER_SETTINGS,
  descentRateMPerMinute: 5,
  ascentRateMPerMinute: 5,
  decoAscentRateMPerMinute: 5,
  lastStopDepthM: meters(3),
};
const bailoutAir = { ...AIR, id: "bailout-air", role: "bailout" as const };

function ccrInput(): CcrDiveInput {
  return {
    mode: "ccr",
    environment: "open-water",
    depthM: meters(30),
    bottomTimeSeconds: seconds(24 * 60),
    diluent: AIR,
    setpointBar: barAbsolute(1.2),
    // 2.7 m is the shallowest physically achievable 1.2 bar setpoint under
    // this engine's explicit water-vapor correction.
    setpointActivationDepthM: meters(2.7),
    bailoutGases: [bailoutAir],
    cylinders: [],
    settings: comparisonSettings,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
  };
}

function ccrBottomEvents(): readonly ExposureEvent[] {
  return [{
    id: "descent",
    kind: "descent",
    startDepthM: meters(0),
    endDepthM: meters(30),
    durationSeconds: seconds(6 * 60),
    gas: AIR,
    strategy: { kind: "ccr", diluent: AIR, setpointBar: barAbsolute(0.7) },
  }, {
    id: "bottom",
    kind: "bottom",
    startDepthM: meters(30),
    endDepthM: meters(30),
    durationSeconds: seconds(24 * 60),
    gas: AIR,
    strategy: { kind: "ccr", diluent: AIR, setpointBar: barAbsolute(1.2) },
  }];
}

describe("published cross-planner comparison envelopes", () => {
  it("falls inside the Abysner/Subsurface/DIVESOFT OC multigas runtime and stop-time envelope", () => {
    // Reference plan 2: 30 m / 30 min including descent, air + EAN50,
    // GF 30/70, 5 m/min, 6 m last stop. Published runtime is 48–50 min
    // and total stop time is 12–14 min across the three planners.
    const result = calculateEventDivePlan({
      mode: "oc",
      environment: "open-water",
      depthM: meters(30),
      bottomTimeSeconds: seconds(24 * 60),
      bottomGas: AIR,
      decoGases: [EAN50],
      cylinders: [],
      settings: { ...comparisonSettings, lastStopDepthM: meters(6) },
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    }, [{
      id: "descent",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(30),
      durationSeconds: seconds(6 * 60),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: AIR },
    }, {
      id: "bottom",
      kind: "bottom",
      startDepthM: meters(30),
      endDepthM: meters(30),
      durationSeconds: seconds(24 * 60),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: AIR },
    }], { ascentGases: [AIR, EAN50] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.runtimeSeconds / 60).toBeGreaterThanOrEqual(48);
    expect(result.value.summary.runtimeSeconds / 60).toBeLessThanOrEqual(50);
    expect(result.value.summary.decompressionSeconds / 60).toBeGreaterThanOrEqual(12);
    expect(result.value.summary.decompressionSeconds / 60).toBeLessThanOrEqual(14);
    expect(result.value.stops.at(-1)).toMatchObject({ depthM: 6, durationSeconds: 11 * 60 });
    // Barefoot schedules an additional 12 m minute; this known distribution
    // difference is recorded in documentation/reference-validation.md.
    expect(result.value.stops.map((stop) => [stop.depthM, stop.durationSeconds / 60]))
      .toEqual([[12, 1], [9, 1], [6, 11]]);
  });

  it("matches the published CCR runtime envelope with the source low/high setpoints", () => {
    // Reference plan 6: 30 m / 30 min including descent, 0.7 descent and
    // 1.2 bottom/ascent setpoints. Abysner and Subsurface report 39 min;
    // DIVESOFT.APP reports 40 min and a different stop distribution.
    const result = calculateEventDivePlan(ccrInput(), ccrBottomEvents());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.runtimeSeconds / 60).toBeGreaterThanOrEqual(39);
    expect(result.value.summary.runtimeSeconds / 60).toBeLessThanOrEqual(40);
    expect(result.value.summary.decompressionSeconds / 60).toBeGreaterThanOrEqual(2);
    expect(result.value.summary.decompressionSeconds / 60).toBeLessThanOrEqual(4);
    expect(result.value.stops.map((stop) => [stop.depthM, stop.durationSeconds / 60]))
      .toEqual([[9, 1], [6, 1], [3, 1]]);
  });

  it("matches the Abysner/Subsurface CCR bailout runtime envelope from the committed trigger state", () => {
    // Reference plan 7 adds a one-minute bailout at the 30-minute point.
    // Abysner and Subsurface report 52 and 51 minutes. DIVESOFT.APP's
    // documented 60-minute outlier is intentionally not treated as parity.
    const events: readonly ExposureEvent[] = [...ccrBottomEvents(), {
      id: "bailout",
      kind: "bailout",
      startDepthM: meters(30),
      endDepthM: meters(30),
      durationSeconds: seconds(60),
      gas: bailoutAir,
      strategy: { kind: "open-circuit", gas: bailoutAir },
    }];
    const result = calculateEventDivePlan(ccrInput(), events, {
      ascentGases: [bailoutAir],
      bailout: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary.runtimeSeconds / 60).toBeGreaterThanOrEqual(51);
    expect(result.value.summary.runtimeSeconds / 60).toBeLessThanOrEqual(52);
    expect(result.value.segments.some((segment) => segment.kind === "bailout" && segment.startDepthM === 30)).toBe(true);
    expect(result.value.stops.map((stop) => [stop.depthM, stop.durationSeconds / 60]))
      .toEqual([[12, 1], [9, 1], [6, 2], [3, 10]]);
  });
});
