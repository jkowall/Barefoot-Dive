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
import type { CcrDiveInput, DivePlan, Gas, OcDiveInput, PlannerSettings } from "../domain/types";
import { barAbsolute, fraction, meters, seconds } from "../domain/units";
import { calculateDivePlan } from "./planner";

const mix = (oxygenPercent: number, heliumPercent: number, role: Gas["role"], extra: Partial<Gas> = {}): Gas => ({
  id: `tx${oxygenPercent}-${heliumPercent}-${role}`,
  name: `Tx${oxygenPercent}/${heliumPercent}`,
  oxygen: fraction(oxygenPercent / 100),
  helium: fraction(heliumPercent / 100),
  role,
  ...extra,
});

const airDiluent: Gas = { ...AIR, id: "dil", name: "Air diluent", role: "diluent" };
const trimixDiluent: Gas = { ...mix(21, 35, "diluent"), id: "dil" };
const ean50Bailout: Gas = { ...EAN50, id: "bo50", role: "bailout", switchDepthM: meters(21) };
const oxygenBailout: Gas = { ...OXYGEN, id: "bo100", role: "bailout", switchDepthM: meters(6) };

const GF_PAIRS = [[0.3, 0.7], [0.2, 0.85], [0.5, 0.8]] as const;
const CONVENTIONS = ["barefoot-zhl16c-v1", "multideco-zhlc-compatible-v1", "shearwater-petrel3-v103-compatible-v1"] as const;

function settings(gfLow: number, gfHigh: number, conventionId: string = DEFAULT_PLANNER_SETTINGS.conventionId): PlannerSettings {
  return { ...DEFAULT_PLANNER_SETTINGS, conventionId, gfLow: fraction(gfLow), gfHigh: fraction(gfHigh) } as PlannerSettings;
}

function ccr(overrides: Partial<CcrDiveInput> = {}): CcrDiveInput {
  return {
    mode: "ccr",
    environment: "open-water",
    depthM: meters(60),
    bottomTimeSeconds: seconds(10 * 60),
    diluent: airDiluent,
    setpointBar: barAbsolute(1.3),
    setpointActivationDepthM: meters(6),
    bailoutGases: [mix(12, 60, "bailout"), ean50Bailout],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
    ...overrides,
  };
}

function oc(overrides: Partial<OcDiveInput> = {}): OcDiveInput {
  return {
    mode: "oc",
    environment: "open-water",
    depthM: meters(60),
    bottomTimeSeconds: seconds(20 * 60),
    bottomGas: mix(18, 45, "bottom"),
    decoGases: [],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
    ...overrides,
  };
}

function plan(input: OcDiveInput | CcrDiveInput): DivePlan {
  const result = calculateDivePlan(input);
  expect(result.ok ? [] : result.errors.map((item) => item.code)).toEqual([]);
  if (!result.ok) throw new Error("plan failed");
  return result.value;
}

/**
 * Segments of the given kinds whose end depth is shallower than their own-GF ceiling. The
 * scheduler accepts 1e-8 bar (about 1e-7 m), so 1e-6 m avoids flagging exact ties.
 */
function breaches(value: DivePlan | undefined, kinds: readonly string[] = ["ascent", "bailout", "stop"]): string[] {
  return (value?.segments ?? [])
    .filter((segment) => kinds.includes(segment.kind) && segment.ceilingDepthM > segment.endDepthM + 1e-6)
    .map((segment) => `${segment.kind} ${segment.startDepthM}->${segment.endDepthM} m at ${segment.startRuntimeSeconds} s: ceiling ${segment.ceilingDepthM.toFixed(3)} m (GF ${segment.gf.toFixed(3)})`);
}

