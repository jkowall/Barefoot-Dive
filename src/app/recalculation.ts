import { calculateCavePlan } from "../cave";
import { calculateDivePlan } from "../engine/planner";
import type { SavedPlanDraft, SavedPlanRecord } from "../storage";
import { collectCaveDiagnostics } from "./caveDiagnostics";

/**
 * Recalculate a saved plan from its stored normalized input, exactly as stored. Inputs are
 * never normalized or defaulted here, so records saved before a field existed keep the
 * behavior their absence implies (for example, legacy CCR breathing without a low setpoint).
 * The caller stores the result as a new revision; the historical record is not modified.
 */
export function buildRecalculation(record: SavedPlanRecord, reportError: (message: string) => void): SavedPlanDraft | undefined {
  if (record.caveInputSnapshot) {
    const calculated = calculateCavePlan(record.caveInputSnapshot);
    if (!calculated.ok) {
      reportError(calculated.errors.map((item) => `${item.message} (${item.code})`).join(" "));
      return undefined;
    }
    return {
      title: record.title,
      normalizedInputSnapshot: record.caveInputSnapshot.dive,
      calculatedPlan: calculated.value.base,
      caveInputSnapshot: record.caveInputSnapshot,
      caveResultSnapshot: calculated.value,
      warnings: collectCaveDiagnostics(
        [...calculated.warnings, ...(calculated.errors ?? [])],
        calculated.value,
      ),
    };
  }
  const calculated = calculateDivePlan(record.normalizedInputSnapshot);
  if (!calculated.ok) {
    reportError(calculated.errors.map((item) => `${item.message} (${item.code})`).join(" "));
    return undefined;
  }
  return {
    title: record.title,
    normalizedInputSnapshot: record.normalizedInputSnapshot,
    calculatedPlan: calculated.value,
    warnings: [...calculated.warnings, ...(calculated.errors ?? [])],
  };
}
