import type { StorageDiagnostic, StorageLike, StorageResult } from "./types";

export function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}
export function diagnostic(code: StorageDiagnostic["code"], key: string, message: string, cause?: unknown): StorageDiagnostic { return { code, key, message, cause }; }
/** The stored text, or undefined when the key is absent. */
export function readText(storage: StorageLike, key: string): StorageResult<string | undefined> {
  try { return { ok: true, value: storage.getItem(key) ?? undefined, diagnostics: [] }; } catch (cause) {
    const error = diagnostic("STORAGE_UNAVAILABLE", key, "Unable to read local storage.", cause); return { ok: false, error, diagnostics: [error] };
  }
}
export function parseJson<T>(key: string, raw: string, validate: (value: unknown) => value is T): StorageResult<T> {
  try {
    const value: unknown = JSON.parse(raw);
    if (!validate(value)) { const error = diagnostic("STORAGE_INVALID", key, "Stored data failed runtime validation."); return { ok: false, error, diagnostics: [error] }; }
    return { ok: true, value, diagnostics: [] };
  } catch (cause) { const error = diagnostic("STORAGE_CORRUPT", key, "Stored data was not valid JSON.", cause); return { ok: false, error, diagnostics: [error] }; }
}
export function readJson<T>(storage: StorageLike, key: string, validate: (value: unknown) => value is T): StorageResult<T | undefined> {
  const raw = readText(storage, key);
  if (!raw.ok) return raw;
  if (raw.value === undefined) return { ok: true, value: undefined, diagnostics: [] };
  return parseJson(key, raw.value, validate);
}
function writeFailure(key: string, cause: unknown): StorageResult<never> {
  const quota = typeof cause === "object" && cause !== null && (("name" in cause && cause.name === "QuotaExceededError") || ("code" in cause && cause.code === 22));
  const error = diagnostic(quota ? "STORAGE_QUOTA" : "STORAGE_UNAVAILABLE", key, quota ? "Local storage quota was exceeded." : "Unable to write local storage.", cause);
  return { ok: false, error, diagnostics: [error] };
}
export function writeJson<T>(storage: StorageLike, key: string, value: T): StorageResult<T> {
  try { storage.setItem(key, JSON.stringify(value)); return { ok: true, value, diagnostics: [] }; }
  catch (cause) { return writeFailure(key, cause); }
}
export function writeText(storage: StorageLike, key: string, text: string): StorageResult<string> {
  try { storage.setItem(key, text); return { ok: true, value: text, diagnostics: [] }; }
  catch (cause) { return writeFailure(key, cause); }
}
export function isObject(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
export function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