describe("arrival ceiling re-check on open-circuit and legacy CCR legs (engine 0.2.1)", () => {
  it("stops a legacy CCR bailout onto Tx12/60 at 33 m, where the 60 m arrival clears GF low", () => {
    // Engine 0.1.0 and 0.2.0 rounded the 25.3 m bailout ceiling to 27 m and arrived under a
    // 29.08 m ceiling: after the switch from the air loop, the fastest compartment takes up
    // helium faster than it releases nitrogen during the ascent. The first stop was then held
    // under a 27.76 m ceiling. 30 m also fails on arrival; 33 m clears (31.20 m).
    const bailout = plan(ccr()).bailoutPlan!;
    expect(bailout.summary.firstStopDepthM).toBe(33);
    const firstLeg = bailout.segments.find((segment) => segment.kind === "bailout");
    expect([firstLeg?.startDepthM, firstLeg?.endDepthM]).toEqual([60, 33]);
    expect(firstLeg?.ceilingDepthM).toBeCloseTo(31.2, 1);
    expect(breaches(bailout)).toEqual([]);
  });

  it("holds a stop when the next leg would arrive above the ceiling", () => {
    // At 60 m the tissue state already permits 57 m, but helium is still loading; taken as soon
    // as permitted, the leg arrives under a 57.13 m ceiling, so the 60 m stop is held longer.
    const value = plan(ccr({
      depthM: meters(80),
      bottomTimeSeconds: seconds(20 * 60),
      settings: settings(0.2, 0.85),
      bailoutGases: [mix(12, 60, "bailout"), mix(21, 35, "bailout", { switchDepthM: meters(57) }), ean50Bailout, oxygenBailout],
    }));
    const bailout = value.bailoutPlan!;
    const leg = bailout.segments.find((segment) => segment.kind === "bailout" && segment.startDepthM === 60);
    expect(leg?.endDepthM).toBe(57);
    expect(leg!.ceilingDepthM).toBeLessThanOrEqual(57);
    expect(breaches(bailout)).toEqual([]);
  });

  it("keeps the current depth as the first stop when no shallower grid depth clears on arrival", () => {
    // The 63 m arrival ceiling (59.16 m) rounds to 60 m, but the 63->60 m leg arrives above the
    // ceiling, so the retry climbs back to 63 m and the first stop stays there.
    const bailout = plan(ccr({
      depthM: meters(75),
      bottomTimeSeconds: seconds(10 * 60),
      settings: settings(0.1, 0.9),
      bailoutGases: [mix(10, 70, "bailout"), mix(21, 35, "bailout", { switchDepthM: meters(57) }), ean50Bailout, oxygenBailout],
    })).bailoutPlan!;
    const firstLeg = bailout.segments.find((segment) => segment.kind === "bailout");
    expect([firstLeg?.startDepthM, firstLeg?.endDepthM]).toEqual([75, 63]);
    expect(Math.ceil(firstLeg!.ceilingDepthM / 3) * 3).toBe(60);
    expect(bailout.summary.firstStopDepthM).toBe(63);
    expect(breaches(bailout)).toEqual([]);
  });

  it("can shorten a schedule: a deeper first stop anchors the gradient-factor line deeper", () => {
    // Air at 40 m, then Tx30/30 from 36 m. Engine 0.2.0 took the 36->24 m leg and arrived 0.007 m
    // above the GF-low ceiling; its first stop was 24 m and time to surface 109.8 min. The first
    // stop is now 27 m, so every shallower stop uses a higher gradient factor and the plan
    // surfaces sooner. This is the documented consequence of Baker's anchoring, not a safety gain.
    const value = plan(oc({
      depthM: meters(40),
      bottomTimeSeconds: seconds(60 * 60),
      bottomGas: AIR,
      decoGases: [mix(30, 30, "deco", { switchDepthM: meters(36) }), { ...OXYGEN, switchDepthM: meters(6) }],
      settings: settings(0.2, 0.85),
    }));
    const leg = value.segments.find((segment) => segment.kind === "ascent" && segment.startDepthM === 36);
    expect(leg?.endDepthM).toBe(27);
    expect(value.summary.firstStopDepthM).toBe(27);
    expect(value.summary.ttsSeconds / 60).toBeCloseTo(103.45, 2);
    expect(breaches(value)).toEqual([]);
  });

  const ocBottoms: readonly [string, Gas, readonly number[]][] = [
    ["Tx10/70", mix(10, 70, "bottom"), [60, 75, 90, 100]],
    ["Tx12/60", mix(12, 60, "bottom"), [60, 75, 90]],
    ["Tx15/55", mix(15, 55, "bottom"), [45, 60, 75]],
    ["Tx18/45", mix(18, 45, "bottom"), [45, 60]],
  ];
  it.each(ocBottoms)("keeps every OC %s ascent leg and stop inside its ceiling", (_label, bottomGas, depths) => {
    const travelGas = bottomGas.oxygen < 0.16 ? mix(21, 35, "travel") : undefined;
    const decoSets = [[{ ...EAN50, switchDepthM: meters(21) }, { ...OXYGEN, switchDepthM: meters(6) }], [{ ...EAN50, switchDepthM: meters(21) }], []];
    const found: string[] = [];
    for (const conventionId of CONVENTIONS) for (const [gfLow, gfHigh] of GF_PAIRS) for (const depth of depths) for (const minutes of [10, 20, 30]) for (const decoGases of decoSets) {
      const value = plan(oc({
        depthM: meters(depth),
        bottomTimeSeconds: seconds(minutes * 60),
        bottomGas,
        ...(travelGas ? { travelGas } : {}),
        decoGases,
        settings: settings(gfLow, gfHigh, conventionId),
      }));
      found.push(...breaches(value).map((item) => `${conventionId} GF ${gfLow}/${gfHigh} ${depth} m ${minutes} min deco ${decoGases.length}: ${item}`));
    }
    expect(found).toEqual([]);
  });

  it("keeps every OC leg and stop inside its ceiling after a nitrogen bottom gas switches to Tx30/30", () => {
    const ean28: Gas = { id: "ean28", name: "EAN28", oxygen: fraction(0.28), helium: fraction(0), role: "bottom" };
    const bottoms: readonly [Gas, readonly number[]][] = [[AIR, [40, 45, 50]], [ean28, [40]]];
    const decoSets = [[mix(30, 30, "deco", { switchDepthM: meters(36) })], [mix(30, 30, "deco", { switchDepthM: meters(36) }), { ...OXYGEN, switchDepthM: meters(6) }]];
    const found: string[] = [];
    for (const conventionId of CONVENTIONS) for (const [gfLow, gfHigh] of GF_PAIRS) for (const [bottomGas, depths] of bottoms) for (const depth of depths) for (const minutes of [20, 40, 60]) for (const decoGases of decoSets) {
      const value = plan(oc({ depthM: meters(depth), bottomTimeSeconds: seconds(minutes * 60), bottomGas, decoGases, settings: settings(gfLow, gfHigh, conventionId) }));
      found.push(...breaches(value).map((item) => `${conventionId} GF ${gfLow}/${gfHigh} ${bottomGas.name} ${depth} m ${minutes} min deco ${decoGases.length}: ${item}`));
    }
    expect(found).toEqual([]);
  });

  const bailoutCases: readonly [string, Gas, Gas, readonly number[]][] = [
    ["air diluent, Tx10/70 bailout", airDiluent, mix(10, 70, "bailout"), [45, 60, 70]],
    ["air diluent, Tx12/60 bailout", airDiluent, mix(12, 60, "bailout"), [45, 60, 70]],
    ["air diluent, Tx15/55 bailout", airDiluent, mix(15, 55, "bailout"), [45, 60, 70]],
    ["air diluent, Tx18/45 bailout", airDiluent, mix(18, 45, "bailout"), [45, 60, 70]],
    ["Tx21/35 diluent, Tx10/70 bailout", trimixDiluent, mix(10, 70, "bailout"), [60, 80, 100]],
    ["Tx21/35 diluent, Tx12/60 bailout", trimixDiluent, mix(12, 60, "bailout"), [60, 80, 100]],
    ["Tx21/35 diluent, Tx15/55 bailout", trimixDiluent, mix(15, 55, "bailout"), [60, 80]],
  ];
  it.each(bailoutCases)("keeps every legacy CCR and bailout leg and stop inside its ceiling (%s)", (_label, diluent, bottomBailout, depths) => {
    const found: string[] = [];
    for (const conventionId of CONVENTIONS) for (const [gfLow, gfHigh] of GF_PAIRS) for (const depth of depths) for (const minutes of [10, 20, 30]) for (const withOxygen of [false, true]) {
      const bailoutGases = [
        bottomBailout,
        ...(bottomBailout.oxygen < 0.18 ? [mix(21, 35, "bailout", { switchDepthM: meters(Math.min(depth - 3, 57)) })] : []),
        ean50Bailout,
        ...(withOxygen ? [oxygenBailout] : []),
      ];
      const value = plan(ccr({
        depthM: meters(depth),
        bottomTimeSeconds: seconds(minutes * 60),
        diluent,
        bailoutGases,
        settings: settings(gfLow, gfHigh, conventionId),
      }));
      const label = `${conventionId} GF ${gfLow}/${gfHigh} ${depth} m ${minutes} min O2 ${withOxygen}`;
      found.push(...breaches(value).map((item) => `${label} loop: ${item}`));
      found.push(...breaches(value.bailoutPlan).map((item) => `${label} bailout: ${item}`));
    }
    expect(found).toEqual([]);
  });

  it("keeps every leg inside the ceiling after an air-loop bailout onto a lean trimix at 75-100 m", () => {
    const found: string[] = [];
    const loopPlanFailures: string[] = [];
    for (const [gfLow, gfHigh] of GF_PAIRS) for (const depth of [75, 80, 90, 100]) for (const minutes of [10, 20, 30]) for (const oxygen of [10, 12, 15]) {
      if (oxygen === 15 && depth > 80) continue;
      const label = `GF ${gfLow}/${gfHigh} ${depth} m ${minutes} min Tx${oxygen}`;
      const result = calculateDivePlan(ccr({
        depthM: meters(depth),
        bottomTimeSeconds: seconds(minutes * 60),
        settings: settings(gfLow, gfHigh),
        bailoutGases: [mix(oxygen, oxygen === 15 ? 55 : oxygen === 12 ? 60 : 70, "bailout"), mix(21, 35, "bailout", { switchDepthM: meters(57) }), ean50Bailout, oxygenBailout],
      }));
      if (!result.ok) {
        // Legacy CCR breathes open-circuit air diluent from the 6 m activation depth. The two
        // slowest compartments settle there above their GF 0.70 surfacing limit, so the loop plan
        // (not the bailout) never clears. Pre-existing since 0.1.0 and documented.
        expect(result.errors.map((item) => [item.code, item.message.startsWith("Bailout plan:")])).toEqual([["DECOMPRESSION_LIMIT_EXCEEDED", false]]);
        loopPlanFailures.push(label);
        continue;
      }
      found.push(...breaches(result.value, ["ascent", "bailout"]).map((item) => `${label} loop: ${item}`));
      found.push(...breaches(result.value.bailoutPlan, ["ascent", "bailout"]).map((item) => `${label} bailout: ${item}`));
    }
    expect(found).toEqual([]);
    expect(loopPlanFailures).toEqual([
      "GF 0.3/0.7 90 m 30 min Tx10",
      "GF 0.3/0.7 90 m 30 min Tx12",
      "GF 0.3/0.7 100 m 20 min Tx10",
      "GF 0.3/0.7 100 m 20 min Tx12",
      "GF 0.3/0.7 100 m 30 min Tx10",
      "GF 0.3/0.7 100 m 30 min Tx12",
    ]);
  });

  it("documents the remaining limitation: the ceiling can deepen past a stop while it is held", () => {
    // After switching a nitrogen-loaded air loop to Tx10/70, helium loads the fast compartments
    // faster than nitrogen leaves them, so the GF-low ceiling moves below the 60 m first stop
    // for 7 of the 16 minutes held (GF 0.230 reached against GF low 0.20). The arrival clears;
    // no ascent decision is involved. Covered in documentation/calculation-model.md and ROADMAP.
    const bailout = plan(ccr({
      depthM: meters(75),
      bottomTimeSeconds: seconds(30 * 60),
      settings: settings(0.2, 0.85),
      bailoutGases: [mix(10, 70, "bailout"), mix(21, 35, "bailout", { switchDepthM: meters(50) }), ean50Bailout],
    })).bailoutPlan!;
    expect(bailout.summary.firstStopDepthM).toBe(60);
    expect(breaches(bailout, ["ascent", "bailout"])).toEqual([]);
    const held = bailout.segments.filter((segment) => segment.kind === "stop" && segment.endDepthM === 60);
    const deepest = Math.max(...held.map((segment) => segment.ceilingDepthM));
    expect(deepest).toBeGreaterThan(60);
    expect(deepest).toBeCloseTo(61.49, 2);
  });
});
