import { describe, expect, it } from "vitest";
import { calculateSimplifiedBailout, integratedSurfaceGas } from "../calculations";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
} from "../domain/defaults";
import type { Cylinder, OcDiveInput, ProfileSegment, TissueState } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
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
