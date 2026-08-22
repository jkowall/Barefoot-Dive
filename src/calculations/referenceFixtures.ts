/**
 * Literal, source-backed arithmetic fixtures for the Tools calculation layer.
 *
 * Expected values were hand-derived from the cited equations, independently of
 * the production helpers. They validate arithmetic and declared conventions;
 * they do not validate a dive procedure, real-gas behavior, or planner parity.
 */
export const TOOLS_REFERENCE_FIXTURES = {
  provenance: {
    fixtureVersion: "barefoot-tools-reference-fixtures-v1",
    reviewedOn: "2026-08-21",
    arithmeticReviewer: "Independent read-only Codex scientific review (gpt-5.6-sol)",
    qualifiedDiverReview: false,
    sources: {
      gas: "NOAA Diving Medical Technician Formula Book 111816, PDF p. 4, Air Requirement formulas 1-8",
      nitrogenOnlyEnd: "U.S. Navy Diving Manual Rev. 7 Change A (2018-04-30), Volume 1 p. 2-32, Table 2-9",
      endPolicies: "SSI EMS 202110.6, Equivalent Narcotic Depth section; Subsurface 4.9.4 release-note O2-narcotic preference",
    },
  },
  assumptions: {
    surfacePressureBarAbsolute: 1,
    metersPerBar: 10,
    surfaceLiterReferencePressureBar: 1,
    airNitrogenFraction: 0.79,
    cylinderModel: "ideal linear cylinder constant: water volume x gauge-pressure delta",
    movingDepthModel: "linear depth change, so arithmetic mean ambient pressure is time-weighted mean pressure",
  },
  bestMix: {
    input: { depthM: 60, maximumPPO2BarAbsolute: 1.4, maximumENDDepthM: 30 },
    oxygenAndNitrogen: {
      expected: { oxygen: 0.2, nitrogen: 0.37142857142857144, helium: 0.42857142857142855, actualPPO2BarAbsolute: 1.4, achievedENDDepthM: 30 },
      derivation: "P=1+60/10=7; Pend=1+30/10=4; O2=1.4/7=0.2; O2+N2=4/7; He=1-4/7; N2=4/7-0.2",
    },
    nitrogenOnly: {
      expected: { oxygen: 0.2, nitrogen: 0.45142857142857146, helium: 0.34857142857142853, actualPPO2BarAbsolute: 1.4, achievedENDDepthM: 30 },
      derivation: "P=7; Pend=4; O2=1.4/7=0.2; N2=0.79x4/7; He=1-O2-N2",
    },
    explicitTx1845NitrogenOnlyEND: {
      input: { depthM: 60, oxygen: 0.18, helium: 0.45 },
      expectedENDDepthM: 22.784810126582276,
      derivation: "N2=1-0.18-0.45=0.37; END=((7x0.37/0.79)-1)x10",
    },
  },
  sac: {
    direct: { gasUsedSurfaceL: 600, durationSeconds: 600, startDepthM: 20, endDepthM: 20 },
    cylinderDrop: { waterVolumeL: 12, startingPressureBarGauge: 200, endingPressureBarGauge: 150, durationSeconds: 600, startDepthM: 20, endDepthM: 20 },
    expected: { gasUsedSurfaceL: 600, averagePressureBarAbsolute: 3, rmvSurfaceLpm: 20 },
    derivation: "gas=12x(200-150)=600 L; ambient=1+20/10=3; RMV=600/10/3=20 L/min",
  },
  emergency: {
    input: {
      failureDepthM: 30,
      stressedRmvSurfaceLpm: 20,
      segments: [
        { kind: "ascent", startDepthM: 30, endDepthM: 6, durationSeconds: 240 },
        { kind: "stop", startDepthM: 6, endDepthM: 6, durationSeconds: 180 },
        { kind: "ascent", startDepthM: 6, endDepthM: 0, durationSeconds: 60 },
      ],
      cylinder: { waterVolumeL: 12, reservePressureBarGauge: 50 },
    },
    singleDiver: {
      expectedSegmentGasSurfaceL: [224, 96, 26],
      expectedTotalGasSurfaceL: 346,
      derivation: "20x4x2.8=224; 20x3x1.6=96; 20x1x1.3=26; total=346 L",
    },
    ocTeamTwoEqualMargin: {
      startingPressureBarGauge: 107.66666666666667,
      expectedSegmentGasSurfaceL: [448, 192, 52],
      expectedTotalGasSurfaceL: 692,
      expectedPressureDropBar: 57.666666666666664,
      expectedRequiredStartBarGauge: 107.66666666666666,
      expectedRemainingBarGauge: 50,
      expectedAvailableGasSurfaceL: 692,
      expectedMarginGasSurfaceL: 0,
      derivation: "team gas=346x2=692 L; drop=692/12=57.6667 bar; required start=50+57.6667=107.6667 bar",
    },
    ocTeamTwoInsufficient: {
      startingPressureBarGauge: 100,
      expectedRemainingBarGauge: 42.333333333333336,
      expectedMarginPressureBar: -7.666666666666664,
      expectedAvailableGasSurfaceL: 600,
      expectedMarginGasSurfaceL: -92,
      derivation: "available=(100-50)x12=600 L; margin=600-692=-92 L; pressure margin=-92/12=-7.6667 bar",
    },
    ccrSingleDiverSufficient: {
      startingPressureBarGauge: 200,
      expectedTotalGasSurfaceL: 346,
      expectedPressureDropBar: 28.833333333333332,
      expectedRequiredStartBarGauge: 78.83333333333333,
      expectedRemainingBarGauge: 171.16666666666666,
      expectedAvailableGasSurfaceL: 1800,
      expectedMarginGasSurfaceL: 1454,
      derivation: "CCR multiplier=1; drop=346/12=28.8333 bar; available=(200-50)x12=1800 L; margin=1454 L",
    },
  },
} as const;
