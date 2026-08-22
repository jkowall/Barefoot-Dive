import type { StorageLike, StorageResult, TankRecord, SavedPlanRecord } from "./types";
import { clone, diagnostic, isFiniteNumber, isObject, readJson, writeJson } from "./codec";
import { STORAGE_SCHEMA_VERSION } from "./types";

type Envelope<T> = { readonly schemaVersion: number; readonly records: readonly T[] };
const isString = (v: unknown): v is string => typeof v === "string";

export function isCylinder(value: unknown): value is TankRecord {
  if (!isObject(value) || !isString(value.id) || !isString(value.name) || !isString(value.createdAt) || !isString(value.updatedAt)) return false;
  return isFiniteNumber(value.waterVolumeL) && isFiniteNumber(value.workingPressureBar) && isFiniteNumber(value.currentPressureBar) && isFiniteNumber(value.maximumPPO2) && isFiniteNumber(value.revision) && isObject(value.gas);
}
export function isSavedPlan(value: unknown): value is SavedPlanRecord {
  if (!isObject(value) || !isString(value.id) || !isString(value.title) || !isString(value.createdAt) || !isString(value.updatedAt) || !isString(value.lineageId) || !isString(value.engineVersion) || !isString(value.conventionId) || !isString(value.conventionVersion)) return false;
  return typeof value.archived === "boolean" && isFiniteNumber(value.revision) && Array.isArray(value.resolvedCylinderSnapshots) && Array.isArray(value.resolvedGasSnapshots) && isObject(value.normalizedInputSnapshot) && isObject(value.calculatedPlan) && Array.isArray(value.warnings) && (value.caveInputSnapshot === undefined || isObject(value.caveInputSnapshot)) && (value.caveResultSnapshot === undefined || isObject(value.caveResultSnapshot));
}
function envelope<T>(value: unknown, validate: (v: unknown) => v is T): Envelope<T> | undefined {
  if (!isObject(value) || !isFiniteNumber(value.schemaVersion) || !Array.isArray(value.records)) return undefined;
  if (value.schemaVersion === STORAGE_SCHEMA_VERSION && value.records.every(validate)) return { schemaVersion: STORAGE_SCHEMA_VERSION, records: value.records };
  return undefined;
}
function migrate<T>(value: unknown, validate: (v: unknown) => v is T): Envelope<T> | undefined {
  if (Array.isArray(value) && value.every(validate)) return { schemaVersion: STORAGE_SCHEMA_VERSION, records: value };
  return envelope(value, validate);
}
export function readEnvelope<T>(storage: StorageLike, key: string, validate: (v: unknown) => v is T): StorageResult<Envelope<T>> {
  const result = readJson(storage, key, (value): value is Envelope<T> => migrate(value, validate) !== undefined);
  if (!result.ok) return result;
  if (result.value === undefined) return { ok: true, value: { schemaVersion: STORAGE_SCHEMA_VERSION, records: [] }, diagnostics: [] };
  const migrated = migrate(result.value, validate);
  if (!migrated) { const error = diagnostic("STORAGE_INVALID", key, "Stored schema version is unsupported or records are invalid."); return { ok: false, error, diagnostics: [error] }; }
  return { ok: true, value: migrated, diagnostics: [] };
}
export function writeEnvelope<T>(storage: StorageLike, key: string, records: readonly T[]): StorageResult<Envelope<T>> {
  const value: Envelope<T> = { schemaVersion: STORAGE_SCHEMA_VERSION, records: clone(records) };
  return writeJson(storage, key, value);
}
