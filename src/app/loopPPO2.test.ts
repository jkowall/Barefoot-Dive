import { describe, expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV, OXYGEN } from "../domain/defaults";
import type { CcrDiveInput, DivePlan, DivePlanInput, ProfileSegment } from "../domain/types";
import { barAbsolute, meters, seconds } from "../domain/units";
import { ambientLimitedSetpoint } from "../domain/validation";
import { calculateDivePlan } from "../engine/planner";
import { loopPPO2AtRuntime } from "./loopPPO2";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput } from "./planning";

function calculated(input: DivePlanInput): DivePlan {
  const result = calculateDivePlan(input);
  if (!result.ok) throw new Error(result.errors.map((item) => item.code).join(", "));
  return result.value;
}

const endOf = (segment: ProfileSegment) => segment.startRuntimeSeconds + segment.durationSeconds;

describe("loopPPO2AtRuntime", () => {
  const input = resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, mode: "ccr" }, []).input!;
  const plan = calculated(input);
  const environment = input.environmentSettings;
  const surfaceMax = environment.surfacePressureBar - environment.waterVaporPressureBar;
  const finalAscent = plan.segments.filter((segment) => segment.durationSeconds > 0 && segment.endDepthM === 0).at(-1)!;

  it("follows the depth limit through the default draft's final ascent", () => {
    expect(finalAscent.heldSetpointBar).toBe(1.3);
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds, input)).toBeCloseTo(1.3, 9);
    expect(loopPPO2AtRuntime(finalAscent, endOf(finalAscent), input)).toBeCloseTo(surfaceMax, 9);
    const midDepthM = finalAscent.startDepthM / 2;
    const midAmbient = environment.surfacePressureBar + midDepthM / environment.metersPerBar;
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds + finalAscent.durationSeconds / 2, input))
      .toBeCloseTo(midAmbient - environment.waterVaporPressureBar, 9);
  });

  it("matches the held setpoint limited by ambient pressure at both ends of every loop segment with a diluent that carries inert gas", () => {
    for (const segment of plan.segments.filter((item) => item.heldSetpointBar !== undefined)) {
      expect(loopPPO2AtRuntime(segment, segment.startRuntimeSeconds, input))
        .toBeCloseTo(ambientLimitedSetpoint(segment.heldSetpointBar!, segment.startDepthM, environment), 9);
      expect(loopPPO2AtRuntime(segment, endOf(segment), input))
        .toBeCloseTo(ambientLimitedSetpoint(segment.heldSetpointBar!, segment.endDepthM, environment), 9);
    }
  });

  it("reads oxygen at ambient pressure with a pure-oxygen diluent, as the tissue model breathes it", () => {
    const oxygenLoop: CcrDiveInput = {
      mode: "ccr",
      environment: "open-water",
      depthM: meters(6),
      bottomTimeSeconds: seconds(20 * 60),
      diluent: { ...OXYGEN, id: "o2-dil", name: "Oxygen diluent", role: "diluent" },
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      lowSetpointBar: barAbsolute(0.7),
      ascentSetpointMode: "ambient-limited-high",
      bailoutGases: [{ ...AIR, id: "bo", role: "bailout" }],
      cylinders: [],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const oxygenPlan = calculated(oxygenLoop);
    expect(oxygenPlan.diagnostics.map((item) => item.code)).toContain("CCR_DILUENT_PPO2_ABOVE_SETPOINT");
    const bottom = oxygenPlan.segments.find((segment) => segment.kind === "bottom")!;
    expect(bottom.heldSetpointBar).toBe(1.3);
    // 1.6 bar ambient at 6 m less 0.0627 bar water vapor, not the 1.30 bar held setpoint.
    const atDepth = DEFAULT_ENVIRONMENT.surfacePressureBar + 6 / DEFAULT_ENVIRONMENT.metersPerBar - DEFAULT_ENVIRONMENT.waterVaporPressureBar;
    expect(loopPPO2AtRuntime(bottom, bottom.startRuntimeSeconds + 60, oxygenLoop)).toBeCloseTo(atDepth, 9);
    expect(loopPPO2AtRuntime(bottom, bottom.startRuntimeSeconds + 60, oxygenLoop)).toBeGreaterThan(1.53);
  });

  it("clamps runtimes outside the segment to its ends", () => {
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds - 60, input)).toBeCloseTo(1.3, 9);
    expect(loopPPO2AtRuntime(finalAscent, endOf(finalAscent) + 60, input)).toBeCloseTo(surfaceMax, 9);
  });

  it("reads an instantaneous segment at its end depth", () => {
    const zeroDuration = plan.segments.find((segment) => segment.durationSeconds === 0 && segment.heldSetpointBar !== undefined)!;
    expect(loopPPO2AtRuntime(zeroDuration, zeroDuration.startRuntimeSeconds, input))
      .toBeCloseTo(ambientLimitedSetpoint(zeroDuration.heldSetpointBar!, zeroDuration.endDepthM, environment), 9);
  });

  it("returns nothing for open circuit and for a loop segment saved without a held setpoint", () => {
    const openCircuit = plan.bailoutPlan!.segments.find((segment) => segment.setpointBar === undefined)!;
    expect(loopPPO2AtRuntime(openCircuit, openCircuit.startRuntimeSeconds, input)).toBeUndefined();
    const { heldSetpointBar: held, ...older } = finalAscent;
    expect(held).toBe(1.3);
    expect(loopPPO2AtRuntime(older as ProfileSegment, endOf(finalAscent), input)).toBeUndefined();
  });

  it("uses the plan's diluent on every loop segment", () => {
    for (const item of [plan, plan.bailoutPlan!]) {
      for (const segment of item.segments.filter((entry) => entry.heldSetpointBar !== undefined)) {
        expect(segment.gasId).toBe(input.mode === "ccr" ? input.diluent.id : undefined);
      }
    }
  });
});
