import { describe, expect, it } from "vitest";
import type { DivePlan, EnvironmentSettings, ProfileSegment } from "../domain/types";
import { calculateDivePlan } from "../engine/planner";
import { loopPPO2AtRuntime } from "./loopPPO2";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput } from "./planning";

function ccrDefault(): { plan: DivePlan; environment: EnvironmentSettings } {
  const input = resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, mode: "ccr" }, []).input!;
  const result = calculateDivePlan(input);
  if (!result.ok) throw new Error(result.errors.map((item) => item.code).join(", "));
  return { plan: result.value, environment: input.environmentSettings };
}

describe("loopPPO2AtRuntime", () => {
  const { plan, environment } = ccrDefault();
  const surfaceMax = environment.surfacePressureBar - environment.waterVaporPressureBar;
  const finalAscent = plan.segments.filter((segment) => segment.durationSeconds > 0 && segment.endDepthM === 0).at(-1)!;
  const end = finalAscent.startRuntimeSeconds + finalAscent.durationSeconds;

  it("follows the depth limit through the default draft's final ascent", () => {
    expect(finalAscent.heldSetpointBar).toBe(1.3);
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds, environment)).toBeCloseTo(1.3, 9);
    expect(loopPPO2AtRuntime(finalAscent, end, environment)).toBeCloseTo(surfaceMax, 9);
    const midDepthM = finalAscent.startDepthM / 2;
    const midAmbient = environment.surfacePressureBar + midDepthM / environment.metersPerBar;
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds + finalAscent.durationSeconds / 2, environment))
      .toBeCloseTo(midAmbient - environment.waterVaporPressureBar, 9);
  });

  it("clamps runtimes outside the segment to its ends", () => {
    expect(loopPPO2AtRuntime(finalAscent, finalAscent.startRuntimeSeconds - 60, environment)).toBeCloseTo(1.3, 9);
    expect(loopPPO2AtRuntime(finalAscent, end + 60, environment)).toBeCloseTo(surfaceMax, 9);
  });

  it("reads an instantaneous segment at its end depth", () => {
    const zeroDuration = plan.segments.find((segment) => segment.durationSeconds === 0 && segment.heldSetpointBar !== undefined)!;
    expect(loopPPO2AtRuntime(zeroDuration, zeroDuration.startRuntimeSeconds, environment))
      .toBe(Math.min(zeroDuration.heldSetpointBar!, environment.surfacePressureBar + zeroDuration.endDepthM / environment.metersPerBar - environment.waterVaporPressureBar));
  });

  it("returns nothing for open circuit and for a loop segment saved without a held setpoint", () => {
    const openCircuit = plan.bailoutPlan!.segments.find((segment) => segment.setpointBar === undefined)!;
    expect(loopPPO2AtRuntime(openCircuit, openCircuit.startRuntimeSeconds, environment)).toBeUndefined();
    const { heldSetpointBar: _held, ...older } = finalAscent;
    expect(_held).toBe(1.3);
    expect(loopPPO2AtRuntime(older as ProfileSegment, end, environment)).toBeUndefined();
  });
});
