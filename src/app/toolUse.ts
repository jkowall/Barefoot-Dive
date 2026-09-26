import type { TankRecord } from "../storage";
import { formatSurfaceGasRate, type UnitPreferences } from "./helpers";
import { DEFAULT_PLAN_DRAFT, type PlanDraft } from "./planning";

export type RmvPlanTarget =
  | "bottomRmvLpm"
  | "decoRmvLpm"
  | "bailoutRmvLpm"
  | "bailoutDecoRmvLpm";

export type ToolPlanPatch =
  | {
      readonly kind: "best-mix";
      readonly name: string;
      readonly oxygenPercent: number;
      readonly heliumPercent: number;
      /** Resolved by App from the current Tank Bank snapshot. */
      readonly preserveCylinderId?: string;
    }
  | {
      readonly kind: "rmv";
      readonly target: RmvPlanTarget;
      readonly valueLpm: number;
    }
  | {
      readonly kind: "rock-bottom";
      readonly teamSize: number;
      readonly stressedRmvLpm: number;
    };

export function toolPlanPatchError(currentDraft: PlanDraft, patch: ToolPlanPatch): string | undefined {
  switch (patch.kind) {
    case "best-mix":
      if (currentDraft.mode !== "oc") return "Best Mix can only update an open-circuit bottom gas.";
      if (
        !Number.isFinite(patch.oxygenPercent)
        || !Number.isFinite(patch.heliumPercent)
        || patch.oxygenPercent < 0
        || patch.heliumPercent < 0
        || patch.oxygenPercent + patch.heliumPercent > 100
      ) return "Best Mix produced invalid gas fractions and cannot be applied.";
      return undefined;
    case "rmv": {
      const allowed = currentDraft.mode === "oc"
        ? patch.target === "bottomRmvLpm" || patch.target === "decoRmvLpm"
        : patch.target === "bailoutRmvLpm" || patch.target === "bailoutDecoRmvLpm";
      if (!allowed) return "That SAC/RMV target does not apply to the current breathing mode.";
      return Number.isFinite(patch.valueLpm) && patch.valueLpm > 0
        ? undefined
        : "SAC/RMV must be finite and greater than zero.";
    }
    case "rock-bottom":
      if (currentDraft.mode !== "oc") return "Rock-bottom assumptions can only update an open-circuit plan.";
      if (!Number.isInteger(patch.teamSize) || patch.teamSize < 1) return "Team size must be a positive integer.";
      return Number.isFinite(patch.stressedRmvLpm) && patch.stressedRmvLpm > 0
        ? undefined
        : "Stressed SAC/RMV must be finite and greater than zero.";
  }
}

export function draftFromCylinder(record: TankRecord): PlanDraft {
  return {
    ...structuredClone(DEFAULT_PLAN_DRAFT),
    bottomGas: {
      ...DEFAULT_PLAN_DRAFT.bottomGas,
      name: record.gas.name,
      oxygenPercent: record.gas.oxygen * 100,
      heliumPercent: record.gas.helium * 100,
      cylinderId: record.id,
    },
  };
}

/** Applies only the fields represented by a reviewed Tools handoff. */
export function applyToolPlanPatch(currentDraft: PlanDraft, patch: ToolPlanPatch): PlanDraft {
  switch (patch.kind) {
    case "best-mix":
      return {
        ...currentDraft,
        bottomGas: {
          ...currentDraft.bottomGas,
          name: patch.name,
          oxygenPercent: patch.oxygenPercent,
          heliumPercent: patch.heliumPercent,
          cylinderId: patch.preserveCylinderId,
        },
      };
    case "rmv":
      return { ...currentDraft, [patch.target]: patch.valueLpm };
    case "rock-bottom":
      return {
        ...currentDraft,
        reserve: {
          kind: "rock-bottom",
          teamSize: patch.teamSize,
          stressedRmvLpm: patch.stressedRmvLpm,
        },
      };
  }
}

const gasLabel = (name: string, oxygenPercent: number, heliumPercent: number) =>
  `${name} (O₂ ${oxygenPercent.toFixed(1)}%, He ${heliumPercent.toFixed(1)}%)`;

const rmvLabel: Record<RmvPlanTarget, string> = {
  bottomRmvLpm: "Bottom SAC/RMV",
  decoRmvLpm: "Deco SAC/RMV",
  bailoutRmvLpm: "Bailout SAC/RMV",
  bailoutDecoRmvLpm: "Bailout deco SAC/RMV",
};

export function describeToolPlanPatch(
  currentDraft: PlanDraft,
  patch: ToolPlanPatch,
  capacityUnits: UnitPreferences["cylinderCapacity"],
): string {
  switch (patch.kind) {
    case "best-mix": {
      const before = gasLabel(
        currentDraft.bottomGas.name,
        currentDraft.bottomGas.oxygenPercent,
        currentDraft.bottomGas.heliumPercent,
      );
      const after = gasLabel(patch.name, patch.oxygenPercent, patch.heliumPercent);
      const cylinder = currentDraft.bottomGas.cylinderId && !patch.preserveCylinderId
        ? " The current Tank Bank cylinder assignment will be cleared because its gas does not exactly match or the cylinder is unavailable; the bottom gas then uses the ad hoc cylinder values shown in Plan Setup."
        : "";
      return `Bottom gas: ${before} → ${after}.${cylinder} No other plan fields will change.`;
    }
    case "rmv":
      return `${rmvLabel[patch.target]}: ${formatSurfaceGasRate(currentDraft[patch.target], capacityUnits)} → ${formatSurfaceGasRate(patch.valueLpm, capacityUnits)}. No other plan fields will change.`;
    case "rock-bottom": {
      const before = currentDraft.reserve.kind === "rock-bottom"
        ? `team ${currentDraft.reserve.teamSize}, ${formatSurfaceGasRate(currentDraft.reserve.stressedRmvLpm, capacityUnits)} stressed SAC/RMV`
        : currentDraft.reserve.kind;
      return `Reserve policy: ${before} → rock bottom, team ${patch.teamSize}, ${formatSurfaceGasRate(patch.stressedRmvLpm, capacityUnits)} stressed SAC/RMV. The entered emergency segments and calculated pressure are not copied.`;
    }
  }
}
