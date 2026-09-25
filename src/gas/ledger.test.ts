import { describe, expect, it } from "vitest";
import { calculateSimplifiedBailout, integratedSurfaceGas } from "../calculations";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
  EAN50,
  OXYGEN,
} from "../domain/defaults";
import type { CcrDiveInput, Cylinder, DivePlan, Gas, OcDiveInput, ProfileSegment, ReservePolicy, TissueState } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import { calculateDivePlan } from "../engine/planner";
import { calculateGasLedger } from "./ledger";

const tissues: TissueState = {
  modelId: "zhl-16c-ostc",
  modelVersion: "test",
  compartments: Array.from({ length: 16 }, () => ({ nitrogenBar: barAbsolute(0.75), heliumBar: barAbsolute(0) })),
};

function fixture(currentPressure = 200): { input: OcDiveInput; segment: ProfileSegment } {
  const gas = { ...AIR, cylinderId: "backgas" };
  const cylinder: Cylinder = {
    id: "backgas",
    name: "Double 12 L",
    waterVolumeL: liters(12),
    workingPressureBar: barGauge(232),
    currentPressureBar: barGauge(currentPressure),
    gas,
    maximumPPO2: barAbsolute(1.4),
    role: "bottom",
    revision: 1,
  };
  const input: OcDiveInput = {
    mode: "oc",
    environment: "open-water",
    depthM: meters(30),
    bottomTimeSeconds: seconds(600),
    bottomGas: gas,
    decoGases: [],
    cylinders: [cylinder],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
  };
  const segment: ProfileSegment = {
    id: "bottom",
    kind: "bottom",
    startRuntimeSeconds: seconds(0),
    durationSeconds: seconds(600),
    startDepthM: meters(30),
    endDepthM: meters(30),
    gasId: gas.id,
    gasName: gas.name,
    gf: fraction(0.3),
    ceilingDepthM: meters(0),
    tissuesAfter: tissues,
  };
  return { input, segment };
}

