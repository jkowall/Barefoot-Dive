import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import type { CcrDiveInput, Cylinder, Gas } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { calculateCavePlan, type CavePlanInput, type RouteLeg } from "./index";

const gas = (oxygenPercent: number, heliumPercent: number, id: string, role: Gas["role"], cylinderId: string): Gas => ({
  id,
  name: `Tx${oxygenPercent}/${heliumPercent}`,
  oxygen: fraction(oxygenPercent / 100),
  helium: fraction(heliumPercent / 100),
  role,
  cylinderId,
});

const cylinderFor = (item: Gas, waterVolumeL: number, maximumPPO2: number): Cylinder => ({
  id: item.cylinderId!,
  name: `${item.name} cylinder`,
  waterVolumeL: liters(waterVolumeL),
  workingPressureBar: barGauge(232),
  currentPressureBar: barGauge(200),
  gas: item,
  maximumPPO2: barAbsolute(maximumPPO2),
  revision: 1,
});

const leg = (id: string, startDepthM: number, endDepthM: number, accessibleCylinderIds: readonly string[]): RouteLeg => ({
  id,
  startDepthM: meters(startDepthM),
  endDepthM: meters(endDepthM),
  durationSeconds: seconds(300),
  distanceM: meters(100),
  propulsion: "fins",
  accessibleCylinderIds,
});

function caveInput(dive: Partial<CcrDiveInput>, route: readonly RouteLeg[], diluent: Gas, bailout: readonly Gas[], cylinders: readonly Cylinder[]): CavePlanInput {
  return {
    mode: "ccr",
    reserve: { kind: "thirds" },
    dive: {
      mode: "ccr",
      environment: "cave",
      depthM: meters(30),
      bottomTimeSeconds: seconds(120),
      diluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      lowSetpointBar: barAbsolute(0.7),
      bailoutGases: bailout,
      cylinders,
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
      ...dive,
    },
    route,
    scenarios: [],
  };
}

describe("cave CCR low setpoint and switch-down", () => {
  const hypoxicDiluent = gas(10, 70, "dil10", "diluent", "dil-cyl");
  const bailout = gas(21, 35, "bo2135", "bailout", "bo-cyl");
  const cylinders = [cylinderFor(hypoxicDiluent, 3, 1.4), cylinderFor(bailout, 11, 1.6)];
  const ids = ["dil-cyl", "bo-cyl"];

  it("plans a hypoxic diluent on the loop from an entrance below the surface", () => {
    const result = calculateCavePlan(caveInput({}, [leg("entry", 10, 30, ids)], hypoxicDiluent, [bailout], cylinders));
    expect(result.ok ? [] : result.errors.map((item) => item.code)).toEqual([]);
    if (!result.ok) return;
    const segments = result.value.base.segments;
    expect(segments[0]).toMatchObject({ startDepthM: 0, setpointBar: 0.7 });
    expect(segments.every((segment) => segment.setpointBar !== undefined)).toBe(true);
    expect(segments.at(-1)).toMatchObject({ endDepthM: 0, setpointBar: 0.7 });
    expect(result.warnings.some((item) => item.code === "CAVE_ASCENT_GAS_UNAVAILABLE")).toBe(false);
  });

  it("still requires an open-circuit surface gas for a legacy loop that opens above the activation depth", () => {
    const result = calculateCavePlan(caveInput({ lowSetpointBar: undefined }, [leg("entry", 10, 30, ids)], hypoxicDiluent, [bailout], cylinders));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toContain("CAVE_ASCENT_GAS_UNAVAILABLE");
  });

  it("splits exit legs at the switch-down depth", () => {
    const result = calculateCavePlan(caveInput(
      { setpointDeactivationDepthM: meters(9) },
      [leg("surface-entry", 0, 30, ids)],
      hypoxicDiluent,
      [bailout],
      cylinders,
    ));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const exits = result.value.base.segments.filter((segment) => segment.kind === "exit");
    expect(exits.find((segment) => segment.endDepthM === 9)?.setpointBar).toBe(1.3);
    expect(exits.find((segment) => segment.startDepthM === 9)?.setpointBar).toBe(0.7);
  });

  it("rejects a switch-down shallower than where the high setpoint can be held on explicit legs", () => {
    const result = calculateCavePlan(caveInput(
      { setpointDeactivationDepthM: meters(3) },
      [leg("surface-entry", 0, 30, ids)],
      hypoxicDiluent,
      [bailout],
      cylinders,
    ));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.find((item) => item.code === "CAVE_CCR_SWITCH_DOWN_TOO_SHALLOW")?.field)
      .toBe("dive.setpointDeactivationDepthM");
  });
});

