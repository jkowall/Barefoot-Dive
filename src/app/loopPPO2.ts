import type { BarAbsolute, EnvironmentSettings, ProfileSegment } from "../domain/types";
import { ambientLimitedSetpoint } from "../domain/validation";

/**
 * CCR loop PPO₂ at a runtime inside a segment: the held setpoint, limited by ambient pressure at
 * the planned depth there. Depth moves linearly with runtime inside a segment, as the profile draws
 * it. Undefined for open circuit and for segments saved before plans recorded the held setpoint.
 */
export function loopPPO2AtRuntime(
  segment: ProfileSegment,
  runtimeSeconds: number,
  environment: EnvironmentSettings,
): BarAbsolute | undefined {
  if (segment.heldSetpointBar === undefined) return undefined;
  const fraction = segment.durationSeconds > 0
    ? Math.min(1, Math.max(0, (runtimeSeconds - segment.startRuntimeSeconds) / segment.durationSeconds))
    : 1;
  const depthM = segment.startDepthM + (segment.endDepthM - segment.startDepthM) * fraction;
  return ambientLimitedSetpoint(segment.heldSetpointBar, depthM, environment);
}
