import { describe, expect, it } from "vitest";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import { calculateBestMix, calculateCNS, calculateCylinderGas, calculateEmergencyGas, calculateEND, calculateGasDensity, calculateGasDuration, calculateMOD, calculatePPO2, calculateRockBottom, calculateSAC, calculateSimplifiedBailout, integratedSurfaceGas } from "./index";
import { TOOLS_REFERENCE_FIXTURES } from "./referenceFixtures";

const surfacePressure = barAbsolute(1), metersPerBar = meters(10);
const valueOf = <T>(result: { ok: boolean; value?: T }): T => { if (!result.ok) throw new Error("expected successful calculation"); return result.value as T; };

describe("pure gas calculators", () => {
  it("calculates MOD and rejects hypoxic/invalid mixes", () => {
    expect(valueOf(calculateMOD({ oxygen: fraction(0.32), maximumPPO2: barAbsolute(1.4), surfacePressureBar: surfacePressure, metersPerBar }))).toMatchObject({ depthM: meters(33.75) });
    expect(calculateMOD({ oxygen: fraction(0), maximumPPO2: barAbsolute(1.4), surfacePressureBar: surfacePressure, metersPerBar }).ok).toBe(false);
    expect(valueOf(calculateBestMix({ depthM: meters(30), maximumPPO2: barAbsolute(1.4), surfacePressureBar: surfacePressure, metersPerBar }))).toMatchObject({ oxygen: fraction(0.35) });
    const capped = calculateBestMix({ depthM: meters(0), maximumPPO2: barAbsolute(1.4), surfacePressureBar: surfacePressure, metersPerBar });
    expect(capped.ok && capped.value.oxygen).toBe(fraction(1));
    expect(capped.warnings.some((item) => item.code === "BEST_MIX_LIMITED_TO_OXYGEN")).toBe(true);
  });

  it("calculates END, PPO2 and ideal-gas density", () => {
    expect(valueOf(calculateEND({ depthM: meters(40), oxygen: fraction(0.21), helium: fraction(0.5), surfacePressureBar: surfacePressure, metersPerBar })).endDepthM).toBe(meters(15));
    expect(valueOf(calculatePPO2({ oxygen: fraction(0.32), ambientPressureBar: barAbsolute(5) })).ppo2Bar).toBe(barAbsolute(1.6));
    expect(valueOf(calculateGasDensity({ oxygen: fraction(0.21), helium: fraction(0), ambientPressureBar: barAbsolute(1), temperatureC: 20 })).densityKgM3).toBeCloseTo(1.184, 2);
  });

  it("builds trimix against PPO₂ and END policies with explicit method metadata", () => {
    const fixture = TOOLS_REFERENCE_FIXTURES.bestMix;
    const environment = { surfacePressureBar: barAbsolute(TOOLS_REFERENCE_FIXTURES.assumptions.surfacePressureBarAbsolute), metersPerBar };
    const oxygenAndNitrogen = valueOf(calculateBestMix({
      depthM: meters(fixture.input.depthM), maximumPPO2: barAbsolute(fixture.input.maximumPPO2BarAbsolute), maximumENDDepthM: meters(fixture.input.maximumENDDepthM), environment,
      narcoticGasPolicy: "oxygen-and-nitrogen",
    }));
    expect(oxygenAndNitrogen.oxygen).toBeCloseTo(fixture.oxygenAndNitrogen.expected.oxygen, 8);
    expect(oxygenAndNitrogen.methodId).toBe("barefoot-best-mix-trimix-v1");
    expect(oxygenAndNitrogen.narcoticGasPolicy).toBe("oxygen-and-nitrogen");
    expect(oxygenAndNitrogen.helium).toBeCloseTo(fixture.oxygenAndNitrogen.expected.helium, 8); // Tx20/43
    expect(oxygenAndNitrogen.nitrogen).toBeCloseTo(fixture.oxygenAndNitrogen.expected.nitrogen, 8);
    expect(oxygenAndNitrogen.actualPPO2Bar).toBeCloseTo(fixture.oxygenAndNitrogen.expected.actualPPO2BarAbsolute, 8);
    expect(oxygenAndNitrogen.achievedENDDepthM).toBeCloseTo(fixture.oxygenAndNitrogen.expected.achievedENDDepthM, 8);
    expect(oxygenAndNitrogen.bindingConstraint).toBe("combined");
    expect(oxygenAndNitrogen.activeConstraints).toEqual(["ppo2", "end"]);

    const nitrogenOnly = valueOf(calculateBestMix({
      depthM: meters(fixture.input.depthM), maximumPPO2: barAbsolute(fixture.input.maximumPPO2BarAbsolute), maximumENDDepthM: meters(fixture.input.maximumENDDepthM), environment,
      narcoticGasPolicy: "nitrogen-only",
    }));
    expect(nitrogenOnly.oxygen).toBeCloseTo(fixture.nitrogenOnly.expected.oxygen, 8);
    expect(nitrogenOnly.nitrogen).toBeCloseTo(fixture.nitrogenOnly.expected.nitrogen, 8);
    expect(nitrogenOnly.helium).toBeCloseTo(fixture.nitrogenOnly.expected.helium, 8); // approximately Tx20/35
    expect(nitrogenOnly.actualPPO2Bar).toBeCloseTo(fixture.nitrogenOnly.expected.actualPPO2BarAbsolute, 8);
    expect(nitrogenOnly.achievedENDDepthM).toBeCloseTo(fixture.nitrogenOnly.expected.achievedENDDepthM, 8);
    expect(nitrogenOnly.bindingConstraint).toBe("combined");
    expect(nitrogenOnly.activeConstraints).toEqual(["ppo2", "end"]);
    for (const [policy, mix] of [["oxygen-and-nitrogen", oxygenAndNitrogen], ["nitrogen-only", nitrogenOnly]] as const) {
      const inverse = valueOf(calculateEND({ depthM: meters(fixture.input.depthM), oxygen: mix.oxygen, helium: mix.helium, environment, narcoticGasPolicy: policy }));
      expect(inverse.endDepthM).toBeCloseTo(fixture.input.maximumENDDepthM, 8);
      expect(inverse.methodId).toBe("barefoot-end-narcotic-gas-policy-v1");
    }
    const tx1845 = fixture.explicitTx1845NitrogenOnlyEND;
    expect(valueOf(calculateEND({ depthM: meters(tx1845.input.depthM), oxygen: fraction(tx1845.input.oxygen), helium: fraction(tx1845.input.helium), environment, narcoticGasPolicy: "nitrogen-only" })).endDepthM).toBeCloseTo(tx1845.expectedENDDepthM, 10);

    const hypoxic = calculateBestMix({ depthM: meters(100), maximumPPO2: barAbsolute(1.4), maximumENDDepthM: meters(30), environment });
    expect(hypoxic.ok && hypoxic.value.surfaceBreathability.breathable).toBe(false);
    expect(hypoxic.warnings.some((diagnostic) => diagnostic.code === "BEST_MIX_HYPOXIC_AT_SURFACE")).toBe(true);
    expect(calculateBestMix({ depthM: meters(-1), maximumPPO2: barAbsolute(1.4), maximumENDDepthM: meters(30), environment }).ok).toBe(false);
    expect(calculateEND({ depthM: meters(60), oxygen: fraction(0.8), helium: fraction(0.3), environment }).ok).toBe(false);
    expect(calculateEND({ depthM: meters(60), oxygen: undefined as never, helium: fraction(0.45), environment, narcoticGasPolicy: "nitrogen-only" }).ok).toBe(false);
    expect(calculateEND({ depthM: meters(Number.NaN), oxygen: fraction(0.18), helium: fraction(0.45), environment }).ok).toBe(false);
    expect(calculateEND({ depthM: meters(60), oxygen: fraction(Number.POSITIVE_INFINITY), helium: fraction(0.45), environment }).ok).toBe(false);
    expect(valueOf(calculateBestMix({ depthM: meters(0), maximumPPO2: barAbsolute(1.4), maximumENDDepthM: meters(0), environment })).bindingConstraint).toBe("oxygen-fraction");
    const boundary = valueOf(calculateBestMix({ depthM: meters(0), maximumPPO2: barAbsolute(1), maximumENDDepthM: meters(0), environment }));
    expect(boundary.activeConstraints).toEqual(["ppo2", "oxygen-fraction"]);
    const endLimited = calculateBestMix({ depthM: meters(10), maximumPPO2: barAbsolute(3), maximumENDDepthM: meters(0), environment });
    expect(endLimited.ok && endLimited.value.oxygen).toBeCloseTo(0.5, 8);
    expect(endLimited.warnings.some((item) => item.code === "BEST_MIX_LIMITED_TO_OXYGEN")).toBe(false);
  });

  it("calculates SAC/RMV and gas duration with explicit reserves", () => {
    expect(valueOf(calculateSAC({ gasUsedL: liters(100), durationSeconds: seconds(600), startDepthM: meters(20), endDepthM: meters(20), surfacePressureBar: surfacePressure, metersPerBar })).sacLpm).toBeCloseTo(100 / 30, 8);
    expect(valueOf(calculateGasDuration({ cylinderWaterVolumeL: liters(12), startingPressureBar: barGauge(200), reservePressureBar: barGauge(50), rmvLpm: litersPerMinute(20), ambientPressureBar: barAbsolute(3) })).durationSeconds).toBe(1800);
    expect(valueOf(calculateCylinderGas({ waterVolumeL: liters(12), pressureBar: barGauge(200), reservePressureBar: barGauge(50) }))).toMatchObject({ totalGasL: liters(2400), usableGasL: liters(1800), reserveGasL: liters(600) });
    expect(calculateGasDuration({ cylinderWaterVolumeL: liters(12), startingPressureBar: barGauge(200), reservePressureBar: barGauge(0), rmvLpm: litersPerMinute(20), ambientPressureBar: barAbsolute(3) }).ok).toBe(true);
    expect(calculateCylinderGas({ waterVolumeL: liters(12), pressureBar: barGauge(200), reservePressureBar: barGauge(0) }).ok).toBe(true);
    expect(calculateSAC({ gasUsedL: liters(100), durationSeconds: seconds(600), startDepthM: meters(-1), endDepthM: meters(0), surfacePressureBar: surfacePressure, metersPerBar }).ok).toBe(false);
  });

  it("converges SAC surface-volume and cylinder pressure-drop inputs", () => {
    const fixture = TOOLS_REFERENCE_FIXTURES.sac;
    const direct = valueOf(calculateSAC({ kind: "surface-volume", gasUsedL: liters(fixture.direct.gasUsedSurfaceL), durationSeconds: seconds(fixture.direct.durationSeconds), startDepthM: meters(fixture.direct.startDepthM), endDepthM: meters(fixture.direct.endDepthM), environment: { surfacePressureBar: barAbsolute(1), metersPerBar } }));
    const cylinder = valueOf(calculateSAC({ kind: "cylinder-pressure-drop", cylinderWaterVolumeL: liters(fixture.cylinderDrop.waterVolumeL), startingPressureBar: barGauge(fixture.cylinderDrop.startingPressureBarGauge), endingPressureBar: barGauge(fixture.cylinderDrop.endingPressureBarGauge), durationSeconds: seconds(fixture.cylinderDrop.durationSeconds), startDepthM: meters(fixture.cylinderDrop.startDepthM), endDepthM: meters(fixture.cylinderDrop.endDepthM), environment: { surfacePressureBar: barAbsolute(1), metersPerBar } }));
    expect(direct.sacLpm).toBeCloseTo(fixture.expected.rmvSurfaceLpm, 8);
    expect(cylinder.sacLpm).toBeCloseTo(fixture.expected.rmvSurfaceLpm, 8);
    expect(cylinder.gasUsedL).toBe(liters(fixture.expected.gasUsedSurfaceL));
    expect(cylinder.averageAmbientPressureBar).toBe(barAbsolute(fixture.expected.averagePressureBarAbsolute));
    expect(cylinder.methodId).toBe("barefoot-sac-average-absolute-pressure-v1");
    expect(calculateSAC({ kind: "cylinder-pressure-drop", cylinderWaterVolumeL: liters(12), startingPressureBar: barGauge(150), endingPressureBar: barGauge(200), durationSeconds: seconds(600), startDepthM: meters(20), endDepthM: meters(20), environment: { surfacePressureBar: barAbsolute(1), metersPerBar } }).ok).toBe(false);
    expect(calculateSAC({ kind: "cylinder-pressure-drop", cylinderWaterVolumeL: liters(12), startingPressureBar: barGauge(200), endingPressureBar: barGauge(200), durationSeconds: seconds(600), startDepthM: meters(20), endDepthM: meters(20), environment: { surfacePressureBar: barAbsolute(1), metersPerBar } }).ok).toBe(false);
    expect(calculateSAC({ kind: "cylinder-pressure-drop", cylinderWaterVolumeL: liters(12), startingPressureBar: barGauge(-1), endingPressureBar: barGauge(-2), durationSeconds: seconds(600), startDepthM: meters(20), endDepthM: meters(20), environment: { surfacePressureBar: barAbsolute(1), metersPerBar } }).ok).toBe(false);
  });

  it("integrates pressure across rock-bottom and bailout legs", () => {
    const legs = [{ startDepthM: meters(30), endDepthM: meters(10), durationSeconds: seconds(600), rmvLpm: litersPerMinute(20) }];
    const rb = calculateRockBottom({ legs, surfacePressureBar: surfacePressure, metersPerBar, cylinderWaterVolumeL: liters(12) });
    expect(valueOf(rb).requiredGasL).toBeCloseTo(600);
    expect(valueOf(rb).minimumPressureBar).toBeCloseTo(50);
    expect(valueOf(calculateSimplifiedBailout({ legs, surfacePressureBar: surfacePressure, metersPerBar })).requiredGasL).toBeCloseTo(600);
    expect(calculateRockBottom({
      legs: [{ ...legs[0], endDepthM: meters(0) }],
      surfacePressureBar: surfacePressure,
      metersPerBar,
    }).ok).toBe(true);
    expect(calculateRockBottom({ legs: [{ ...legs[0], durationSeconds: seconds(0) }], surfacePressureBar: surfacePressure, metersPerBar }).ok).toBe(false);
    expect(calculateRockBottom({
      legs,
      surfacePressureBar: surfacePressure,
      metersPerBar,
      cylinderWaterVolumeL: liters(Number.NaN),
    }).ok).toBe(false);
  });

  it("calculates entered emergency schedules, cylinder margin, and CCR team semantics", () => {
    const fixture = TOOLS_REFERENCE_FIXTURES.emergency;
    const segments = fixture.input.segments.map((segment) => ({
      ...segment,
      startDepthM: meters(segment.startDepthM),
      endDepthM: meters(segment.endDepthM),
      durationSeconds: seconds(segment.durationSeconds),
      rmvLpm: litersPerMinute(fixture.input.stressedRmvSurfaceLpm),
    }));
    const environment = { surfacePressureBar: barAbsolute(1), metersPerBar };
    const equal = fixture.ocTeamTwoEqualMargin;
    const oc = valueOf(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(fixture.input.failureDepthM), teamSize: 2, segments, environment, cylinder: { waterVolumeL: liters(fixture.input.cylinder.waterVolumeL), startingPressureBar: barGauge(equal.startingPressureBarGauge), reservePressureBar: barGauge(fixture.input.cylinder.reservePressureBarGauge) } }));
    expect(oc.segments.map((segment) => segment.gasUsedL)).toEqual(equal.expectedSegmentGasSurfaceL);
    expect(oc.requiredGasL).toBeCloseTo(equal.expectedTotalGasSurfaceL, 8);
    expect(oc.teamMultiplier).toBe(2);
    expect(oc.pressureDropBar).toBeCloseTo(equal.expectedPressureDropBar, 8);
    expect(oc.requiredStartingPressureBar).toBeCloseTo(equal.expectedRequiredStartBarGauge, 8);
    expect(oc.remainingPressureBar).toBeCloseTo(equal.expectedRemainingBarGauge, 8);
    expect(oc.availablePressureBar).toBeCloseTo(equal.expectedPressureDropBar, 8);
    expect(oc.marginPressureBar).toBeCloseTo(0, 8);
    expect(oc.availableGasL).toBeCloseTo(equal.expectedAvailableGasSurfaceL, 8);
    expect(oc.marginGasL).toBeCloseTo(equal.expectedMarginGasSurfaceL, 8);
    expect(oc.sufficient).toBe(true); // equality is sufficient
    expect(oc.methodId).toBe("barefoot-emergency-gas-schedule-v1");
    expect(oc.segments[0].gasUsedL).toBeCloseTo(integratedSurfaceGas({ ...segments[0], teamSize: 2 }, environment.surfacePressureBar, environment.metersPerBar), 10);
    const scheduleOnly = valueOf(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(fixture.input.failureDepthM), teamSize: 2, segments, environment }));
    expect(scheduleOnly.requiredGasL).toBeCloseTo(equal.expectedTotalGasSurfaceL, 8);
    expect(scheduleOnly.sufficient).toBeUndefined();

    const insufficient = fixture.ocTeamTwoInsufficient;
    const shortCylinder = calculateEmergencyGas({ mode: "oc", failureDepthM: meters(fixture.input.failureDepthM), teamSize: 2, segments, environment, cylinder: { waterVolumeL: liters(fixture.input.cylinder.waterVolumeL), startingPressureBar: barGauge(insufficient.startingPressureBarGauge), reservePressureBar: barGauge(fixture.input.cylinder.reservePressureBarGauge) } });
    expect(shortCylinder.ok && shortCylinder.value.sufficient).toBe(false);
    expect(shortCylinder.ok && shortCylinder.value.remainingPressureBar).toBeCloseTo(insufficient.expectedRemainingBarGauge, 8);
    expect(shortCylinder.ok && shortCylinder.value.marginPressureBar).toBeCloseTo(insufficient.expectedMarginPressureBar, 8);
    expect(shortCylinder.ok && shortCylinder.value.availableGasL).toBeCloseTo(insufficient.expectedAvailableGasSurfaceL, 8);
    expect(shortCylinder.ok && shortCylinder.value.marginGasL).toBeCloseTo(insufficient.expectedMarginGasSurfaceL, 8);
    expect(shortCylinder.warnings.some((diagnostic) => diagnostic.code === "EMERGENCY_GAS_INSUFFICIENT")).toBe(true);

    const ccrFixture = fixture.ccrSingleDiverSufficient;
    const ccrCylinder = { waterVolumeL: liters(fixture.input.cylinder.waterVolumeL), startingPressureBar: barGauge(ccrFixture.startingPressureBarGauge), reservePressureBar: barGauge(fixture.input.cylinder.reservePressureBarGauge) };
    const ccr = valueOf(calculateEmergencyGas({ mode: "ccr", failureDepthM: meters(fixture.input.failureDepthM), teamSize: 1, segments, environment, cylinder: ccrCylinder }));
    expect(ccr.teamMultiplier).toBe(1);
    expect(ccr.segments.map((segment) => segment.gasUsedL)).toEqual(fixture.singleDiver.expectedSegmentGasSurfaceL);
    expect(ccr.requiredGasL).toBeCloseTo(ccrFixture.expectedTotalGasSurfaceL, 8);
    expect(ccr.pressureDropBar).toBeCloseTo(ccrFixture.expectedPressureDropBar, 8);
    expect(ccr.requiredStartingPressureBar).toBeCloseTo(ccrFixture.expectedRequiredStartBarGauge, 8);
    expect(ccr.remainingPressureBar).toBeCloseTo(ccrFixture.expectedRemainingBarGauge, 8);
    expect(ccr.availableGasL).toBeCloseTo(ccrFixture.expectedAvailableGasSurfaceL, 8);
    expect(ccr.marginGasL).toBeCloseTo(ccrFixture.expectedMarginGasSurfaceL, 8);
    expect(calculateEmergencyGas({ mode: "ccr", failureDepthM: meters(30), teamSize: 5, segments, environment, cylinder: ccrCylinder } as never).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "ccr", failureDepthM: meters(30), segments, environment } as never).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), segments, environment } as never).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), teamSize: 1, segments, environment, cylinder: { waterVolumeL: liters(12), startingPressureBar: barGauge(200) } } as never).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(0), teamSize: 1, segments: [{ ...segments[0], startDepthM: meters(0), endDepthM: meters(30) }], environment }).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), teamSize: 1, segments: [segments[0], { ...segments[2], startDepthM: meters(5) }], environment }).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), teamSize: 1, segments: [{ ...segments[0], endDepthM: meters(6) }], environment }).ok).toBe(false);
    expect(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), teamSize: 1, segments: undefined as never, environment }).ok).toBe(false);
    const emptyBeforeSurface = valueOf(calculateEmergencyGas({ mode: "oc", failureDepthM: meters(30), teamSize: 2, segments, environment, cylinder: { waterVolumeL: liters(12), startingPressureBar: barGauge(10), reservePressureBar: barGauge(0) } }));
    expect(emptyBeforeSurface.sufficient).toBe(false);
    expect(emptyBeforeSurface.remainingPressureBar).toBe(barGauge(0));
  });

  it("uses the NOAA CNS table with explicit Barefoot interpolation and bounds", () => {
    expect(valueOf(calculateCNS({ ppo2Bar: barAbsolute(1.4), durationSeconds: seconds(150 * 60) }))).toMatchObject({ percent: 100, limitSeconds: 9_000, method: "NOAA-table-Barefoot-linear-interpolation-v1" });
    expect(valueOf(calculateCNS({ ppo2Bar: barAbsolute(1.35), durationSeconds: seconds(165 * 60) })).percent).toBeCloseTo(100, 6);
    expect(calculateCNS({ ppo2Bar: barAbsolute(1.61), durationSeconds: seconds(1) }).ok).toBe(false);
    expect(calculateCNS({ ppo2Bar: barAbsolute(0.59), durationSeconds: seconds(60) }).ok).toBe(false);
  });
});