describe("exact gas ledger integration", () => {
  it("matches the calculator gas consumption for an exact representative leg", () => {
    const { input, segment } = fixture();
    const leg = {
      startDepthM: segment.startDepthM,
      endDepthM: meters(10),
      durationSeconds: segment.durationSeconds,
      rmvLpm: input.rmv.bottomLpm,
    };
    const ledger = calculateGasLedger([{ ...segment, endDepthM: leg.endDepthM }], input, {
      bottomEndRuntimeSeconds: seconds(601),
    });
    const calculator = calculateSimplifiedBailout({
      legs: [leg],
      surfacePressureBar: input.environmentSettings.surfacePressureBar,
      metersPerBar: input.environmentSettings.metersPerBar,
    });

    expect(calculator.ok).toBe(true);
    expect(ledger.entries[0].totalUsedL).toBe(calculator.ok ? calculator.value.requiredGasL : NaN);
  });

  it("uses the same pressure integration primitive as the tools calculator", () => {
    const { input, segment } = fixture();
    const result = calculateGasLedger([segment], input, {
      bottomEndRuntimeSeconds: seconds(601),
    });
    const expected = integratedSurfaceGas({
      startDepthM: meters(30),
      endDepthM: meters(30),
      durationSeconds: seconds(600),
      rmvLpm: DEFAULT_RMV.bottomLpm,
    }, DEFAULT_ENVIRONMENT.surfacePressureBar, DEFAULT_ENVIRONMENT.metersPerBar);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].totalUsedL).toBeCloseTo(expected, 10);
    expect(result.entries[0].totalUsedL).toBe(800);
    expect(result.entries[0].remainingVolumeL).toBe(1600);
    expect(result.entries[0].remainingPressureBar).toBeCloseTo(133.333333, 6);
    expect(result.entries[0].cylinderWaterVolumeL).toBe(12);
    expect(result.entries[0].startingPressureBar).toBe(200);
  });

  it("reports the first reserve crossing with runtime, depth, and pressure context", () => {
    const { input, segment } = fixture(100);
    const result = calculateGasLedger([segment], {
      ...input,
      reservePolicy: { kind: "custom", reserveVolumeL: liters(500) },
    }, { bottomEndRuntimeSeconds: seconds(601) });
    expect(result.entries[0].sufficient).toBe(false);
    expect(result.entries[0].reserveCrossing).toEqual({
      runtimeSeconds: 525,
      depthM: 30,
      expectedPressureBar: barGauge(500 / 12),
      requiredPressureBar: barGauge(500 / 12),
    });
    expect(result.diagnostics.some((item) => item.code === "RESERVE_CROSSED")).toBe(true);
  });

  it("does not invent a pressure when cylinder volume is missing", () => {
    const { input, segment } = fixture();
    const result = calculateGasLedger([segment], { ...input, cylinders: [] }, {
      bottomEndRuntimeSeconds: seconds(601),
    });
    expect(result.entries[0].remainingPressureBar).toBeUndefined();
    expect(result.entries[0].cylinderWaterVolumeL).toBeUndefined();
    expect(result.diagnostics.some((item) => item.code === "CYLINDER_UNASSIGNED")).toBe(true);
  });

  it("allocates every cave reserve policy directly, including emergency exit rock bottom", () => {
    const { input, segment } = fixture();
    const exit: ProfileSegment = {
      ...segment,
      id: "cave-exit",
      kind: "exit",
      startRuntimeSeconds: seconds(600),
      durationSeconds: seconds(180),
      startDepthM: meters(30),
      endDepthM: meters(0),
    };
    const cases: readonly [OcDiveInput["reservePolicy"], number][] = [
      [{ kind: "fixed", minimumPressureBar: barGauge(35) }, 420],
      [{ kind: "custom", reserveVolumeL: liters(500) }, 500],
      [{ kind: "thirds" }, 800],
      [{ kind: "sixths" }, 1600],
      [{ kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(40) }, 600],
    ];
    for (const [reservePolicy, expectedReserveL] of cases) {
      const result = calculateGasLedger([exit], {
        ...input,
        environment: "cave",
        reservePolicy,
      }, { bottomEndRuntimeSeconds: seconds(1_000) });
      expect(result.entries[0].reserveL).toBeCloseTo(expectedReserveL, 8);
    }
  });
});

const leg = (
  id: string,
  kind: ProfileSegment["kind"],
  startRuntime: number,
  duration: number,
  startDepth: number,
  endDepth: number,
  gas: Gas,
): ProfileSegment => ({
  id,
  kind,
  startRuntimeSeconds: seconds(startRuntime),
  durationSeconds: seconds(duration),
  startDepthM: meters(startDepth),
  endDepthM: meters(endDepth),
  gasId: gas.id,
  gasName: gas.name,
  gf: fraction(0.3),
  ceilingDepthM: meters(0),
  tissuesAfter: tissues,
});
const surfaceUse = (segment: ProfileSegment, rmvLpm: number): number => integratedSurfaceGas({
  startDepthM: segment.startDepthM,
  endDepthM: segment.endDepthM,
  durationSeconds: segment.durationSeconds,
  rmvLpm: litersPerMinute(rmvLpm),
}, DEFAULT_ENVIRONMENT.surfacePressureBar, DEFAULT_ENVIRONMENT.metersPerBar);

/**
 * Characterization of the RMV phase boundary used since engine 0.1.0. These tests pin
 * behavior and do not assert that it is the right convention. Open circuit charges every
 * segment that starts at or after the end of bottom time at the deco RMV, including the
 * ascent to the first stop and a no-stop ascent. The CCR bailout ledger charges only stop
 * segments at the bailout deco RMV; every travel leg uses the bailout RMV.
 */
