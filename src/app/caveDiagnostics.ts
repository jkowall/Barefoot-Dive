import type { CavePlanResult } from "../cave";
import type { Diagnostic, DivePlanInput } from "../domain/types";
import { ocBottomSwitchDepth, switchDownDepth } from "../domain/validation";
import type { RouteDraft } from "./caveWorkspace";
import { formatDepth, formatDepthBound, formatDuration, type UnitPreferences } from "./helpers";

function diagnosticKey(item: Diagnostic): string {
  return [item.code, item.severity, item.message, item.field ?? "", item.cylinderId ?? "", item.gasId ?? ""].join("|");
}

/**
 * Flatten route-level and nested scenario diagnostics for display/persistence.
 * This also makes older snapshots with nested-only scenario failures reopen as
 * unsafe without requiring a storage migration.
 */
export function collectCaveDiagnostics(
  topLevel: readonly Diagnostic[],
  result: CavePlanResult,
): readonly Diagnostic[] {
  const nested = result.scenarios.flatMap((scenario, index): readonly Diagnostic[] => {
    const label = scenario.kind.replaceAll("-", " ");
    const diagnostics = scenario.diagnostics.map((item): Diagnostic => ({
      ...item,
      message: `${label}: ${item.message}`,
      field: item.field ? `scenarios.${index}.${item.field}` : `scenarios.${index}`,
    }));
    return !scenario.safe && !diagnostics.some((item) => item.severity === "error")
      ? [...diagnostics, {
          code: "CAVE_SCENARIO_UNSAFE",
          severity: "error",
          message: `${label}: the scenario did not produce a sufficient plan.`,
          field: `scenarios.${index}`,
        }]
      : diagnostics;
  });
  const unique = new Map<string, Diagnostic>();
  for (const item of [...topLevel, ...nested]) unique.set(diagnosticKey(item), item);
  return [...unique.values()];
}

type CaveCeilingContext = {
  readonly route: readonly RouteDraft[];
  readonly dive: DivePlanInput;
  readonly units: UnitPreferences["depth"];
};

const sameDepth = (left: number, right: number): boolean => Math.abs(left - right) <= 1e-6;

/**
 * Replaces an engine event-index ceiling diagnostic only while the current Cave
 * route is being corrected. Saved or scenario diagnostics retain their original
 * context and wording.
 */
export function formatCaveCeilingViolation(
  diagnostic: Diagnostic,
  context: CaveCeilingContext,
): string | undefined {
  if (
    diagnostic.code !== "EXPOSURE_CEILING_VIOLATION" ||
    diagnostic.depthM === undefined ||
    diagnostic.limit === undefined ||
    diagnostic.runtimeSeconds === undefined
  ) return undefined;

  const splitDepths = context.dive.mode === "oc"
    ? context.dive.travelGas ? [ocBottomSwitchDepth(context.dive)] : []
    : [context.dive.setpointActivationDepthM, switchDownDepth(context.dive)];
  const matchingLegs = context.route.filter((leg) => {
    const exitEndDepth = leg.endDepthM < leg.startDepthM
      ? leg.endDepthM
      : leg.endDepthM > leg.startDepthM
        ? leg.startDepthM
        : undefined;
    return exitEndDepth !== undefined && sameDepth(exitEndDepth, diagnostic.depthM!);
  });
  const depth = formatDepth(diagnostic.depthM, context.units);
  const runtime = formatDuration(diagnostic.runtimeSeconds);
  const ceiling = formatDepthBound(diagnostic.limit, context.units, "lower");
  const ambiguous = matchingLegs.length !== 1 || splitDepths.some((splitDepth) => sameDepth(splitDepth, diagnostic.depthM!));
  if (ambiguous) {
    return `An explicit route leg ends at ${depth} at ${runtime}, above the ${ceiling} decompression ceiling there.`;
  }
  const label = matchingLegs[0]!.id.trim();
  return label
    ? `The exit of leg “${label}” ends at ${depth} at ${runtime}, above the ${ceiling} decompression ceiling there.`
    : `An explicit route leg ends at ${depth} at ${runtime}, above the ${ceiling} decompression ceiling there.`;
}
