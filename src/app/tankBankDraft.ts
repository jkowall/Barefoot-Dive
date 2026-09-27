import { calculateMOD } from "../calculations";
import { DEFAULT_ENVIRONMENT } from "../domain/defaults";
import type { CylinderRole, Gas } from "../domain/types";
import { barAbsolute, barGauge, depthToAmbientPressure, fraction, liters, meters } from "../domain/units";
import { isAboveMaximumPPO2 } from "../domain/validation";
import type { TankDraft, TankRecord } from "../storage/types";

/** Form state for the Tank Bank create/edit panel. */
export type TankBankDraftState = {
  name: string;
  waterVolumeL: number;
  workingPressureBar: number;
  currentPressureBar: number;
  minimumPressureBar: number;
  oxygen: number;
  helium: number;
  maximumPPO2: number;
  role: CylinderRole;
  gasName: string;
  /** Metres; only meaningful for deco and bailout roles. Blank means unset. */
  switchDepthM?: number;
};

export const TANK_BANK_ROLES: readonly CylinderRole[] = [
  "bottom",
  "travel",
  "deco",
  "bailout",
  "diluent",
  "stage",
];

export const EMPTY_TANK_BANK_DRAFT: TankBankDraftState = {
  name: "New cylinder",
  waterVolumeL: 24,
  workingPressureBar: 232,
  currentPressureBar: 232,
  minimumPressureBar: 35,
  oxygen: 21,
  helium: 0,
  maximumPPO2: 1.6,
  role: "bottom",
  gasName: "Air",
};

export function roleStoresSwitchDepth(role: CylinderRole): boolean {
  return role === "deco" || role === "bailout";
}

/** MOD depth in metres for the draft mix and max PPO₂, or undefined when the MOD cannot be calculated. */
export function tankBankDraftModM(draft: Pick<TankBankDraftState, "oxygen" | "maximumPPO2">): number | undefined {
  const result = calculateMOD({
    oxygen: fraction(draft.oxygen / 100),
    maximumPPO2: barAbsolute(draft.maximumPPO2),
    ...DEFAULT_ENVIRONMENT,
  });
  return result.ok ? result.value.depthM : undefined;
}

/**
 * The switch depth "Use MOD" fills in: the deepest 0.1 m step at or shallower than the MOD whose
 * PPO₂, computed as the planner computes it, does not exceed the maximum (same 1e-8 bar tolerance).
 * The raw MOD can land a hair past the maximum after floating-point rounding; Oxygen at 1.6 bar
 * stays on its 6 m stop. Uses a binary search so a tiny but valid oxygen fraction cannot freeze
 * the form by walking millions of 0.1 m steps.
 */
export function modSwitchDepthM(draft: Pick<TankBankDraftState, "oxygen" | "maximumPPO2">): number | undefined {
  const modM = tankBankDraftModM(draft);
  if (modM === undefined) return undefined;
  const oxygen = fraction(draft.oxygen / 100);
  const accepts = (depthM: number) =>
    !isAboveMaximumPPO2(
      oxygen *
        depthToAmbientPressure(
          meters(depthM),
          DEFAULT_ENVIRONMENT.surfacePressureBar,
          DEFAULT_ENVIRONMENT.metersPerBar,
        ),
      draft.maximumPPO2,
    );
  let lo = 0;
  let hi = Math.floor(modM * 10 + 1e-9);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (accepts(mid / 10)) lo = mid;
    else hi = mid - 1;
  }
  return lo / 10;
}

export function draftStateFromRecord(record: TankRecord): TankBankDraftState {
  const role = record.role ?? record.gas.role;
  return {
    name: record.name,
    waterVolumeL: record.waterVolumeL,
    workingPressureBar: record.workingPressureBar,
    currentPressureBar: record.currentPressureBar,
    minimumPressureBar: record.minimumPressureBar ?? 0,
    oxygen: record.gas.oxygen * 100,
    helium: record.gas.helium * 100,
    maximumPPO2: record.maximumPPO2,
    role,
    gasName: record.gas.name,
    ...(roleStoresSwitchDepth(role) && record.gas.switchDepthM !== undefined
      ? { switchDepthM: record.gas.switchDepthM }
      : {}),
  };
}

