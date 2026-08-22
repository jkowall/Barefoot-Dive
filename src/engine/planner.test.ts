import { describe, expect, it } from "vitest";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
  EAN50,
  OXYGEN,
} from "../domain/defaults";
import type { CcrDiveInput, Gas, OcDiveInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { calculateDivePlan, calculateEventDivePlan } from "./planner";

const trimix1845: Gas = {
  id: "tx18-45",
  name: "Tx18/45",
  oxygen: fraction(0.18),
  helium: fraction(0.45),
  role: "bottom",
};

function ocInput(overrides: Partial<OcDiveInput> = {}): OcDiveInput {
  return {
    mode: "oc",
    environment: "open-water",
    depthM: meters(30),
    bottomTimeSeconds: seconds(20 * 60),
    bottomGas: AIR,
    decoGases: [],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
    ...overrides,
  };
}

describe("deterministic decompression scheduling", () => {
  it("matches published DecoTengu ZH-L16C endpoints and the locally reproduced 0.14.1 schedule", () => {
    const result = calculateDivePlan(ocInput({
      depthM: meters(35),
      // DecoTengu's 40 minute runtime-to-ascent includes the 1.75 minute descent.
      bottomTimeSeconds: seconds((40 - 1.75) * 60),
      settings: {
        ...DEFAULT_PLANNER_SETTINGS,
        gfHigh: fraction(0.85),
        descentRateMPerMinute: 20,
        ascentRateMPerMinute: 10,
        decoAscentRateMPerMinute: 10,
        lastStopDepthM: meters(3),
      },
      environmentSettings: {
        ...DEFAULT_ENVIRONMENT,
        surfacePressureBar: barAbsolute(1.01325),
        metersPerBar: meters(1 / 0.09985),
      },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bottom = result.value.segments.find((segment) => segment.kind === "bottom");
    expect(bottom?.tissuesAfter.compartments[0].nitrogenBar).toBeCloseTo(3.508637578495, 9);
    const firstAscent = result.value.segments.find(
      (segment) => segment.kind === "ascent" && segment.endDepthM === 18,
    );
    expect(firstAscent?.tissuesAfter.compartments[0].nitrogenBar)
      .toBeCloseTo(3.329969673838, 9);
    expect(firstAscent?.ceilingDepthM).toBeCloseTo(16.0629404139, 9);
    expect(result.value.stops.map((stop) => [stop.depthM, stop.durationSeconds / 60]))
      .toEqual([[18, 1], [15, 1], [12, 4], [9, 6], [6, 14], [3, 26]]);
    expect(result.value.summary.decompressionSeconds).toBe(52 * 60);
  });

  it("produces an immutable, monotonic schedule ending at the surface", () => {
    const result = calculateDivePlan(ocInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments.length).toBeGreaterThan(2);
    expect(result.value.segments.at(-1)?.endDepthM).toBe(0);
    for (let index = 1; index < result.value.segments.length; index += 1) {
      const previous = result.value.segments[index - 1];
      const current = result.value.segments[index];
      expect(current.startRuntimeSeconds).toBe(
        previous.startRuntimeSeconds + previous.durationSeconds,
      );
    }
    for (const compartment of result.value.finalTissues.compartments) {
      expect(Number.isFinite(compartment.nitrogenBar)).toBe(true);
      expect(Number.isFinite(compartment.heliumBar)).toBe(true);
      expect(compartment.nitrogenBar).toBeGreaterThanOrEqual(0);
      expect(compartment.heliumBar).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns byte-stable planning output for identical normalized inputs", () => {
    const first = calculateDivePlan(ocInput());
    const second = calculateDivePlan(ocInput());
    expect(second).toEqual(first);
  });

  it("uses richer decompression gases only at or shallower than their switch depth", () => {
    const result = calculateDivePlan(ocInput({
      depthM: meters(45),
      bottomTimeSeconds: seconds(25 * 60),
      bottomGas: trimix1845,
      decoGases: [EAN50, OXYGEN],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const eanSegments = result.value.segments.filter((segment) => segment.gasId === EAN50.id);
    const oxygenSegments = result.value.segments.filter((segment) => segment.gasId === OXYGEN.id);
    expect(eanSegments.length).toBeGreaterThan(0);
    expect(oxygenSegments.length).toBeGreaterThan(0);
    expect(eanSegments.every((segment) => segment.startDepthM <= 21 && segment.endDepthM <= 21)).toBe(true);
    expect(oxygenSegments.every((segment) => segment.startDepthM <= 6 && segment.endDepthM <= 6)).toBe(true);
  });

  it("blocks a hypoxic OC bottom gas without a breathable travel gas", () => {
    const hypoxic: Gas = {
      ...trimix1845,
      id: "tx10-70",
      name: "Tx10/70",
      oxygen: fraction(0.1),
      helium: fraction(0.7),
    };
    const result = calculateDivePlan(ocInput({ depthM: meters(60), bottomGas: hypoxic }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "TRAVEL_GAS_REQUIRED")).toBe(true);
  });

  it("fails planning when the OC bottom PPO2 exceeds both configured limits", () => {
    const hotBottom: Gas = { ...AIR, id: "hot-bottom", name: "Hot bottom", oxygen: fraction(0.5), cylinderId: "hot-cylinder" };
    const result = calculateDivePlan(ocInput({
      depthM: meters(30), bottomGas: hotBottom,
      cylinders: [{ id: "hot-cylinder", name: "Hot cylinder", waterVolumeL: liters(12), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: hotBottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "BOTTOM_PPO2_LIMIT_EXCEEDED")).toBe(true);
  });

  it("breathes an explicitly selected travel gas and charges its cylinder", () => {
    const bottom: Gas = { ...AIR, id: "bottom", name: "Bottom", switchDepthM: meters(21), cylinderId: "bottom-cylinder" };
    const travel: Gas = { ...AIR, id: "travel", name: "Travel", role: "travel", cylinderId: "travel-cylinder" };
    const result = calculateDivePlan(ocInput({
      depthM: meters(30), bottomGas: bottom, travelGas: travel,
      cylinders: [
        { id: "bottom-cylinder", name: "Bottom", waterVolumeL: liters(12), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bottom, maximumPPO2: barAbsolute(1.4), revision: 1 },
        { id: "travel-cylinder", name: "Travel", waterVolumeL: liters(11), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: travel, maximumPPO2: barAbsolute(1.4), revision: 1 },
      ],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.segments.some((segment) => segment.gasId === travel.id)).toBe(true);
    expect(result.value.gasLedger.find((entry) => entry.cylinderId === "travel-cylinder")?.totalUsedL).toBeGreaterThan(0);
  });

  it("keeps a required travel gas inside its validated operating interval", () => {
    const hypoxic: Gas = {
      ...trimix1845,
      id: "tx10-70",
      name: "Tx10/70",
      oxygen: fraction(0.1),
      helium: fraction(0.7),
      switchDepthM: meters(6),
    };
    const travel: Gas = { ...AIR, id: "travel-air", name: "Travel Air", role: "travel" };
    const result = calculateDivePlan(ocInput({
      depthM: meters(60),
      bottomGas: hypoxic,
      travelGas: travel,
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const travelSegments = result.value.segments.filter((segment) => segment.gasId === travel.id);
    expect(travelSegments.length).toBeGreaterThan(0);
    expect(travelSegments.every((segment) =>
      segment.startDepthM <= 6 && segment.endDepthM <= 6
    )).toBe(true);
  });

  it("rejects an unsafe explicit travel switch", () => {
    const hypoxic: Gas = {
      ...trimix1845,
      id: "tx10-70",
      name: "Tx10/70",
      oxygen: fraction(0.1),
      helium: fraction(0.7),
      switchDepthM: meters(60),
    };
    const result = calculateDivePlan(ocInput({
      depthM: meters(60),
      bottomGas: hypoxic,
      travelGas: { ...AIR, id: "travel-air", role: "travel" },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "TRAVEL_GAS_OPERATING_RANGE")).toBe(true);
  });

  it("rejects event gas/strategy mismatches and negative depths", () => {
    const oxygen: Gas = { ...OXYGEN, id: "event-o2", role: "bottom" };
    const result = calculateEventDivePlan(ocInput({ decoGases: [oxygen] }), [{
      id: "bad-event",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(-3),
      durationSeconds: seconds(60),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: oxygen },
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "EXPOSURE_STRATEGY_GAS_MISMATCH")).toBe(true);
    expect(result.errors.some((item) => item.code === "EXPOSURE_DEPTH_INVALID")).toBe(true);
  });

  it("rejects event ascent gases absent from the normalized input", () => {
    const undeclared = { ...EAN50, id: "undeclared-50" };
    const result = calculateEventDivePlan(ocInput(), [{
      id: "descent",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(30),
      durationSeconds: seconds(100),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: AIR },
    }, {
      id: "bottom",
      kind: "bottom",
      startDepthM: meters(30),
      endDepthM: meters(30),
      durationSeconds: seconds(20 * 60),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: AIR },
    }], { ascentGases: [undeclared] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "ASCENT_GAS_NOT_REGISTERED")).toBe(true);
  });

  it("rejects an explicit exit leg that crosses above its calculated ceiling", () => {
    const input = ocInput({
      depthM: meters(40),
      bottomTimeSeconds: seconds(40 * 60),
    });
    const strategy = { kind: "open-circuit" as const, gas: AIR };
    const result = calculateEventDivePlan(input, [{
      id: "descent",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(40),
      durationSeconds: seconds(120),
      gas: AIR,
      strategy,
    }, {
      id: "bottom",
      kind: "bottom",
      startDepthM: meters(40),
      endDepthM: meters(40),
      durationSeconds: seconds(40 * 60),
      gas: AIR,
      strategy,
    }, {
      id: "unsafe-exit",
      kind: "exit",
      startDepthM: meters(40),
      endDepthM: meters(0),
      durationSeconds: seconds(4 * 60),
      gas: AIR,
      strategy,
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "EXPOSURE_CEILING_VIOLATION")).toBe(true);
  });

  it("rejects a CCR event setpoint above the configured bottom PPO2 limit", () => {
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(30),
      bottomTimeSeconds: seconds(60),
      diluent: AIR,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [],
      cylinders: [],
      settings: { ...DEFAULT_PLANNER_SETTINGS, maximumBottomPPO2: barAbsolute(1.4) },
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = calculateEventDivePlan(input, [{
      id: "descent",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(30),
      durationSeconds: seconds(100),
      gas: AIR,
      strategy: { kind: "open-circuit", gas: AIR },
    }, {
      id: "high-setpoint",
      kind: "bottom",
      startDepthM: meters(30),
      endDepthM: meters(30),
      durationSeconds: seconds(60),
      gas: AIR,
      strategy: { kind: "ccr", diluent: AIR, setpointBar: barAbsolute(1.5) },
    }]);
    expect(result.ok).toBe(false);
  });

  it("enforces a cylinder PPO2 limit on explicit event legs", () => {
    const ean50: Gas = {
      id: "event-ean50",
      name: "Event EAN50",
      oxygen: fraction(0.5),
      helium: fraction(0),
      role: "deco",
    };
    const result = calculateEventDivePlan(ocInput({
      decoGases: [ean50],
      cylinders: [{
        id: "event-ean50-cylinder",
        name: "EAN50 stage",
        waterVolumeL: liters(11),
        workingPressureBar: barGauge(200),
        currentPressureBar: barGauge(200),
        gas: ean50,
        maximumPPO2: barAbsolute(1.4),
        revision: 1,
      }],
    }), [{
      id: "unsafe-event",
      kind: "descent",
      startDepthM: meters(0),
      endDepthM: meters(21),
      durationSeconds: seconds(70),
      gas: ean50,
      strategy: { kind: "open-circuit", gas: ean50 },
    }]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "EXPOSURE_GAS_UNBREATHABLE")).toBe(true);
  });

  it("honors the assigned cylinder's lower PPO2 limit for automatic switches", () => {
    const decoGas: Gas = {
      id: "auto-50",
      name: "Auto EAN50",
      oxygen: fraction(0.5),
      helium: fraction(0),
      role: "deco",
      cylinderId: "deco-cylinder",
    };
    const result = calculateDivePlan(ocInput({
      depthM: meters(45),
      bottomTimeSeconds: seconds(25 * 60),
      bottomGas: trimix1845,
      decoGases: [decoGas],
      cylinders: [{
        id: "deco-cylinder",
        name: "EAN50 stage",
        waterVolumeL: liters(11),
        workingPressureBar: barGauge(200),
        currentPressureBar: barGauge(200),
        gas: decoGas,
        maximumPPO2: barAbsolute(1.4),
        role: "deco",
        revision: 1,
      }],
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const switched = result.value.segments.filter((segment) => segment.gasId === decoGas.id);
    expect(switched.length).toBeGreaterThan(0);
    expect(switched.every((segment) =>
      decoGas.oxygen * (1 + Math.max(segment.startDepthM, segment.endDepthM) / 10) <= 1.4 + 1e-9
    )).toBe(true);
  });

  it("transfers CCR bailout from the selected at-depth tissue state", () => {
    const diluent: Gas = { ...trimix1845, id: "diluent", role: "diluent" };
    const bailout: Gas = { ...trimix1845, id: "bailout", role: "bailout" };
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(45),
      bottomTimeSeconds: seconds(20 * 60),
      diluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [bailout, { ...EAN50, id: "bo50", role: "bailout" }, { ...OXYGEN, id: "bo2", role: "bailout" }],
      bailoutTriggerSecondsAtDepth: seconds(10 * 60),
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = calculateDivePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const bailoutPlan = result.value.bailoutPlan;
    expect(bailoutPlan).toBeDefined();
    const triggerBottom = bailoutPlan?.segments.find(
      (segment) => segment.kind === "bottom" && segment.durationSeconds === 10 * 60,
    );
    expect(triggerBottom).toBeDefined();
    expect(bailoutPlan?.segments.at(-1)?.endDepthM).toBe(0);
    expect(bailoutPlan?.summary.ttsSeconds).toBeGreaterThan(0);

    const tenMinuteResult = calculateDivePlan({
      ...input,
      bottomTimeSeconds: seconds(10 * 60),
      bailoutTriggerSecondsAtDepth: seconds(10 * 60),
    });
    expect(tenMinuteResult.ok).toBe(true);
    if (!tenMinuteResult.ok) return;
    const normalTenMinuteBottom = tenMinuteResult.value.segments.find(
      (segment) => segment.kind === "bottom" && segment.durationSeconds === 10 * 60,
    );
    expect(triggerBottom?.tissuesAfter).toEqual(normalTenMinuteBottom?.tissuesAfter);
  });

  it("rejects CCR diluent that is hypoxic during open-circuit activation legs", () => {
    const hypoxicDiluent: Gas = {
      ...trimix1845,
      id: "hypoxic-diluent",
      name: "Tx15/35",
      oxygen: fraction(0.15),
      helium: fraction(0.35),
      role: "diluent",
    };
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(45),
      bottomTimeSeconds: seconds(20 * 60),
      diluent: hypoxicDiluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [{ ...trimix1845, id: "bailout", role: "bailout" }],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = calculateDivePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "CCR_DILUENT_OC_RANGE")).toBe(true);
  });
});
