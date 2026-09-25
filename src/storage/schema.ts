import type { StorageDiagnostic, StorageLike, StorageResult, TankRecord, SavedPlanRecord } from "./types";
import { clone, diagnostic, isFiniteNumber, isObject, parseJson, readJson, readText, writeJson, writeText } from "./codec";
import { STORAGE_SCHEMA_VERSION } from "./types";

type Envelope<T> = { readonly schemaVersion: number; readonly records: readonly T[] };
type FieldCheck = (v: unknown) => boolean;
const isString = (v: unknown): v is string => typeof v === "string";
const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const optional = (check: FieldCheck): FieldCheck => (v) => v === undefined || check(v);

/** Declared Tank Bank record fields and their runtime checks. Unknown extra fields are ignored; value ranges are domain validation's job. */
const CYLINDER_FIELDS: Readonly<Record<string, FieldCheck>> = {
  id: isString, name: isString, createdAt: isString, updatedAt: isString,
  waterVolumeL: isFiniteNumber, workingPressureBar: isFiniteNumber, currentPressureBar: isFiniteNumber, maximumPPO2: isFiniteNumber, revision: isFiniteNumber,
  minimumPressureBar: optional(isFiniteNumber), role: optional(isString), archived: optional(isBoolean), archivedAt: optional(isString),
};
const GAS_FIELDS: Readonly<Record<string, FieldCheck>> = {
  id: isString, name: isString, oxygen: isFiniteNumber, helium: isFiniteNumber, role: isString,
  switchDepthM: optional(isFiniteNumber), cylinderId: optional(isString), maximumPPO2: optional(isFiniteNumber),
};
const failingFields = (value: Record<string, unknown>, fields: Readonly<Record<string, FieldCheck>>, prefix = ""): string[] =>
  Object.entries(fields).flatMap(([field, check]) => check(value[field]) ? [] : [`${prefix}${field}`]);

/** Fields of a stored Tank Bank record that fail runtime validation; an empty list means the record loads. */
export function cylinderIssues(value: unknown): readonly string[] {
  if (!isObject(value)) return ["record"];
  const issues = failingFields(value, CYLINDER_FIELDS);
  return isObject(value.gas) ? [...issues, ...failingFields(value.gas, GAS_FIELDS, "gas.")] : [...issues, "gas"];
}
export function isCylinder(value: unknown): value is TankRecord { return cylinderIssues(value).length === 0; }
export function isSavedPlan(value: unknown): value is SavedPlanRecord {
  if (!isObject(value) || !isString(value.id) || !isString(value.title) || !isString(value.createdAt) || !isString(value.updatedAt) || !isString(value.lineageId) || !isString(value.engineVersion) || !isString(value.conventionId) || !isString(value.conventionVersion)) return false;
  return typeof value.archived === "boolean" && isFiniteNumber(value.revision) && Array.isArray(value.resolvedCylinderSnapshots) && Array.isArray(value.resolvedGasSnapshots) && isObject(value.normalizedInputSnapshot) && isObject(value.calculatedPlan) && Array.isArray(value.warnings) && (value.caveInputSnapshot === undefined || isObject(value.caveInputSnapshot)) && (value.caveResultSnapshot === undefined || isObject(value.caveResultSnapshot));
}
/** The stored record array: a current-version envelope's records, or a legacy bare array. */
function storedRecords(value: unknown): readonly unknown[] | undefined {
  if (Array.isArray(value)) return value;
  return isObject(value) && value.schemaVersion === STORAGE_SCHEMA_VERSION && Array.isArray(value.records) ? value.records : undefined;
}
function unreadableContainer(value: unknown): string {
  if (!isObject(value) || !Array.isArray(value.records)) return "Stored data is not a record list.";
  return typeof value.schemaVersion === "number"
    ? `Stored schema version ${value.schemaVersion} is not supported by this app version.`
    : "Stored data has no numeric schema version.";
}
function migrate<T>(value: unknown, validate: (v: unknown) => v is T): Envelope<T> | undefined {
  const records = storedRecords(value);
  if (!records || !records.every(validate)) return undefined;
  return { schemaVersion: STORAGE_SCHEMA_VERSION, records };
}
/** All-or-nothing read (Saved Plans): one invalid record fails the whole read, so no write can replace it. */
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

/**
 * One stored record: loaded, or quarantined with its parsed value, its failing fields, and its exact stored text
 * (`source`, undefined only when that text could not be matched to the parsed value).
 */
export type StoredEntry<T> =
  | { readonly valid: true; readonly record: T }
  | { readonly valid: false; readonly value: unknown; readonly fields: readonly string[]; readonly source: string | undefined };