describe("RMV phase boundary (engine 0.1.0 rule)", () => {
  it("charges the OC ascent from the bottom to the first stop at the deco RMV", () => {
    const { input } = fixture();
    const gas = input.bottomGas;
    const descent = leg("descent", "descent", 0, 100, 0, 30, gas);
    const bottom = leg("bottom", "bottom", 100, 600, 30, 30, gas);
    // 30 m to a 12 m first stop at 9 m/min, averaging 3.1 bar absolute.
    const toFirstStop = leg("ascent-1", "ascent", 700, 120, 30, 12, gas);
    const firstStop = leg("stop-12", "stop", 820, 60, 12, 12, gas);
    const betweenStops = leg("ascent-2", "ascent", 880, 60, 12, 9, gas);
    const [entry] = calculateGasLedger(
      [descent, bottom, toFirstStop, firstStop, betweenStops],
      input,
      { bottomEndRuntimeSeconds: seconds(700) },
    ).entries;

    // 2 min x 15 L/min x 3.1 bar = 93 L; the bottom RMV would charge 124 L.
    expect(surfaceUse(toFirstStop, DEFAULT_RMV.decoLpm)).toBeCloseTo(93, 10);
    expect(surfaceUse(toFirstStop, DEFAULT_RMV.bottomLpm)).toBeCloseTo(124, 10);
    expect(entry.bottomUsedL).toBeCloseTo(
      surfaceUse(descent, DEFAULT_RMV.bottomLpm) + surfaceUse(bottom, DEFAULT_RMV.bottomLpm),
      10,
    );
    expect(entry.decoUsedL).toBeCloseTo(
      surfaceUse(toFirstStop, DEFAULT_RMV.decoLpm) +
        surfaceUse(firstStop, DEFAULT_RMV.decoLpm) +
        surfaceUse(betweenStops, DEFAULT_RMV.decoLpm),
      10,
    );
    expect(entry.bottomUsedL).toBeCloseTo(883.333333, 6);
    expect(entry.decoUsedL).toBeCloseTo(156.75, 10);
  });

  it("charges a no-stop OC ascent entirely at the deco RMV", () => {
    const { input, segment: bottom } = fixture();
    const ascent = leg("ascent", "ascent", 600, 200, 30, 0, input.bottomGas);
    const [entry] = calculateGasLedger([bottom, ascent], input, {
      bottomEndRuntimeSeconds: seconds(600),
    }).entries;
    // 200 s x 15 L/min x 2.5 bar = 125 L; the bottom RMV would charge 166.7 L.
    expect(entry.bottomUsedL).toBeCloseTo(800, 10);
    expect(entry.decoUsedL).toBeCloseTo(125, 10);
  });

  it("charges CCR bailout travel legs at the bailout RMV and only stops at the bailout deco RMV", () => {
    const diluent: Gas = { ...AIR, id: "dil", role: "diluent" };
    const bailoutGas: Gas = { ...AIR, id: "bo", role: "bailout", cylinderId: "bo-cylinder" };
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(30),
      bottomTimeSeconds: seconds(600),
      diluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [bailoutGas],
      cylinders: [{
        id: "bo-cylinder",
        name: "Bailout 11 L",
        waterVolumeL: liters(11.1),
        workingPressureBar: barGauge(207),
        currentPressureBar: barGauge(200),
        gas: bailoutGas,
        maximumPPO2: barAbsolute(1.6),
        role: "bailout",
        revision: 1,
      }],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const toFirstStop = leg("bailout-1", "bailout", 700, 120, 30, 12, bailoutGas);
    const firstStop = leg("stop-12", "stop", 820, 60, 12, 12, bailoutGas);
    const betweenStops = leg("bailout-2", "bailout", 880, 60, 12, 9, bailoutGas);
    const [entry] = calculateGasLedger([toFirstStop, firstStop, betweenStops], input, {
      bailout: true,
      startRuntimeSeconds: seconds(700),
      bottomEndRuntimeSeconds: seconds(700),
    }).entries;
    // Travel: 2 min x 30 L/min x 3.1 bar + 1 min x 30 L/min x 2.05 bar. Stop: 1 min x 20 L/min x 2.2 bar.
    expect(entry.bottomUsedL).toBeCloseTo(
      surfaceUse(toFirstStop, DEFAULT_RMV.bailoutLpm) + surfaceUse(betweenStops, DEFAULT_RMV.bailoutLpm),
      10,
    );
    expect(entry.bottomUsedL).toBeCloseTo(247.5, 10);
    expect(entry.decoUsedL).toBeCloseTo(surfaceUse(firstStop, DEFAULT_RMV.bailoutDecoLpm), 10);
    expect(entry.decoUsedL).toBeCloseTo(44, 10);
  });

  it("receives the end of bottom time, not first-stop arrival, from the OC planner", () => {
    const bottomGas: Gas = { id: "tx18-45", name: "Tx18/45", oxygen: fraction(0.18), helium: fraction(0.45), role: "bottom" };
    const input: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(45),
      bottomTimeSeconds: seconds(25 * 60),
      bottomGas,
      decoGases: [EAN50, OXYGEN],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = calculateDivePlan(input);
    if (!result.ok) throw new Error(result.errors.map((item) => item.code).join(", "));
    const { segments, gasLedger } = result.value;
    const bottom = segments.find((segment) => segment.kind === "bottom")!;
    const bottomEnd = bottom.startRuntimeSeconds + bottom.durationSeconds;
    const firstStopArrival = segments.find((segment) => segment.kind === "stop")!.startRuntimeSeconds;
    const toFirstStop = segments.filter((segment) =>
      segment.durationSeconds > 0 &&
      segment.startRuntimeSeconds >= bottomEnd &&
      segment.startRuntimeSeconds < firstStopArrival);
    expect(firstStopArrival).toBeGreaterThan(bottomEnd);
    expect(toFirstStop.length).toBeGreaterThan(0);
    expect(toFirstStop.every((segment) => segment.kind === "ascent")).toBe(true);

    const chargedByBottomEnd = (segment: ProfileSegment): number => surfaceUse(
      segment,
      segment.kind === "stop" || segment.startRuntimeSeconds >= bottomEnd
        ? DEFAULT_RMV.decoLpm
        : DEFAULT_RMV.bottomLpm,
    );
    for (const gas of [bottomGas, EAN50, OXYGEN]) {
      const expected = segments
        .filter((segment) => segment.gasId === gas.id && segment.durationSeconds > 0)
        .reduce((sum, segment) => sum + chargedByBottomEnd(segment), 0);
      expect(gasLedger.find((entry) => entry.gasId === gas.id)!.totalUsedL).toBeCloseTo(expected, 8);
    }
  });
});

