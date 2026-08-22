import { clone } from "./codec";
import { defaultClock, defaultIdGenerator } from "./adapter";
import { isCylinder, readEnvelope, writeEnvelope } from "./schema";
import type { CylinderRole } from "../domain/types";
import type { StorageOptions, StorageResult, TankDraft, TankRecord } from "./types";

export const TANK_BANK_KEY = "barefoot-dive:tank-bank";
export type TankBankQuery = {
  readonly archived?: boolean;
  readonly search?: string;
  readonly role?: CylinderRole;
  readonly gas?: string;
};
export class TankBankStore {
  private readonly options: Required<StorageOptions>;
  public constructor(options: StorageOptions) { this.options = { storage: options.storage, clock: options.clock ?? defaultClock, idGenerator: options.idGenerator ?? defaultIdGenerator }; }
  private load(): StorageResult<TankRecord[]> {
    const loaded = readEnvelope(this.options.storage, TANK_BANK_KEY, isCylinder);
    return loaded.ok ? { ok: true, value: loaded.value.records.map(clone), diagnostics: loaded.diagnostics } : loaded;
  }
  private save(records: readonly TankRecord[]): StorageResult<TankRecord[]> { const saved = writeEnvelope(this.options.storage, TANK_BANK_KEY, records); return saved.ok ? { ok: true, value: records.map(clone), diagnostics: saved.diagnostics } : saved; }
  private mutate(id: string, change: (record: TankRecord) => TankRecord): StorageResult<TankRecord> {
    const loaded = this.load(); if (!loaded.ok) return loaded;
    const index = loaded.value.findIndex((record) => record.id === id); if (index < 0) return { ok: false, error: { code: "STORAGE_INVALID", key: TANK_BANK_KEY, message: `Cylinder ${id} was not found.` }, diagnostics: loaded.diagnostics };
    const records = [...loaded.value]; records[index] = change(records[index]); const saved = this.save(records);
    return saved.ok ? { ok: true, value: clone(records[index]), diagnostics: saved.diagnostics } : saved;
  }
  public list(query: TankBankQuery = {}): StorageResult<readonly TankRecord[]> {
    const loaded = this.load(); if (!loaded.ok) return loaded;
    const search = query.search?.trim().toLocaleLowerCase();
    const gas = query.gas?.trim().toLocaleLowerCase();
    return {
      ok: true,
      value: loaded.value.filter((record) =>
        (query.archived === undefined || Boolean(record.archived) === query.archived) &&
        (!query.role || record.role === query.role) &&
        (!gas || `${record.gas.id} ${record.gas.name}`.toLocaleLowerCase().includes(gas)) &&
        (!search || `${record.name} ${record.id} ${record.gas.name}`.toLocaleLowerCase().includes(search))
      ).map(clone),
      diagnostics: loaded.diagnostics,
    };
  }
  public get(id: string): StorageResult<TankRecord | undefined> { const result = this.list(); return result.ok ? { ok: true, value: result.value.find((record) => record.id === id), diagnostics: result.diagnostics } : result; }
  public create(draft: TankDraft): StorageResult<TankRecord> { const loaded = this.load(); if (!loaded.ok) return loaded; const now = this.options.clock(); const record: TankRecord = { ...clone(draft), id: this.options.idGenerator("cylinder"), revision: 1, archived: Boolean(draft.archived), createdAt: now, updatedAt: now, ...(draft.archived ? { archivedAt: now } : {}) }; const saved = this.save([...loaded.value, record]); return saved.ok ? { ok: true, value: clone(record), diagnostics: saved.diagnostics } : saved; }
  public edit(id: string, draft: Partial<TankDraft>): StorageResult<TankRecord> { return this.mutate(id, (record) => ({ ...record, ...clone(draft), id: record.id, revision: record.revision + 1, updatedAt: this.options.clock() })); }
  public duplicate(id: string): StorageResult<TankRecord> { const found = this.get(id); if (!found.ok) return found; if (!found.value) return { ok: false, error: { code: "STORAGE_INVALID", key: TANK_BANK_KEY, message: `Cylinder ${id} was not found.` }, diagnostics: [] }; const { name, waterVolumeL, workingPressureBar, currentPressureBar, minimumPressureBar, gas, maximumPPO2, role } = clone(found.value); return this.create({ name: `${name} copy`, waterVolumeL, workingPressureBar, currentPressureBar, ...(minimumPressureBar === undefined ? {} : { minimumPressureBar }), gas, maximumPPO2, ...(role === undefined ? {} : { role }), archived: false }); }
  public archive(id: string): StorageResult<TankRecord> { return this.mutate(id, (record) => { const now = this.options.clock(); return { ...record, archived: true, archivedAt: now, updatedAt: now, revision: record.revision + 1 }; }); }
  public restore(id: string): StorageResult<TankRecord> { return this.mutate(id, (record) => { const next = { ...record }; delete next.archivedAt; return { ...next, archived: false, updatedAt: this.options.clock(), revision: record.revision + 1 }; }); }
  public delete(id: string): StorageResult<boolean> { const loaded = this.load(); if (!loaded.ok) return loaded; const records = loaded.value.filter((record) => record.id !== id); if (records.length === loaded.value.length) return { ok: false, error: { code: "STORAGE_INVALID", key: TANK_BANK_KEY, message: `Cylinder ${id} was not found.` }, diagnostics: loaded.diagnostics }; const saved = this.save(records); return saved.ok ? { ok: true, value: true, diagnostics: saved.diagnostics } : { ok: false, error: saved.error, diagnostics: saved.diagnostics }; }
}

export function createTankBankStore(options: StorageOptions): TankBankStore { return new TankBankStore(options); }
