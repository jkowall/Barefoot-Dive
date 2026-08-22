import type { Cylinder, Diagnostic, DivePlan, DivePlanInput, Gas } from "../domain/types";
import type { CavePlanInput, CavePlanResult } from "../cave";

export const STORAGE_SCHEMA_VERSION = 1 as const;
export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type Clock = () => string;
export type IdGenerator = (kind: "cylinder" | "plan") => string;
export type StorageDiagnostic = {
  readonly code: "STORAGE_UNAVAILABLE" | "STORAGE_QUOTA" | "STORAGE_CORRUPT" | "STORAGE_INVALID";
  readonly message: string;
  readonly key: string;
  readonly cause?: unknown;
};
export type StorageResult<T> =
  | { readonly ok: true; readonly value: T; readonly diagnostics: readonly StorageDiagnostic[] }
  | { readonly ok: false; readonly error: StorageDiagnostic; readonly diagnostics: readonly StorageDiagnostic[] };
export type TankDraft = Omit<Cylinder, "id" | "revision" | "archived"> & { readonly archived?: boolean };
export type TankRecord = Cylinder & { readonly createdAt: string; readonly updatedAt: string; readonly archivedAt?: string };
export type SavedPlanRecord = {
  readonly id: string; readonly title: string; readonly createdAt: string; readonly updatedAt: string;
  readonly archived: boolean; readonly archivedAt?: string; readonly revision: number; readonly lineageId: string;
  readonly parentRevisionId?: string; readonly normalizedInputSnapshot: DivePlanInput;
  readonly resolvedCylinderSnapshots: readonly Cylinder[]; readonly resolvedGasSnapshots: readonly Gas[];
  readonly calculatedPlan: DivePlan; readonly engineVersion: string; readonly conventionId: string;
  readonly conventionVersion: string; readonly warnings: readonly Diagnostic[];
  /** Complete immutable cave context when this record represents a cave plan. */
  readonly caveInputSnapshot?: CavePlanInput;
  readonly caveResultSnapshot?: CavePlanResult;
};
export type SavedPlanDraft = {
  readonly title: string; readonly normalizedInputSnapshot: DivePlanInput; readonly calculatedPlan: DivePlan;
  readonly warnings?: readonly Diagnostic[];
  readonly caveInputSnapshot?: CavePlanInput;
  readonly caveResultSnapshot?: CavePlanResult;
};
export type StorageOptions = { readonly storage: StorageLike; readonly clock?: Clock; readonly idGenerator?: IdGenerator };
