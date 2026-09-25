import { clone } from "./codec";
import { defaultClock, defaultIdGenerator } from "./adapter";
import { cylinderIssues, quarantineDiagnostics, readEntries, writeEntries, type StoredEntry } from "./schema";
import type { CylinderRole } from "../domain/types";
import type { StorageDiagnostic, StorageOptions, StorageResult, TankDraft, TankRecord } from "./types";

export const TANK_BANK_KEY = "barefoot-dive:tank-bank";
export type TankBankQuery = {
  readonly archived?: boolean;
  readonly search?: string;
  readonly role?: CylinderRole;
  readonly gas?: string;
};
type TankEntries = readonly StoredEntry<TankRecord>[];
const loadedRecords = (entries: TankEntries): TankRecord[] => entries.flatMap((entry) => entry.valid ? [clone(entry.record)] : []);

/**
 * Tank Bank reads quarantine invalid stored records instead of failing the whole bank: valid records load, each
 * invalid one is reported as a `STORAGE_RECORD_QUARANTINED` diagnostic on every result, and writes copy its exact
 * stored text back in the same order. Only valid records can be listed, read, or mutated, and the store never
 * writes a record that its own read would quarantine.
 */
export class TankBankStore {
  private readonly options: Required<StorageOptions>;
  public constructor(options: StorageOptions) { this.options = { storage: options.storage, clock: options.clock ?? defaultClock, idGenerator: options.idGenerator ?? defaultIdGenerator }; }
  private load(): StorageResult<TankEntries> { return readEntries<TankRecord>(this.options.storage, TANK_BANK_KEY, cylinderIssues); }
  /** Writes `next`; failures leave storage untouched and report the loaded quarantine, success reports the written one. */
  private commit<T>(next: TankEntries, loadedDiagnostics: readonly StorageDiagnostic[], value: T): StorageResult<T> {
    const invalid = next.flatMap((entry) => entry.valid ? cylinderIssues(entry.record) : []);
    if (invalid.length > 0) return { ok: false, error: { code: "STORAGE_INVALID", key: TANK_BANK_KEY, message: `Cylinder record failed validation (${invalid.join(", ")}); nothing was written.` }, diagnostics: loadedDiagnostics };
    const saved = writeEntries(this.options.storage, TANK_BANK_KEY, next);
    return saved.ok
      ? { ok: true, value: clone(value), diagnostics: [...quarantineDiagnostics(TANK_BANK_KEY, next), ...saved.diagnostics] }
      : { ok: false, error: saved.error, diagnostics: [...loadedDiagnostics, ...saved.diagnostics] };
  }
  private missing(id: string, diagnostics: readonly StorageDiagnostic[]): StorageResult<never> { return { ok: false, error: { code: "STORAGE_INVALID", key: TANK_BANK_KEY, message: `Cylinder ${id} was not found.` }, diagnostics }; }
  private mutate(id: string, change: (record: TankRecord) => TankRecord): StorageResult<TankRecord> {
    const loaded = this.load(); if (!loaded.ok) return loaded;
    const index = loaded.value.findIndex((entry) => entry.valid && entry.record.id === id);
    const target = index < 0 ? undefined : loaded.value[index];
    if (!target?.valid) return this.missing(id, loaded.diagnostics);
    const record = change(target.record);
    const entries = [...loaded.value]; entries[index] = { valid: true, record };
    return this.commit(entries, loaded.diagnostics, record);
  }
  public list(query: TankBankQuery = {}): StorageResult<readonly TankRecord[]> {
    const loaded = this.load(); if (!loaded.ok) return loaded;
    const search = query.search?.trim().toLocaleLowerCase();
    const gas = query.gas?.trim().toLocaleLowerCase();
    return {
      ok: true,
      value: loadedRecords(loaded.value).filter((record) =>
        (query.archived === undefined || Boolean(record.archived) === query.archived) &&
        (!query.role || record.role === query.role) &&
        (!gas || `${record.gas.id} ${record.gas.name}`.toLocaleLowerCase().includes(gas)) &&
        (!search || `${record.name} ${record.id} ${record.gas.name}`.toLocaleLowerCase().includes(search))
      ),
      diagnostics: loaded.diagnostics,
    };
  }
  public get(id: string): StorageResult<TankRecord | undefined> { const result = this.list(); return result.ok ? { ok: true, value: result.value.find((record) => record.id === id), diagnostics: result.diagnostics } : result; }
  public create(draft: TankDraft): StorageResult<TankRecord> { const loaded = this.load(); if (!loaded.ok) return loaded; const now = this.options.clock(); const record: TankRecord = { ...clone(draft), id: this.options.idGenerator("cylinder"), revision: 1, archived: Boolean(draft.archived), createdAt: now, updatedAt: now, ...(draft.archived ? { archivedAt: now } : {}) }; return this.commit([...loaded.value, { valid: true, record }], loaded.diagnostics, record); }
  public edit(id: string, draft: Partial<TankDraft>): StorageResult<TankRecord> { return this.mutate(id, (record) => ({ ...record, ...clone(draft), id: record.id, revision: record.revision + 1, updatedAt: this.options.clock() })); }
  public duplicate(id: string): StorageResult<TankRecord> { const found = this.get(id); if (!found.ok) return found; if (!found.value) return this.missing(id, found.diagnostics); const { name, waterVolumeL, workingPressureBar, currentPressureBar, minimumPressureBar, gas, maximumPPO2, role } = clone(found.value); return this.create({ name: `${name} copy`, waterVolumeL, workingPressureBar, currentPressureBar, ...(minimumPressureBar === undefined ? {} : { minimumPressureBar }), gas, maximumPPO2, ...(role === undefined ? {} : { role }), archived: false }); }
  public archive(id: string): StorageResult<TankRecord> { return this.mutate(id, (record) => { const now = this.options.clock(); return { ...record, archived: true, archivedAt: now, updatedAt: now, revision: record.revision + 1 }; }); }
  public restore(id: string): StorageResult<TankRecord> { return this.mutate(id, (record) => { const next = { ...record }; delete next.archivedAt; return { ...next, archived: false, updatedAt: this.options.clock(), revision: record.revision + 1 }; }); }
  public delete(id: string): StorageResult<boolean> { const loaded = this.load(); if (!loaded.ok) return loaded; const entries = loaded.value.filter((entry) => !(entry.valid && entry.record.id === id)); if (entries.length === loaded.value.length) return this.missing(id, loaded.diagnostics); return this.commit(entries, loaded.diagnostics, true); }
}

export function createTankBankStore(options: StorageOptions): TankBankStore { return new TankBankStore(options); }