const JSON_WHITESPACE = " \t\n\r";
function skipWhitespace(text: string, start: number): number {
  let index = start;
  while (index < text.length && JSON_WHITESPACE.includes(text[index])) index += 1;
  return index;
}
function stringEnd(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== "\"") index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}
/** Index just past the JSON value that starts at `start`, in text JSON.parse has already accepted. */
function valueEnd(text: string, start: number): number {
  if (text[start] === "\"") return stringEnd(text, start);
  if (text[start] !== "{" && text[start] !== "[") {
    let index = start;
    while (index < text.length && !",]}".includes(text[index]) && !JSON_WHITESPACE.includes(text[index])) index += 1;
    return index;
  }
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") index = stringEnd(text, index) - 1;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
}
function elementSources(text: string, start: number): string[] | undefined {
  const sources: string[] = [];
  let index = skipWhitespace(text, start + 1);
  while (index < text.length && text[index] !== "]") {
    const end = valueEnd(text, index);
    if (end <= index) return undefined;
    sources.push(text.slice(index, end));
    index = skipWhitespace(text, end);
    if (text[index] === ",") index = skipWhitespace(text, index + 1);
  }
  return sources;
}
/** Exact text of each stored record: a bare array's elements, or the last `records` member of an object, as JSON.parse keeps it. */
function recordSources(text: string): string[] | undefined {
  let index = skipWhitespace(text, 0);
  if (text[index] === "[") return elementSources(text, index);
  if (text[index] !== "{") return undefined;
  let sources: string[] | undefined;
  index = skipWhitespace(text, index + 1);
  while (index < text.length && text[index] === "\"") {
    const keyEnd = stringEnd(text, index);
    let key: unknown;
    try { key = JSON.parse(text.slice(index, keyEnd)); } catch { return undefined; }
    const valueStart = skipWhitespace(text, skipWhitespace(text, keyEnd) + 1);
    const end = valueEnd(text, valueStart);
    if (end <= valueStart) return undefined;
    if (key === "records") sources = text[valueStart] === "[" ? elementSources(text, valueStart) : undefined;
    index = skipWhitespace(text, end);
    if (text[index] === ",") index = skipWhitespace(text, index + 1);
  }
  return sources;
}
const sameJson = (source: string, value: unknown): boolean => {
  try { return JSON.stringify(JSON.parse(source)) === JSON.stringify(value); } catch { return false; }
};
/** Each record's exact stored text, or undefined where it cannot be matched to the parsed record. */
function matchedSources(text: string, records: readonly unknown[]): readonly (string | undefined)[] {
  const located = recordSources(text);
  const aligned = located?.length === records.length ? located : undefined;
  return records.map((value, index) => {
    const source = aligned?.[index];
    return source !== undefined && sameJson(source, value) ? source : undefined;
  });
}

function quarantined(key: string, index: number, value: unknown, fields: readonly string[]): StorageDiagnostic {
  const id = isObject(value) && isString(value.id) ? value.id : undefined;
  const name = isObject(value) && isString(value.name) ? value.name : undefined;
  return {
    code: "STORAGE_RECORD_QUARANTINED",
    key,
    message: `Stored record ${index + 1} failed validation (${fields.join(", ")}) and was quarantined unchanged.`,
    record: { index, ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }), fields },
  };
}
/** One `STORAGE_RECORD_QUARANTINED` diagnostic per quarantined entry, located by its current position. */
export function quarantineDiagnostics(key: string, entries: readonly StoredEntry<unknown>[]): StorageDiagnostic[] {
  return entries.flatMap((entry, index) => entry.valid ? [] : [quarantined(key, index, entry.value, entry.fields)]);
}
/**
 * Per-record read (Tank Bank): valid records load, and each invalid record in a current envelope becomes a
 * quarantined entry with a diagnostic instead of failing the read. `recordIssues` must return an empty list only
 * for a valid `T`. Everything else stays all-or-nothing: corrupt JSON, a non-list, an unsupported schema version,
 * or a legacy bare array with any invalid record fails the read, so no write can replace data this version cannot
 * interpret.
 */
export function readEntries<T>(storage: StorageLike, key: string, recordIssues: (value: unknown) => readonly string[]): StorageResult<readonly StoredEntry<T>[]> {
  const raw = readText(storage, key);
  if (!raw.ok) return raw;
  if (raw.value === undefined) return { ok: true, value: [], diagnostics: [] };
  const parsed = parseJson(key, raw.value, (value): value is object => typeof value === "object" && value !== null);
  if (!parsed.ok) return parsed;
  const records = storedRecords(parsed.value);
  if (!records) { const error = diagnostic("STORAGE_INVALID", key, unreadableContainer(parsed.value)); return { ok: false, error, diagnostics: [error] }; }
  const issues = records.map((value) => recordIssues(value));
  if (issues.every((fields) => fields.length === 0)) return { ok: true, value: records.map((value): StoredEntry<T> => ({ valid: true, record: value as T })), diagnostics: [] };
  if (Array.isArray(parsed.value)) { const error = diagnostic("STORAGE_INVALID", key, "Stored legacy record list has invalid records; a legacy list loads only when every record is valid."); return { ok: false, error, diagnostics: [error] }; }
  const sources = matchedSources(raw.value, records);
  const entries = records.map((value, index): StoredEntry<T> => issues[index].length === 0
    ? { valid: true, record: value as T }
    : { valid: false, value, fields: issues[index], source: sources[index] });
  return { ok: true, value: entries, diagnostics: quarantineDiagnostics(key, entries) };
}
/**
 * Writes a current envelope in entry order. Loaded records are serialized; each quarantined record is copied back
 * as its exact stored text, so it is never re-encoded, repaired, or dropped. Nothing is written when a quarantined
 * record's stored text could not be matched.
 */
export function writeEntries<T>(storage: StorageLike, key: string, entries: readonly StoredEntry<T>[]): StorageResult<unknown> {
  if (entries.every((entry) => entry.valid)) return writeEnvelope(storage, key, entries.flatMap((entry) => entry.valid ? [entry.record] : []));
  const texts: string[] = [];
  for (const [index, entry] of entries.entries()) {
    if (entry.valid) texts.push(JSON.stringify(entry.record));
    else if (entry.source !== undefined) texts.push(entry.source);
    else {
      const error = diagnostic("STORAGE_INVALID", key, `Stored record ${index + 1} could not be matched to its stored text, so it cannot be written back unchanged; nothing was written.`);
      return { ok: false, error, diagnostics: [error] };
    }
  }
  return writeText(storage, key, `{"schemaVersion":${STORAGE_SCHEMA_VERSION},"records":[${texts.join(",")}]}`);
}
