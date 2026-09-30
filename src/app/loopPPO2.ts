import type { BarAbsolute, DivePlanInput, ProfileSegment } from "../domain/types";
import { depthToAmbientPressure, meters } from "../domain/units";
import { loopPPO2 } from "../engine/tissues";

/**
 * CCR loop PPO₂ at a runtime inside a segment: what the tissue model breathes on the segment's
 * held setpoint with the plan's diluent at the planned depth there, min(held, ambient − water
 * vapor), or oxygen at ambient pressure with a pure-oxygen diluent. Depth moves linearly with
 * runtime inside a segment, as the profile draws it. Undefined for open circuit and for segments
 * saved before plans recorded the held setpoint.
 */
export function loopPPO2AtRuntime(
  segment: ProfileSegment,
  runtimeSeconds: number,
  input: DivePlanInput,
): BarAbsolute | undefined {
  if (segment.heldSetpointBar === undefined || input.mode !== "ccr") return undefined;
  const fraction = segment.durationSeconds > 0
    ? Math.min(1, Math.max(0, (runtimeSeconds - segment.startRuntimeSeconds) / segment.durationSeconds))
    : 1;
  const depthM = meters(segment.startDepthM + (segment.endDepthM - segment.startDepthM) * fraction);
  const { surfacePressureBar, metersPerBar } = input.environmentSettings;
  return loopPPO2(
    { kind: "ccr", diluent: input.diluent, setpointBar: segment.heldSetpointBar },
    depthToAmbientPressure(depthM, surfacePressureBar, metersPerBar),
    input.environmentSettings,
  );
}
