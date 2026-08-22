import type { DivePlanInput, Gas, PlanEnvironment, PlanningMode } from "../domain/types";
import { clone } from "./codec";
import { defaultClock, defaultIdGenerator } from "./adapter";
import { isSavedPlan, readEnvelope, writeEnvelope } from "./schema";
import type { SavedPlanDraft, SavedPlanRecord, StorageOptions, StorageResult } from "./types";

export const SAVED_PLANS_KEY = "barefoot-dive:saved-plans";
export type SavedPlanQuery = {
  readonly archived?: boolean;
  readonly search?: string;
  readonly engineVersion?: string;
  readonly mode?: PlanningMode;
  readonly environment?: PlanEnvironment;
  readonly createdFrom?: string;
  readonly createdTo?: string;
  readonly gas?: string;
};
const gasesForInput = (input: DivePlanInput): readonly Gas[] => input.mode === "oc"
  ? [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases]
  : [input.diluent, ...input.bailoutGases];

export class SavedPlansStore {
  private readonly options: Required<StorageOptions>;
  public constructor(options: StorageOptions) { this.options = { storage: options.storage, clock: options.clock ?? defaultClock, idGenerator: options.idGenerator ?? defaultIdGenerator }; }
  private load(): StorageResult<SavedPlanRecord[]> { const result = readEnvelope(this.options.storage, SAVED_PLANS_KEY, isSavedPlan); return result.ok ? { ok: true, value: result.value.records.map(clone), diagnostics: result.diagnostics } : result; }
  private save(records: readonly SavedPlanRecord[]): StorageResult<SavedPlanRecord[]> { const result = writeEnvelope(this.options.storage, SAVED_PLANS_KEY, records); return result.ok ? { ok: true, value: records.map(clone), diagnostics: result.diagnostics } : result; }
  private missing(id: string): StorageResult<never> { return { ok: false, error: { code: "STORAGE_INVALID", key: SAVED_PLANS_KEY, message: `Saved plan ${id} was not found.` }, diagnostics: [] }; }
  private snapshot(draft: SavedPlanDraft, id: string, now: string, lineageId: string, revision: number, parentRevisionId?: string): SavedPlanRecord {
    const input = clone(draft.normalizedInputSnapshot);
    const plan = clone(draft.calculatedPlan);
    const cylinders = input.cylinders.map(clone);
    const gases = gasesForInput(input).map(clone);
    return { id, title: draft.title.trim() || "Untitled plan", createdAt: now, updatedAt: now, archived: false, revision, lineageId, ...(parentRevisionId ? { parentRevisionId } : {}), normalizedInputSnapshot: input, resolvedCylinderSnapshots: cylinders, resolvedGasSnapshots: gases, calculatedPlan: plan, engineVersion: plan.metadata.engineVersion, conventionId: plan.metadata.conventionId, conventionVersion: plan.metadata.conventionVersion, warnings: clone(draft.warnings ?? plan.diagnostics.filter((item) => item.severity !== "error")), ...(draft.caveInputSnapshot ? { caveInputSnapshot: clone(draft.caveInputSnapshot) } : {}), ...(draft.caveResultSnapshot ? { caveResultSnapshot: clone(draft.caveResultSnapshot) } : {}) };
  }
  public list(query: SavedPlanQuery = {}): StorageResult<readonly SavedPlanRecord[]> {
    const loaded = this.load();
    if (!loaded.ok) return loaded;
    const search = query.search?.trim().toLocaleLowerCase();
    const gas = query.gas?.trim().toLocaleLowerCase();
    return {
      ok: true,
      value: loaded.value.filter((record) =>
        (query.archived === undefined || record.archived === query.archived) &&
        (!query.engineVersion || record.engineVersion === query.engineVersion) &&
        (!query.mode || record.normalizedInputSnapshot.mode === query.mode) &&
        (!query.environment || record.normalizedInputSnapshot.environment === query.environment) &&
        (!query.createdFrom || record.createdAt >= query.createdFrom) &&
        (!query.createdTo || record.createdAt <= query.createdTo) &&
        (!gas || record.resolvedGasSnapshots.some((item) =>
          `${item.id} ${item.name}`.toLocaleLowerCase().includes(gas)
        )) &&
        (!search || `${record.title} ${record.id} ${record.engineVersion}`.toLocaleLowerCase().includes(search))
      ).map(clone),
      diagnostics: loaded.diagnostics,
    };
  }
  public get(id: string): StorageResult<SavedPlanRecord | undefined> { const result = this.list(); return result.ok ? { ok: true, value: result.value.find((record) => record.id === id), diagnostics: result.diagnostics } : result; }
  public create(draft: SavedPlanDraft): StorageResult<SavedPlanRecord> { const loaded = this.load(); if (!loaded.ok) return loaded; const id = this.options.idGenerator("plan"); const record = this.snapshot(draft, id, this.options.clock(), id, 1); const saved = this.save([...loaded.value, record]); return saved.ok ? { ok: true, value: clone(record), diagnostics: saved.diagnostics } : saved; }
  public rename(id: string, title: string): StorageResult<SavedPlanRecord> { return this.mutate(id, (record) => ({ ...record, title: title.trim() || record.title, updatedAt: this.options.clock() })); }
  public duplicate(id: string): StorageResult<SavedPlanRecord> { const found = this.get(id); if (!found.ok) return found; if (!found.value) return this.missing(id); const source = found.value; const draft: SavedPlanDraft = { title: `${source.title} copy`, normalizedInputSnapshot: source.normalizedInputSnapshot, calculatedPlan: source.calculatedPlan, warnings: source.warnings, ...(source.caveInputSnapshot ? { caveInputSnapshot: source.caveInputSnapshot } : {}), ...(source.caveResultSnapshot ? { caveResultSnapshot: source.caveResultSnapshot } : {}) }; return this.create(draft); }
  public archive(id: string): StorageResult<SavedPlanRecord> { return this.mutate(id, (record) => { const now = this.options.clock(); return { ...record, archived: true, archivedAt: now, updatedAt: now }; }); }
  public restore(id: string): StorageResult<SavedPlanRecord> { return this.mutate(id, (record) => { const next = { ...record }; delete next.archivedAt; return { ...next, archived: false, updatedAt: this.options.clock() }; }); }
  public delete(id: string): StorageResult<boolean> { const loaded = this.load(); if (!loaded.ok) return loaded; const records = loaded.value.filter((record) => record.id !== id); if (records.length === loaded.value.length) return this.missing(id); const saved = this.save(records); return saved.ok ? { ok: true, value: true, diagnostics: saved.diagnostics } : saved; }
  public recalculate(id: string, draft: SavedPlanDraft): StorageResult<SavedPlanRecord> { const loaded = this.load(); if (!loaded.ok) return loaded; const source = loaded.value.find((record) => record.id === id); if (!source) return this.missing(id); const next = this.snapshot(draft, this.options.idGenerator("plan"), this.options.clock(), source.lineageId, source.revision + 1, source.id); const saved = this.save([...loaded.value, next]); return saved.ok ? { ok: true, value: clone(next), diagnostics: saved.diagnostics } : saved; }
  public isOlderEngine(record: SavedPlanRecord, currentEngineVersion: string): boolean { return record.engineVersion !== currentEngineVersion; }
  private mutate(id: string, change: (record: SavedPlanRecord) => SavedPlanRecord): StorageResult<SavedPlanRecord> { const loaded = this.load(); if (!loaded.ok) return loaded; const index = loaded.value.findIndex((record) => record.id === id); if (index < 0) return this.missing(id); const records = [...loaded.value]; records[index] = change(records[index]); const saved = this.save(records); return saved.ok ? { ok: true, value: clone(records[index]), diagnostics: saved.diagnostics } : saved; }
}

export type SavedPlanEngineStatus = { readonly olderEngine: boolean; readonly storedEngineVersion: string; readonly currentEngineVersion: string };
export function engineStatus(record: SavedPlanRecord, currentEngineVersion: string): SavedPlanEngineStatus { return { olderEngine: record.engineVersion !== currentEngineVersion, storedEngineVersion: record.engineVersion, currentEngineVersion }; }
export function createSavedPlansStore(options: StorageOptions): SavedPlansStore { return new SavedPlansStore(options); }