/**
 * Maps the Tank Bank form into a storage draft. Deco and bailout records store
 * `gas.switchDepthM` when set; any other role strips a stored switch depth.
 */
export function toTankDraft(draft: TankBankDraftState, source?: TankRecord): TankDraft {
  const gasRole = draft.role === "stage" ? "bottom" : draft.role;
  const switchDepth = roleStoresSwitchDepth(draft.role) && draft.switchDepthM !== undefined
    ? { switchDepthM: meters(draft.switchDepthM) }
    : {};
  const gas: Gas = {
    id:
      source?.gas.id ??
      (draft.gasName
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-") ||
        "gas"),
    name: draft.gasName.trim() || "Unnamed gas",
    oxygen: fraction(draft.oxygen / 100),
    helium: fraction(draft.helium / 100),
    role: gasRole,
    ...switchDepth,
  };
  return {
    name: draft.name.trim(),
    waterVolumeL: liters(draft.waterVolumeL),
    workingPressureBar: barGauge(draft.workingPressureBar),
    currentPressureBar: barGauge(draft.currentPressureBar),
    minimumPressureBar: barGauge(draft.minimumPressureBar),
    maximumPPO2: barAbsolute(draft.maximumPPO2),
    role: draft.role,
    gas,
  };
}

export function validateTankBankDraft(draft: TankBankDraftState): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push("Cylinder name is required.");
  if (!draft.gasName.trim()) errors.push("Gas name is required.");
  if (!Number.isFinite(draft.waterVolumeL) || draft.waterVolumeL <= 0)
    errors.push("Water volume must be greater than zero.");
  if (
    !Number.isFinite(draft.workingPressureBar) ||
    draft.workingPressureBar <= 0
  )
    errors.push("Working pressure must be greater than zero.");
  if (
    !Number.isFinite(draft.currentPressureBar) ||
    draft.currentPressureBar < 0 ||
    draft.currentPressureBar > draft.workingPressureBar
  )
    errors.push("Current pressure must be between zero and working pressure.");
  if (
    !Number.isFinite(draft.minimumPressureBar) ||
    draft.minimumPressureBar < 0 ||
    draft.minimumPressureBar > draft.currentPressureBar
  )
    errors.push("Minimum pressure must be between zero and current pressure.");
  if (!Number.isFinite(draft.oxygen) || draft.oxygen <= 0 || draft.oxygen > 100)
    errors.push("O₂ must be greater than 0% and at most 100%.");
  if (
    !Number.isFinite(draft.helium) ||
    draft.helium < 0 ||
    draft.helium > 100 ||
    draft.oxygen + draft.helium > 100
  )
    errors.push("O₂ and He must be valid fractions totaling at most 100%.");
  if (!Number.isFinite(draft.maximumPPO2) || draft.maximumPPO2 <= 0)
    errors.push("Maximum PPO₂ must be greater than zero.");
  if (roleStoresSwitchDepth(draft.role) && draft.switchDepthM !== undefined) {
    if (!Number.isFinite(draft.switchDepthM) || draft.switchDepthM < 0) {
      errors.push("Switch depth must be zero or deeper.");
    } else {
      const modM = tankBankDraftModM(draft);
      // A stored switch depth must be checkable against MOD; never keep one when MOD cannot be calculated.
      if (modM === undefined) {
        errors.push("Switch depth cannot be validated without a calculable MOD at this maximum PPO₂.");
      } else if (draft.switchDepthM > modM + 1e-9) {
        errors.push("Switch depth must not be deeper than the MOD at this maximum PPO₂.");
      }
    }
  }
  return errors;
}