describe("cave CCR dil-out", () => {
  const diluent = gas(21, 35, "dil2135", "diluent", "dil-cyl");
  const cylinders = [cylinderFor(diluent, 3, 1.4)];

  it("runs a loop failure on the diluent alone and does not subtract loop events from its turn limit", () => {
    const input: CavePlanInput = {
      ...caveInput(
        { diluentBailout: true, diluentPreBailoutUseL: liters(120) },
        [leg("deep", 0, 30, ["dil-cyl"])],
        diluent,
        [],
        cylinders,
      ),
      scenarios: [{ kind: "ccr-loop-failure", targetLegId: "deep" }],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scenario = result.value.scenarios[0];
    expect(scenario.plan).toBeDefined();
    expect(scenario.plan!.segments.find((segment) => segment.kind === "bailout")?.gasId).toBe("dil2135");
    const entry = result.value.gasLedger.find((item) => item.cylinderId === "dil-cyl")!;
    expect(entry.preBailoutDeductionL).toBeCloseTo(120, 9);
    expect(result.value.turnCylinderId).toBe("dil-cyl");
    expect(result.value.minimumRequiredAtTurnPressureBar).toBeCloseTo((entry.totalUsedL + entry.reserveL!) / 3, 6);
  });

  it("requires the diver-entered pre-bailout diluent use in cave plans too", () => {
    const result = calculateCavePlan(caveInput(
      { diluentBailout: true },
      [leg("deep", 0, 30, ["dil-cyl"])],
      diluent,
      [],
      cylinders,
    ));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toContain("DILUENT_PRE_BAILOUT_USE_REQUIRED");
  });
});

describe("cave CCR dil-out turn limits and gas order", () => {
  const diluent = gas(21, 35, "dil2135", "diluent", "dil-cyl");
  const cylinders = [{ ...cylinderFor(diluent, 11, 1.4), currentPressureBar: barGauge(200) }];
  const route: RouteLeg[] = [
    { ...leg("in", 10, 20, ["dil-cyl"]), durationSeconds: seconds(60) },
    { ...leg("far", 20, 20, ["dil-cyl"]), durationSeconds: seconds(600) },
  ];
  const dilOut = (preBailoutUseL: number, legs: readonly RouteLeg[] = route): CavePlanInput => ({
    ...caveInput({ depthM: meters(20), diluentBailout: true, diluentPreBailoutUseL: liters(preBailoutUseL) }, legs, diluent, [], cylinders),
    reserve: { kind: "thirds" },
    scenarios: [{ kind: "ccr-loop-failure", targetLegId: "far" }],
  });

  it("never reports a dil-out diluent turn pressure below what the exit and reserve require", () => {
    const result = calculateCavePlan(dilOut(300));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.turnCylinderId).toBe("dil-cyl");
    expect(result.value.turnPressureBar!).toBeGreaterThanOrEqual(result.value.minimumRequiredAtTurnPressureBar! - 1e-9);
    expect(result.value.turnPressureBar!).toBeGreaterThan(200 * 2 / 3);
  });

  it("scales pre-bailout diluent use with the route when solving the penetration maximum", () => {
    const result = calculateCavePlan(dilOut(300));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const maximum = result.value.maximumPermittedPenetrationTimeSeconds;
    expect(maximum).toBeDefined();
    const routeSeconds = route.reduce((sum, item) => sum + item.durationSeconds, 0);
    const scale = (maximum! / routeSeconds) * 0.999;
    expect(scale).toBeGreaterThan(1);
    const scaledRoute = route.map((item) => ({
      ...item,
      durationSeconds: seconds(item.durationSeconds * scale),
      distanceM: meters(item.distanceM * scale),
    }));
    const atMaximum = calculateCavePlan(dilOut(300 * scale, scaledRoute));
    expect(atMaximum.ok).toBe(true);
    if (!atMaximum.ok) return;
    expect(atMaximum.value.gasLedger.find((entry) => entry.cylinderId === "dil-cyl")?.sufficient).toBe(true);
  });

  it("orders an equal-oxygen diluent and bailout the same way as the planner (least helium first)", () => {
    const leanDiluent = gas(18, 20, "dil1820", "diluent", "dil-cyl");
    const bailout = gas(18, 45, "bo1845", "bailout", "bo-cyl");
    const input: CavePlanInput = {
      ...caveInput(
        { diluentBailout: true, diluentPreBailoutUseL: liters(100) },
        [leg("deep", 0, 30, ["dil-cyl", "bo-cyl"])],
        leanDiluent,
        [bailout],
        [cylinderFor(leanDiluent, 11, 1.4), cylinderFor(bailout, 11, 1.6)],
      ),
      scenarios: [{ kind: "ccr-loop-failure", targetLegId: "deep" }],
    };
    const result = calculateCavePlan(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const openCircuit = result.value.scenarios[0].plan!.segments.filter((segment) => segment.setpointBar === undefined && segment.durationSeconds > 0);
    expect(openCircuit.length).toBeGreaterThan(0);
    expect(new Set(openCircuit.map((segment) => segment.gasId))).toEqual(new Set(["dil1820"]));
  });
});
