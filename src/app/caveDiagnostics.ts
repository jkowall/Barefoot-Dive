import type { CavePlanResult } from "../cave";
import type { Diagnostic } from "../domain/types";

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