/**
 * Opt-in first-stop deco RMV boundary. Only the charged rate and the bottom/deco split move;
 * decompression, reserves, and every ledger without the field keep the engine 0.1.0 rule.
 */
describe("first-stop deco RMV boundary (opt-in)", () => {
  const firstStop = (input: OcDiveInput): OcDiveInput => ({ ...input, decoRmvFrom: "first-stop" });
  const used = (plan: DivePlan, gasId: string): number =>
    plan.gasLedger.find((entry) => entry.gasId === gasId)!.totalUsedL;

  it("keeps the bottom RMV through the ascent to the first stop", () => {
    const { input } = fixture();
    const gas = input.bottomGas;
    const segments = [
      leg("descent", "descent", 0, 100, 0, 30, gas),
      leg("bottom", "bottom", 100, 600, 30, 30, gas),
      leg("ascent-1", "ascent", 700, 120, 30, 12, gas),
      leg("stop-12", "stop", 820, 60, 12, 12, gas),
      leg("ascent-2", "ascent", 880, 60, 12, 9, gas),
    ];
    const options = { bottomEndRuntimeSeconds: seconds(700) };
    const legacyResult = calculateGasLedger(segments, input, options);
    const result = calculateGasLedger(segments, firstStop(input), options);
    const [legacy] = legacyResult.entries;
    const [entry] = result.entries;
    // The 30 m to 12 m climb moves from 93 L at the deco RMV to 124 L at the bottom RMV.
    expect(entry.bottomUsedL).toBeCloseTo(883.333333 + 124, 6);
    expect(entry.decoUsedL).toBeCloseTo(33 + 30.75, 10);
    expect(entry.totalUsedL - legacy.totalUsedL).toBeCloseTo(31, 10);
    expect(entry.reserveL).toBe(legacy.reserveL);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: "DECO_RMV_FROM_FIRST_STOP", severity: "info" }));
    expect(legacyResult.diagnostics.some((item) => item.code === "DECO_RMV_FROM_FIRST_STOP")).toBe(false);
  });

  it("charges a no-stop ascent entirely at the bottom RMV", () => {
    const { input, segment: bottom } = fixture();
    const ascent = leg("ascent", "ascent", 600, 200, 30, 0, input.bottomGas);
    const [entry] = calculateGasLedger([bottom, ascent], firstStop(input), {
      bottomEndRuntimeSeconds: seconds(600),
    }).entries;
    // 200 s x 20 L/min x 2.5 bar.
    expect(entry.bottomUsedL).toBeCloseTo(800 + 500 / 3, 10);
    expect(entry.decoUsedL).toBe(0);
  });

  it("moves only the climb volume in the golden 45 m trimix plan", () => {
    const bottomGas: Gas = { id: "tx18-45", name: "Tx18/45", oxygen: fraction(0.18), helium: fraction(0.45), role: "bottom" };
    const input: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(45),
      bottomTimeSeconds: seconds(25 * 60),
      bottomGas,
      decoGases: [EAN50, OXYGEN],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const legacy = calculateDivePlan(input);
    const opted = calculateDivePlan(firstStop(input));
    if (!legacy.ok || !opted.ok) throw new Error("plan failed");
    expect(opted.value.segments).toEqual(legacy.value.segments);
    expect(opted.value.stops).toEqual(legacy.value.stops);
    expect(opted.value.summary).toEqual(legacy.value.summary);
    // 5 L/min x (21 m / 9 m/min) x 4.45 bar for the 45 m to 24 m climb.
    expect(used(opted.value, bottomGas.id) - used(legacy.value, bottomGas.id)).toBeCloseTo(51.916667, 6);
    expect(used(opted.value, EAN50.id)).toBe(used(legacy.value, EAN50.id));
    expect(used(opted.value, OXYGEN.id)).toBe(used(legacy.value, OXYGEN.id));
    expect(opted.value.id).not.toBe(legacy.value.id);
    expect(opted.value.diagnostics.filter((item) => item.code === "DECO_RMV_FROM_FIRST_STOP")).toHaveLength(1);
    expect(legacy.value.diagnostics.some((item) => item.code === "DECO_RMV_FROM_FIRST_STOP")).toBe(false);
  });

  it("charges a gas switched to before the first stop at the bottom RMV and never moves a reserve", () => {
    // 30 m / 25 min under the Shearwater preset: the climb crosses the 21 m EAN50 switch
    // (a 5 s switch segment), so EAN50 is breathed before the 12 m first stop.
    const air: Gas = { ...AIR, cylinderId: "air-cylinder" };
    const ean50: Gas = { ...EAN50, cylinderId: "ean50-cylinder" };
    const cylinder = (id: string, gas: Gas, waterVolumeL: number, maximumPPO2: number): Cylinder => ({
      id,
      name: id,
      waterVolumeL: liters(waterVolumeL),
      workingPressureBar: barGauge(232),
      currentPressureBar: barGauge(210),
      gas,
      maximumPPO2: barAbsolute(maximumPPO2),
      revision: 1,
    });
    const base: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(30),
      bottomTimeSeconds: seconds(25 * 60),
      bottomGas: air,
      decoGases: [ean50],
      cylinders: [cylinder("air-cylinder", air, 24, 1.4), cylinder("ean50-cylinder", ean50, 11, 1.6)],
      settings: { ...DEFAULT_PLANNER_SETTINGS, conventionId: "shearwater-petrel3-v103-compatible-v1" },
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const policies: readonly ReservePolicy[] = [
      { kind: "fixed", minimumPressureBar: barGauge(35) },
      { kind: "custom", reserveVolumeL: liters(500) },
      { kind: "thirds" },
      { kind: "sixths" },
      { kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(30) },
    ];
    for (const reservePolicy of policies) {
      const legacy = calculateDivePlan({ ...base, reservePolicy });
      const opted = calculateDivePlan(firstStop({ ...base, reservePolicy }));
      if (!legacy.ok || !opted.ok) throw new Error("plan failed");
      const { segments } = legacy.value;
      const bottom = segments.find((segment) => segment.kind === "bottom")!;
      const bottomEnd = bottom.startRuntimeSeconds + bottom.durationSeconds;
      const arrival = segments.find((segment) => segment.kind === "stop")!.startRuntimeSeconds;
      const climb = segments.filter((segment) =>
        segment.durationSeconds > 0 &&
        segment.startRuntimeSeconds >= bottomEnd &&
        segment.startRuntimeSeconds < arrival);
      expect(climb.map((segment) => `${segment.kind}:${segment.gasId}`))
        .toEqual([`ascent:${air.id}`, `gas-switch:${ean50.id}`, `ascent:${ean50.id}`]);
      const moved = (gas: Gas): number => climb
        .filter((segment) => segment.gasId === gas.id)
        .reduce((sum, segment) =>
          sum + surfaceUse(segment, DEFAULT_RMV.bottomLpm) - surfaceUse(segment, DEFAULT_RMV.decoLpm), 0);
      // Air 30 m to 21 m in 0.9 min; EAN50 5 s at 21 m plus 21 m to 12 m in 0.9 min.
      expect(moved(air)).toBeCloseTo(15.975, 6);
      expect(moved(ean50)).toBeCloseTo(13.216667, 6);
      for (const gas of [air, ean50]) {
        const before = legacy.value.gasLedger.find((entry) => entry.gasId === gas.id)!;
        const after = opted.value.gasLedger.find((entry) => entry.gasId === gas.id)!;
        expect(after.totalUsedL - before.totalUsedL).toBeCloseTo(moved(gas), 8);
        expect(after.reserveL).toBe(before.reserveL);
      }
    }
  });

  it("does not change CCR bailout ledgers even when the field is present", () => {
    const bailoutGas: Gas = { ...AIR, id: "bo", role: "bailout", cylinderId: "bo-cylinder" };
    const input: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(30),
      bottomTimeSeconds: seconds(600),
      diluent: { ...AIR, id: "dil", role: "diluent" },
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [bailoutGas],
      cylinders: [{
        id: "bo-cylinder",
        name: "Bailout 11 L",
        waterVolumeL: liters(11.1),
        workingPressureBar: barGauge(207),
        currentPressureBar: barGauge(200),
        gas: bailoutGas,
        maximumPPO2: barAbsolute(1.6),
        revision: 1,
      }],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: { kind: "rock-bottom", teamSize: 1, stressedRmvLpm: litersPerMinute(30) },
    };
    const segments = [
      leg("bailout-1", "bailout", 700, 120, 30, 12, bailoutGas),
      leg("stop-12", "stop", 820, 60, 12, 12, bailoutGas),
      leg("bailout-2", "bailout", 880, 60, 12, 9, bailoutGas),
    ];
    const options = { bailout: true, startRuntimeSeconds: seconds(700), bottomEndRuntimeSeconds: seconds(700) };
    const withField = { ...input, decoRmvFrom: "first-stop" } as unknown as CcrDiveInput;
    expect(calculateGasLedger(segments, withField, options)).toEqual(calculateGasLedger(segments, input, options));
  });
});
