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
import type { CcrDiveInput, Cylinder, DivePlan, Gas, OcDiveInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { isBelowMinimumPPO2 } from "../domain/validation";
import { calculateDivePlan, calculateEventDivePlan, type ExposureEvent } from "./planner";
import { schreinerEquation } from "./tissues";
import { ZHL16C_N2_HALF_LIFE_MINUTES } from "./zhl16c";

const mix = (oxygenPercent: number, heliumPercent: number, id: string, role: Gas["role"], extra: Partial<Gas> = {}): Gas => ({
  id,
  name: `Tx${oxygenPercent}/${heliumPercent}`,
  oxygen: fraction(oxygenPercent / 100),
  helium: fraction(heliumPercent / 100),
  role,
  ...extra,
});

const cylinder = (gas: Gas, id: string, waterVolumeL = 11, pressureBar = 200, maximumPPO2 = 1.6): Cylinder => ({
  id,
  name: `${gas.name} cylinder`,
  waterVolumeL: liters(waterVolumeL),
  workingPressureBar: barGauge(232),
  currentPressureBar: barGauge(pressureBar),
  gas,
  maximumPPO2: barAbsolute(maximumPPO2),
  revision: 1,
});

const airDiluent: Gas = { ...AIR, id: "dil", name: "Air diluent", role: "diluent" };
const bottomBailout = mix(18, 45, "bo", "bailout");
const ean50Bailout: Gas = { ...EAN50, id: "bo50", role: "bailout", switchDepthM: meters(21) };

function ccr(overrides: Partial<CcrDiveInput> = {}): CcrDiveInput {
  return {
    mode: "ccr",
    environment: "open-water",
    depthM: meters(45),
    bottomTimeSeconds: seconds(30 * 60),
    diluent: airDiluent,
    setpointBar: barAbsolute(1.3),
    setpointActivationDepthM: meters(6),
    bailoutGases: [bottomBailout, ean50Bailout],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
    ...overrides,
  };
}

const lowCcr = (overrides: Partial<CcrDiveInput> = {}) => ccr({ lowSetpointBar: barAbsolute(0.7), ...overrides });

function plan(input: CcrDiveInput | OcDiveInput): DivePlan {
  const result = calculateDivePlan(input);
  if (!result.ok) throw new Error(`Expected a plan, got ${result.errors.map((item) => item.code).join(", ")}`);
  return result.value;
}

function errorCodes(input: CcrDiveInput | OcDiveInput): readonly string[] {
  const result = calculateDivePlan(input);
  return result.ok ? (result.errors ?? []).map((item) => item.code) : result.errors.map((item) => item.code);
}

const ascentSegments = (value: DivePlan) => value.segments.filter((segment) => segment.startRuntimeSeconds >= (value.segments.find((item) => item.kind === "bottom")!.startRuntimeSeconds + value.segments.find((item) => item.kind === "bottom")!.durationSeconds));

describe("CCR low setpoint on descent", () => {
  it("closes the loop at the low setpoint from the surface and switches up once at the activation depth", () => {
    const value = plan(lowCcr());
    const first = value.segments[0];
    expect(first.kind).toBe("descent");
    expect(first.startDepthM).toBe(0);
    expect(first.setpointBar).toBe(0.7);
    expect(value.segments.every((segment) => segment.setpointBar !== undefined)).toBe(true);
    const descentSwitches = value.segments.filter((segment) =>
      segment.kind === "setpoint-switch" && segment.startRuntimeSeconds < value.segments.find((item) => item.kind === "bottom")!.startRuntimeSeconds);
    expect(descentSwitches).toHaveLength(1);
    expect(descentSwitches[0].endDepthM).toBe(6);
    expect(descentSwitches[0].setpointBar).toBe(1.3);
  });

  it("loads tissues on the loop from the surface with inert = ambient − water vapor − setpoint", () => {
    const value = plan(lowCcr());
    const first = value.segments[0];
    const environment = DEFAULT_ENVIRONMENT;
    const initial = 0.7902 * (environment.surfacePressureBar - environment.waterVaporPressureBar);
    // Air diluent: nitrogen is the whole inert fraction.
    const inspiredStart = environment.surfacePressureBar - environment.waterVaporPressureBar - 0.7;
    const inspiredEnd = environment.surfacePressureBar + 6 / environment.metersPerBar - environment.waterVaporPressureBar - 0.7;
    const minutes = first.durationSeconds / 60;
    const expected = schreinerEquation(initial, inspiredStart, (inspiredEnd - inspiredStart) / minutes, minutes, ZHL16C_N2_HALF_LIFE_MINUTES[0]);
    expect(first.durationSeconds).toBe(20);
    expect(first.tissuesAfter.compartments[0].nitrogenBar).toBeCloseTo(expected, 12);
    expect(first.tissuesAfter.compartments[0].heliumBar).toBe(0);
  });

  it("transfers bailout from the exact at-depth tissue state on the low-setpoint path", () => {
    const input = lowCcr({ bailoutTriggerSecondsAtDepth: seconds(10 * 60) });
    const bailout = plan(input).bailoutPlan!;
    const triggerBottom = bailout.segments.find((segment) => segment.kind === "bottom" && segment.durationSeconds === 600)!;
    const tenMinute = plan(lowCcr({ bottomTimeSeconds: seconds(600), bailoutTriggerSecondsAtDepth: seconds(600) }));
    const normalBottom = tenMinute.segments.find((segment) => segment.kind === "bottom" && segment.durationSeconds === 600)!;
    expect(triggerBottom.tissuesAfter).toEqual(normalBottom.tissuesAfter);
  });

  it("is never slower than legacy open-circuit air diluent above the activation depth", () => {
    expect(plan(lowCcr()).summary.ttsSeconds).toBeLessThanOrEqual(plan(ccr()).summary.ttsSeconds);
  });

  it("shortens or keeps decompression as the high setpoint rises", () => {
    const tts = [1.2, 1.3, 1.4].map((setpoint) => plan(lowCcr({ setpointBar: barAbsolute(setpoint) })).summary.ttsSeconds);
    expect(tts[1]).toBeLessThanOrEqual(tts[0]);
    expect(tts[2]).toBeLessThanOrEqual(tts[1]);
  });
});

describe("CCR switch-down on ascent", () => {
  it("holds the high setpoint for the whole 6 m stop and switches down when leaving it", () => {
    const value = plan(lowCcr());
    const stops = value.segments.filter((segment) => segment.kind === "stop" && segment.endDepthM === 6);
    expect(stops.length).toBeGreaterThan(0);
    expect(stops.every((segment) => segment.setpointBar === 1.3)).toBe(true);
    const tail = value.segments.slice(-2);
    expect(tail[0]).toMatchObject({ kind: "setpoint-switch", startDepthM: 6, setpointBar: 0.7 });
    expect(tail[1]).toMatchObject({ kind: "ascent", startDepthM: 6, endDepthM: 0, setpointBar: 0.7 });
    expect(value.segments.some((segment) => segment.setpointBar === undefined)).toBe(false);
  });

  it.each([5, 4])("switches at %d m mid-leg without adding a stop there", (depth) => {
    const value = plan(lowCcr({ setpointDeactivationDepthM: meters(depth) }));
    const switchDown = ascentSegments(value).filter((segment) => segment.kind === "setpoint-switch");
    expect(switchDown).toHaveLength(1);
    expect(switchDown[0].startDepthM).toBe(depth);
    expect(value.segments.some((segment) => segment.kind === "stop" && segment.endDepthM === depth)).toBe(false);
    const index = value.segments.indexOf(switchDown[0]);
    expect(value.segments[index - 1]).toMatchObject({ endDepthM: depth, setpointBar: 1.3 });
    expect(value.segments[index + 1]).toMatchObject({ startDepthM: depth, setpointBar: 0.7 });
  });

  it("inserts a 3 m waypoint shallower than the last stop instead of ignoring the switch", () => {
    // 1.2 bar can be held up to 2.63 m, so a 3 m switch-down is honored as entered.
    const value = plan(lowCcr({ setpointBar: barAbsolute(1.2), setpointDeactivationDepthM: meters(3) }));
    const switchDown = ascentSegments(value).filter((segment) => segment.kind === "setpoint-switch");
    expect(switchDown).toHaveLength(1);
    expect(switchDown[0].startDepthM).toBe(3);
    expect(value.diagnostics.some((item) => item.code === "CCR_SWITCH_DOWN_DEEPENED")).toBe(false);
  });

  const achievable = (1.3 + 0.0627 - 1) * 10;

  it.each([0, 3])("deepens a %d m switch-down to where the loop can still hold the high setpoint", (depth) => {
    const value = plan(lowCcr({ setpointDeactivationDepthM: meters(depth) }));
    const switchDown = ascentSegments(value).filter((segment) => segment.kind === "setpoint-switch");
    expect(switchDown).toHaveLength(1);
    expect(switchDown[0].startDepthM).toBeCloseTo(achievable, 9);
    const deepened = value.diagnostics.find((item) => item.code === "CCR_SWITCH_DOWN_DEEPENED");
    expect(deepened?.severity).toBe("warning");
    expect(deepened?.depthM).toBeCloseTo(achievable, 9);
    expect(value.segments.every((segment) =>
      segment.setpointBar !== 1.3 || segment.endDepthM >= achievable - 1e-9)).toBe(true);
    expect(value.segments).toEqual(plan(lowCcr({ setpointDeactivationDepthM: meters(achievable) })).segments);
  });

  it("does not extend the no-stop limit by modeling the loop as oxygen at ambient", () => {
    // 30 m on Tx18/45 at GF 30/70: with the old clamp, a 0 m switch-down surfaced without a stop
    // at 890 s while a 3 m switch-down needed one.
    const input = (depth: number) => lowCcr({
      depthM: meters(30),
      bottomTimeSeconds: seconds(890),
      diluent: mix(18, 45, "dil1845", "diluent"),
      setpointDeactivationDepthM: meters(depth),
      bailoutGases: [bottomBailout],
      settings: { ...DEFAULT_PLANNER_SETTINGS, gfLow: fraction(0.3), gfHigh: fraction(0.7) },
    });
    const toSurface = plan(input(0));
    expect(toSurface.stops.length).toBeGreaterThan(0);
    expect(toSurface.segments).toEqual(plan(input(achievable)).segments);
  });

  it("runs a 3 m last stop on the low setpoint when the high setpoint cannot be held there", () => {
    const value = plan(lowCcr({
      setpointDeactivationDepthM: meters(0),
      settings: { ...DEFAULT_PLANNER_SETTINGS, lastStopDepthM: meters(3) },
    }));
    const shallowStops = value.segments.filter((segment) => segment.kind === "stop" && segment.endDepthM === 3);
    expect(shallowStops.length).toBeGreaterThan(0);
    expect(shallowStops.every((segment) => segment.setpointBar === 0.7)).toBe(true);
    expect(value.diagnostics.map((item) => item.code)).toContain("CCR_SWITCH_DOWN_DEEPENED");
  });

  it.each([
    [50, 180, 1.2, 0.5, 40],
    [50, 180, 1.3, 0.5, 40],
    [60, 120, 1.4, 0.5, 50],
    [60, 120, 1.4, 0.7, 50],
    [70, 180, 1.3, 0.5, 40],
  ])("never ascends above the ceiling after a deep switch-down (%d m, %d s, %d/%d bar, D %d m)", (depth, bottom, high, low, switchDown) => {
    const value = plan(lowCcr({
      depthM: meters(depth),
      bottomTimeSeconds: seconds(bottom),
      setpointBar: barAbsolute(high),
      lowSetpointBar: barAbsolute(low),
      setpointDeactivationDepthM: meters(switchDown),
      bailoutGases: [bottomBailout, ean50Bailout],
    }));
    for (const segment of ascentSegments(value)) {
      expect(segment.ceilingDepthM, `${segment.kind} ending at ${segment.endDepthM} m`).toBeLessThanOrEqual(segment.endDepthM + 1e-9);
    }
  });

  it("stops at 12 m, not 9 m, when the low setpoint loads gas after a deep switch-down", () => {
    const value = plan(lowCcr({
      depthM: meters(50),
      bottomTimeSeconds: seconds(180),
      setpointBar: barAbsolute(1.2),
      lowSetpointBar: barAbsolute(0.5),
      setpointDeactivationDepthM: meters(40),
    }));
    expect(value.stops[0]?.depthM).toBe(12);
  });

  it("runs stops shallower than a deep switch-down on the low setpoint, which lengthens decompression", () => {
    const deep = plan(lowCcr({ setpointDeactivationDepthM: meters(12) }));
    expect(deep.segments.filter((segment) => segment.kind === "stop" && segment.endDepthM === 6)
      .every((segment) => segment.setpointBar === 0.7)).toBe(true);
    expect(deep.summary.ttsSeconds).toBeGreaterThan(plan(lowCcr()).summary.ttsSeconds);
  });

  it("models the switch time on the lower setpoint under a convention with a switch duration", () => {
    const settings = { ...DEFAULT_PLANNER_SETTINGS, conventionId: "shearwater-petrel3-v103-compatible-v1" as const };
    const value = plan(lowCcr({ settings }));
    const up = value.segments.find((segment) => segment.kind === "setpoint-switch")!;
    expect(up.durationSeconds).toBe(5);
    expect(up.setpointBar).toBe(1.3);
    const before = value.segments[value.segments.indexOf(up) - 1];
    const environment = DEFAULT_ENVIRONMENT;
    const inspired = environment.surfacePressureBar + 0.6 - environment.waterVaporPressureBar - 0.7;
    const expected = schreinerEquation(before.tissuesAfter.compartments[0].nitrogenBar, inspired, 0, 5 / 60, ZHL16C_N2_HALF_LIFE_MINUTES[0]);
    expect(up.tissuesAfter.compartments[0].nitrogenBar).toBeCloseTo(expected, 12);
  });
});

describe("CCR setpoint validation", () => {
  it.each([
    [{ lowSetpointBar: barAbsolute(0.49) }, "CCR_LOW_SETPOINT_INVALID"],
    [{ lowSetpointBar: barAbsolute(1.61) }, "CCR_LOW_SETPOINT_INVALID"],
    [{ lowSetpointBar: barAbsolute(Number.NaN) }, "CCR_LOW_SETPOINT_INVALID"],
    [{ lowSetpointBar: "0.7" as unknown as ReturnType<typeof barAbsolute> }, "CCR_LOW_SETPOINT_INVALID"],
    [{ lowSetpointBar: barAbsolute(1.35) }, "CCR_LOW_SETPOINT_ABOVE_HIGH"],
    [{ lowSetpointBar: barAbsolute(0.7), setpointDeactivationDepthM: meters(-1) }, "CCR_SWITCH_DOWN_DEPTH_INVALID"],
    [{ lowSetpointBar: barAbsolute(0.7), setpointDeactivationDepthM: meters(46) }, "CCR_SWITCH_DOWN_DEPTH_INVALID"],
    [{ lowSetpointBar: barAbsolute(0.7), setpointDeactivationDepthM: meters(Number.NaN) }, "CCR_SWITCH_DOWN_DEPTH_INVALID"],
    [{ setpointDeactivationDepthM: meters(6) }, "CCR_SWITCH_DOWN_REQUIRES_LOW_SETPOINT"],
    [{ diluentBailout: "yes" as unknown as boolean }, "CCR_DILUENT_BAILOUT_INVALID"],
    [{ gasOnly: 1 as unknown as boolean }, "GAS_ONLY_INVALID"],
  ] as const)("rejects %o with %s", (overrides, code) => {
    expect(errorCodes(ccr(overrides as Partial<CcrDiveInput>))).toContain(code);
  });

  it("rejects a low setpoint above the bottom PPO₂ limit and one the loop cannot hold at the surface", () => {
    expect(errorCodes(lowCcr({
      setpointBar: barAbsolute(1.2),
      lowSetpointBar: barAbsolute(1.2),
      settings: { ...DEFAULT_PLANNER_SETTINGS, maximumBottomPPO2: barAbsolute(1.1), maximumDecoPPO2: barAbsolute(1.6) },
    }))).toContain("CCR_LOW_SETPOINT_LIMIT_EXCEEDED");
    expect(errorCodes(lowCcr({
      environmentSettings: { ...DEFAULT_ENVIRONMENT, surfacePressureBar: barAbsolute(0.7) },
      depthM: meters(30),
    }))).toContain("CCR_LOW_SETPOINT_NOT_ACHIEVABLE");
  });

  it("accepts a hypoxic diluent on the low-setpoint loop and warns about flushes, but still rejects it in legacy mode", () => {
    const hypoxic = mix(10, 70, "dil10", "diluent");
    const lowMode = calculateDivePlan(lowCcr({ depthM: meters(60), diluent: hypoxic }));
    expect(lowMode.ok).toBe(true);
    if (!lowMode.ok) return;
    const flush = lowMode.warnings.find((item) => item.code === "CCR_DILUENT_FLUSH_HYPOXIC");
    expect(flush?.depthM).toBeCloseTo((0.16 / 0.1 - 1) * 10, 9);
    expect(lowMode.value.segments.every((segment) => segment.setpointBar !== undefined)).toBe(true);
    expect(lowMode.warnings.some((item) => item.code === "CCR_DILUENT_OC_RANGE")).toBe(false);
    expect(errorCodes(ccr({ depthM: meters(60), diluent: hypoxic }))).toContain("CCR_DILUENT_OC_RANGE");
  });

  it("warns when the diluent alone is richer than the low or high setpoint", () => {
    const rich = calculateDivePlan(lowCcr({ diluent: { ...EAN50, id: "dil50", name: "EAN50 diluent", role: "diluent", switchDepthM: undefined }, depthM: meters(25), bottomTimeSeconds: seconds(10 * 60) }));
    expect(rich.ok ? [] : rich.errors.map((item) => item.code)).toEqual([]);
    if (!rich.ok) return;
    expect(rich.warnings.filter((item) => item.code === "CCR_DILUENT_PPO2_ABOVE_SETPOINT").map((item) => item.field)).toEqual(
      expect.arrayContaining(["lowSetpointBar", "diluent"]),
    );
  });
});

describe("CCR bailout coverage", () => {
  it("honours a bailout gas switch depth at the trigger depth", () => {
    expect(errorCodes(ccr({ bailoutGases: [mix(18, 45, "bo", "bailout", { switchDepthM: meters(30) })] })))
      .toContain("CCR_BAILOUT_AT_DEPTH_REQUIRED");
  });

  it("requires a bailout gas that is breathable at the surface", () => {
    const hypoxic = mix(10, 70, "dil10", "diluent", { cylinderId: "dil-cyl" });
    expect(errorCodes(lowCcr({
      depthM: meters(60),
      diluent: hypoxic,
      bailoutGases: [],
      diluentBailout: true,
      diluentPreBailoutUseL: liters(100),
      cylinders: [cylinder(hypoxic, "dil-cyl", 3, 200, 1.4)],
    }))).toContain("CCR_BAILOUT_SURFACE_REQUIRED");
  });

  it("finds the gap between a hypoxic dil-out floor and a shallow oxygen switch", () => {
    const hypoxic = mix(10, 70, "dil10", "diluent", { cylinderId: "dil-cyl" });
    const oxygen: Gas = { ...OXYGEN, id: "bo2", role: "bailout", switchDepthM: meters(3), cylinderId: "o2-cyl" };
    const result = calculateDivePlan(lowCcr({
      depthM: meters(60),
      diluent: hypoxic,
      bailoutGases: [oxygen],
      diluentBailout: true,
      diluentPreBailoutUseL: liters(100),
      cylinders: [cylinder(hypoxic, "dil-cyl", 3, 200, 1.4), cylinder(oxygen, "o2-cyl", 3, 200, 1.6)],
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const gap = result.errors.find((item) => item.code === "CCR_BAILOUT_COVERAGE_GAP");
    expect(gap?.actual).toBeCloseTo(3, 9);
    expect(gap?.limit).toBeCloseTo((0.16 / 0.1 - 1) * 10, 9);
  });

  it("warns when the trigger bailout gas exceeds the bottom PPO₂ limit without changing the selection", () => {
    const ean32: Gas = { id: "bo32", name: "EAN32", oxygen: fraction(0.32), helium: fraction(0), role: "bailout" };
    const value = plan(lowCcr({ depthM: meters(38), bottomTimeSeconds: seconds(20 * 60), bailoutGases: [ean32] }));
    const warning = value.bailoutPlan!.diagnostics.find((item) => item.code === "CCR_BAILOUT_TRIGGER_PPO2_HIGH");
    expect(warning?.gasId).toBe("bo32");
    expect(warning?.actual).toBeCloseTo(0.32 * 4.8, 9);
    expect(value.bailoutPlan!.segments.find((segment) => segment.kind === "gas-switch")?.gasId).toBe("bo32");
  });
});

describe("dil-out", () => {
  const diluent = mix(21, 35, "dil", "diluent", { cylinderId: "dil-cyl" });
  const diluentCylinder = cylinder(diluent, "dil-cyl", 3, 200, 1.4);

  it("prefers a dedicated bailout over the diluent for an identical mix", () => {
    const bailout = mix(21, 35, "bo", "bailout", { cylinderId: "bo-cyl" });
    const value = plan(lowCcr({
      diluent,
      bailoutGases: [bailout],
      diluentBailout: true,
      diluentPreBailoutUseL: liters(120),
      cylinders: [diluentCylinder, cylinder(bailout, "bo-cyl")],
    }));
    expect(value.bailoutPlan!.segments.find((segment) => segment.kind === "gas-switch")?.gasId).toBe("bo");
  });

  it("bails out onto the diluent when it is the only bailout gas and debits the diluent cylinder", () => {
    const input = lowCcr({
      depthM: meters(40),
      bottomTimeSeconds: seconds(10 * 60),
      diluent,
      bailoutGases: [],
      diluentBailout: true,
      diluentPreBailoutUseL: liters(120),
      cylinders: [diluentCylinder],
      reservePolicy: { kind: "thirds" },
    });
    const result = calculateDivePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.some((item) => item.code === "GAS_ID_DUPLICATE")).toBe(false);
    expect(result.warnings.map((item) => item.code)).toContain("DILUENT_BAILOUT_LOOP_USE_UNMODELED");
    const bailout = result.value.bailoutPlan!;
    expect(bailout.segments.find((segment) => segment.kind === "gas-switch")?.gasId).toBe("dil");
    const entry = bailout.gasLedger.find((item) => item.cylinderId === "dil-cyl")!;
    expect(entry.preBailoutDeductionL).toBeCloseTo(120, 9);
    expect(entry.startingVolumeL).toBeCloseTo(3 * 200 - 120, 9);
    // The thirds reserve stays on the full entered volume, so the deduction cannot shrink it.
    expect(entry.reserveL).toBeCloseTo((3 * 200) / 3, 9);
    expect(entry.remainingVolumeL).toBeCloseTo(3 * 200 - 120 - entry.totalUsedL, 6);
  });

  it("also deducts modeled open-circuit diluent breathing before the trigger in legacy mode", () => {
    const value = plan(ccr({
      diluent,
      bailoutGases: [],
      diluentBailout: true,
      diluentPreBailoutUseL: liters(50),
      cylinders: [diluentCylinder],
      depthM: meters(40),
      bottomTimeSeconds: seconds(10 * 60),
    }));
    const entry = value.bailoutPlan!.gasLedger.find((item) => item.cylinderId === "dil-cyl")!;
    const descentToActivation = value.segments[0];
    expect(descentToActivation.setpointBar).toBeUndefined();
    // 0→6 m in 20 s at 20 L/min: mean ambient 1.3 bar.
    expect(entry.preBailoutDeductionL).toBeCloseTo(50 + 20 * 1.3 * (20 / 60), 6);
  });

  it("requires an explicit pre-bailout diluent use and a diluent cylinder", () => {
    expect(errorCodes(lowCcr({ diluent, diluentBailout: true, cylinders: [diluentCylinder] })))
      .toContain("DILUENT_PRE_BAILOUT_USE_REQUIRED");
    expect(errorCodes(lowCcr({ diluent: { ...diluent, cylinderId: undefined }, diluentBailout: true, diluentPreBailoutUseL: liters(10) })))
      .toContain("DILUENT_BAILOUT_CYLINDER_REQUIRED");
    expect(errorCodes(lowCcr({ diluent, diluentBailout: true, diluentPreBailoutUseL: liters(601), cylinders: [diluentCylinder] })))
      .toContain("DILUENT_PRE_BAILOUT_USE_INVALID");
  });
});

describe("open-circuit hypoxic legs", () => {
  const travel: Gas = { ...AIR, id: "travel-air", role: "travel" };
  const oc = (bottomGas: Gas, depthM: number, minutes: number): OcDiveInput => ({
    mode: "oc",
    environment: "open-water",
    depthM: meters(depthM),
    bottomTimeSeconds: seconds(minutes * 60),
    bottomGas,
    travelGas: travel,
    decoGases: [],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
  });
  const minimumOcPPO2 = (value: DivePlan, input: OcDiveInput) => Math.min(...value.segments
    .filter((segment) => segment.setpointBar === undefined)
    .flatMap((segment) => {
      const gas = [input.bottomGas, input.travelGas!].find((candidate) => candidate.id === segment.gasId)!;
      return [segment.startDepthM, segment.endDepthM].map((depth) => gas.oxygen * (1 + depth / 10));
    }));

  it.each([
    [mix(14, 50, "b", "bottom"), 40, 3],
    [mix(14, 50, "b", "bottom"), 20, 5],
    [mix(14, 50, "b", "bottom"), 30, 3],
    [mix(13, 0, "b", "bottom"), 25, 3],
    [mix(12, 60, "b", "bottom", { switchDepthM: meters(5) }), 20, 3],
    [mix(13, 14, "b", "bottom"), 60, 10],
  ] as const)("switches %o at %d m for %d min to the travel gas before it becomes hypoxic", (bottomGas, depth, minutes) => {
    const input = oc(bottomGas, depth, minutes);
    const value = plan(input);
    expect(minimumOcPPO2(value, input)).toBeGreaterThanOrEqual(0.16 - 1e-8);
    expect(value.segments.some((segment) => segment.kind === "gas-switch" && segment.gasId === "travel-air")).toBe(true);
    expect(value.diagnostics.some((item) => item.code === "OC_GAS_HYPOXIC")).toBe(false);
  });

  it("switches mid-leg at the travel switch depth without adding a stop", () => {
    const value = plan(oc(mix(12, 60, "b", "bottom", { switchDepthM: meters(5) }), 20, 3));
    const ascentSwitch = value.segments.filter((segment) => segment.kind === "gas-switch").at(-1)!;
    expect(ascentSwitch.startDepthM).toBe(5);
    expect(value.segments.some((segment) => segment.kind === "stop" && segment.endDepthM === 5)).toBe(false);
  });

  it("fails the plan when an ascent has no breathable gas left", () => {
    const bottomGas = mix(10, 70, "b10", "bottom");
    const input: OcDiveInput = { ...oc(bottomGas, 20, 3), decoGases: [] };
    const events: ExposureEvent[] = [
      { id: "travel", kind: "descent", startDepthM: meters(0), endDepthM: meters(9), durationSeconds: seconds(30), gas: travel, strategy: { kind: "open-circuit", gas: travel } },
      { id: "bottom-descent", kind: "descent", startDepthM: meters(9), endDepthM: meters(20), durationSeconds: seconds(37), gas: bottomGas, strategy: { kind: "open-circuit", gas: bottomGas } },
      { id: "bottom", kind: "bottom", startDepthM: meters(20), endDepthM: meters(20), durationSeconds: seconds(180), gas: bottomGas, strategy: { kind: "open-circuit", gas: bottomGas } },
    ];
    // Only the hypoxic bottom gas is offered for the final ascent, so nothing can be switched to.
    const result = calculateEventDivePlan(input, events, { ascentGases: [bottomGas] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toEqual(["OC_GAS_HYPOXIC"]);
    const hypoxic = result.errors[0];
    expect(hypoxic).toMatchObject({ gasId: "b10", limit: 0.16 });
    expect(hypoxic.depthM).toBeLessThan(6);
    expect(hypoxic.runtimeSeconds).toBeGreaterThan(0);
  });

  it("uses one tolerance at the exact hypoxic boundary", () => {
    expect(isBelowMinimumPPO2(0.1 * (1 + 6 / 10), 0.16)).toBe(false);
    expect(isBelowMinimumPPO2(0.16 - 2e-8, 0.16)).toBe(true);
  });
});

describe("open-circuit stops that cannot clear on their gas", () => {
  const air4: Gas = { ...AIR, id: "bo-air", role: "bailout", switchDepthM: meters(4) };
  const tx1260 = mix(12, 60, "bo1260", "bailout");

  it("moves a CCR bailout from a 6 m stop on Tx12/60 to air at 4 m instead of stopping for 48 hours", () => {
    const result = calculateDivePlan(ccr({ depthM: meters(60), bottomTimeSeconds: seconds(10 * 60), bailoutGases: [tx1260, air4] }));
    expect(result.ok ? [] : result.errors.map((item) => item.code)).toEqual([]);
    if (!result.ok) return;
    const bailout = result.value.bailoutPlan!;
    const codes = bailout.diagnostics.map((item) => item.code);
    expect(codes).not.toContain("DECOMPRESSION_LIMIT_EXCEEDED");
    expect(codes).toContain("OC_STOP_MOVED_FOR_GAS_SWITCH");
    const toAir = bailout.segments.find((segment) => segment.kind === "gas-switch" && segment.gasId === "bo-air");
    expect(toAir?.startDepthM).toBe(4);
    // The move to 4 m is taken only when 4 m is inside the ceiling. (The deep first-stop leg
    // of this helium-heavy bailout crosses the GF-low ceiling exactly as engine 0.1.0 did.)
    for (const segment of bailout.segments.filter((item) => item.endDepthM <= 6 && (item.kind === "bailout" || item.kind === "stop"))) {
      expect(segment.ceilingDepthM).toBeLessThanOrEqual(segment.endDepthM + 1e-9);
    }
    expect(bailout.summary.ttsSeconds).toBeLessThan(24 * 60 * 60);
  });

  it.each([
    ["Tx14/50 with an air travel gas", mix(14, 50, "b1450", "bottom")],
    ["Tx12/60 switching at 5 m with an air travel gas", mix(12, 60, "b1260", "bottom", { switchDepthM: meters(5) })],
  ])("finishes an OC plan on %s", (_label, bottomGas) => {
    const input: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(60),
      bottomTimeSeconds: seconds(20 * 60),
      bottomGas,
      travelGas: { ...AIR, id: "travel", role: "travel" },
      decoGases: [],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = calculateDivePlan(input);
    expect(result.ok ? [] : result.errors.map((item) => item.code)).toEqual([]);
    if (!result.ok) return;
    expect(result.value.diagnostics.map((item) => item.code)).toContain("OC_STOP_MOVED_FOR_GAS_SWITCH");
    expect(result.value.segments.at(-1)?.gasId).toBe("travel");
  });

  it("marks the CCR plan unusable when its bailout cannot finish decompression within 48 hours", () => {
    // Tx18/45 alone from 60 m after two hours: the loop plan completes, the bailout does not.
    const input = lowCcr({ depthM: meters(60), bottomTimeSeconds: seconds(120 * 60), bailoutGases: [bottomBailout] });
    const result = calculateDivePlan(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const failure = result.errors.find((item) => item.code === "DECOMPRESSION_LIMIT_EXCEEDED");
    expect(failure?.message.startsWith("Bailout plan:")).toBe(true);
  });
});

describe("recheck regressions", () => {
  it("does not hold an explicit event setpoint shallower than the loop can reach it", () => {
    const input = lowCcr({ depthM: meters(30), setpointBar: barAbsolute(1.0), setpointDeactivationDepthM: meters(0) });
    const events: ExposureEvent[] = [
      { id: "descent", kind: "descent", startDepthM: meters(0), endDepthM: meters(30), durationSeconds: seconds(180), gas: airDiluent, strategy: { kind: "ccr", diluent: airDiluent, setpointBar: barAbsolute(0.7) } },
      { id: "bottom", kind: "bottom", startDepthM: meters(30), endDepthM: meters(30), durationSeconds: seconds(40 * 60), gas: airDiluent, strategy: { kind: "ccr", diluent: airDiluent, setpointBar: barAbsolute(1.4) } },
    ];
    const result = calculateEventDivePlan(input, events);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const reachable = (1.4 + 0.0627 - 1) * 10;
    for (const segment of result.value.segments.filter((item) => item.setpointBar === 1.4)) {
      expect(segment.endDepthM).toBeGreaterThanOrEqual(reachable - 1e-9);
    }
  });

  it("moves only the stop that cannot clear and leaves deeper stops on the grid", () => {
    const tx1070 = mix(10, 70, "bo1070", "bailout");
    const tx1260 = mix(12, 60, "bo1260", "bailout", { switchDepthM: meters(22) });
    const air4: Gas = { ...AIR, id: "bo-air", role: "bailout", switchDepthM: meters(4) };
    const value = plan(ccr({ depthM: meters(60), bottomTimeSeconds: seconds(10 * 60), bailoutGases: [tx1070, tx1260, air4] }));
    const bailout = value.bailoutPlan!;
    expect(bailout.diagnostics.map((item) => item.code)).toContain("OC_STOP_MOVED_FOR_GAS_SWITCH");
    const offGridStops = bailout.stops.filter((stop) => stop.depthM % 3 !== 0);
    expect(offGridStops.map((stop) => stop.depthM)).toEqual([4]);
    expect(bailout.segments.find((segment) => segment.kind === "gas-switch" && segment.gasId === "bo-air")?.startDepthM).toBe(4);
  });
});
