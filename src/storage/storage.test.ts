import { describe, expect, it } from "vitest";
import type { DivePlan, DivePlanInput } from "../domain/types";
import { SAVED_PLANS_KEY, SavedPlansStore } from "./savedPlans";
import { cylinderIssues, isCylinder, writeEntries } from "./schema";
import { TANK_BANK_KEY, TankBankStore } from "./tankBank";
import type { StorageLike, TankDraft } from "./types";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  public writes = 0;
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value); }
  public removeItem(key: string): void { this.values.delete(key); }
}
const tank = (name = "Back gas"): TankDraft => ({ name, waterVolumeL: liters(12), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: { id: "air", name: "Air", oxygen: fraction(0.21), helium: fraction(0), role: "bottom" }, maximumPPO2: barAbsolute(1.4), role: "bottom" });
const input = { mode: "oc", environment: "open-water", depthM: 30, bottomTimeSeconds: 1200, cylinders: [], bottomGas: { id: "air", name: "Air", oxygen: 0.21, helium: 0, role: "bottom" }, decoGases: [], settings: {}, environmentSettings: {}, rmv: {}, reservePolicy: { kind: "fixed", minimumPressureBar: 35 } } as unknown as DivePlanInput;
const plan = { id: "plan-output", metadata: { engineVersion: "engine-1", conventionId: "barefoot-zhl16c-v1", conventionVersion: "1.0.0" }, diagnostics: [], mode: "oc", environment: "open-water", segments: [], stops: [], finalTissues: {}, summary: {}, gasLedger: [] } as unknown as DivePlan;
const options = (storage: StorageLike) => ({ storage, clock: () => "2026-01-01T00:00:00.000Z", idGenerator: (kind: "cylinder" | "plan") => `${kind}-1` });
const sequentialOptions = (storage: StorageLike) => { let next = 0; return { ...options(storage), idGenerator: (kind: "cylinder" | "plan") => `${kind}-${++next}` }; };
const storedTank = (id: string, name = "Back gas") => ({ ...tank(name), id, revision: 1, archived: false, createdAt: "2025-12-01T00:00:00.000Z", updatedAt: "2025-12-01T00:00:00.000Z" });
const storedEnvelope = (storage: MemoryStorage, key: string) => JSON.parse(storage.getItem(key) ?? "null") as { schemaVersion: number; records: unknown[] };
/** A stored cylinder whose oxygen fraction is a string: shaped like a record, but not loadable. */
const stringOxygenTank = () => ({ ...storedTank("cylinder-bad", "Deco 50"), gas: { id: "ean50", name: "EAN50", oxygen: "0.50", helium: 0, role: "deco" } });

describe("TankBankStore", () => {
  it("migrates a legacy array, isolates edits, and supports archive/restore", () => {
    const storage = new MemoryStorage();
    storage.setItem("barefoot-dive:tank-bank", JSON.stringify([{ ...tank(), id: "legacy", revision: 1, archived: false, createdAt: "a", updatedAt: "a" }]));
    const store = new TankBankStore(options(storage));
    const listed = store.list({ archived: false });
    expect(listed.ok && listed.value).toHaveLength(1);
    const created = store.create(tank("Stage"));
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    store.archive(created.value.id);
    expect(store.list({ archived: true }).ok).toBe(true);
    store.restore(created.value.id);
    const edited = store.edit(created.value.id, { name: "Changed" });
    expect(edited.ok && edited.value.name).toBe("Changed");
    if (edited.ok) (edited.value as { name: string }).name = "caller mutation";
    const reread = store.get(created.value.id); expect(reread.ok && reread.value?.name).toBe("Changed");
  });
  it("reports corrupt records without throwing", () => {
    const storage = new MemoryStorage(); storage.setItem("barefoot-dive:tank-bank", "not-json");
    const result = new TankBankStore(options(storage)).list();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORAGE_CORRUPT");
  });
});

describe("Tank Bank record quarantine", () => {
  it("loads a current valid envelope without diagnostics and writes it back as the same envelope", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify({ schemaVersion: 1, records: [storedTank("cylinder-a"), storedTank("cylinder-b", "Stage")] }));
    const store = new TankBankStore(sequentialOptions(storage));
    const listed = store.list();
    expect(listed.ok && listed.value.map((record) => record.id)).toEqual(["cylinder-a", "cylinder-b"]);
    expect(listed.diagnostics).toEqual([]);
    const created = store.create({ ...tank("Deco"), minimumPressureBar: barGauge(50) });
    expect(created.ok && isCylinder(created.value)).toBe(true);
    expect(created.diagnostics).toEqual([]);
    const stored = storedEnvelope(storage, TANK_BANK_KEY);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.records.every(isCylinder)).toBe(true);
    expect(stored.records).toHaveLength(3);
  });

  it("quarantines one invalid record in a current envelope without failing the bank or writing on read", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify({ schemaVersion: 1, records: [storedTank("cylinder-a"), stringOxygenTank(), storedTank("cylinder-b", "Stage")] }));
    const raw = storage.getItem(TANK_BANK_KEY);
    storage.writes = 0;
    const store = new TankBankStore(options(storage));
    const listed = store.list();
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((record) => record.id)).toEqual(["cylinder-a", "cylinder-b"]);
    expect(listed.diagnostics).toEqual([expect.objectContaining({
      code: "STORAGE_RECORD_QUARANTINED",
      key: TANK_BANK_KEY,
      record: { index: 1, id: "cylinder-bad", name: "Deco 50", fields: ["gas.oxygen"] },
    })]);
    expect(store.list({ archived: true }).diagnostics).toHaveLength(1);
    expect(store.get("cylinder-a").diagnostics).toHaveLength(1);
    expect(storage.writes).toBe(0);
    expect(storage.getItem(TANK_BANK_KEY)).toBe(raw);
  });

  it("carries a quarantined record's exact text through every write, in the same order", () => {
    const storage = new MemoryStorage();
    // Non-canonical on purpose (whitespace, a text O2 fraction, an out-of-range number), so a re-encode would show.
    const invalid = `{ "id": "cylinder-bad", "name": "Deco 50", "gas": { "oxygen": "0.50" }, "waterVolumeL": 1e400 }`;
    storage.setItem(TANK_BANK_KEY, `{"schemaVersion":1,"records":[${JSON.stringify(storedTank("cylinder-a"))},${invalid},${JSON.stringify(storedTank("cylinder-b", "Stage"))}]}`);
    const store = new TankBankStore(sequentialOptions(storage));
    expect(store.edit("cylinder-a", { name: "Back gas edited" }).ok).toBe(true);
    expect(store.archive("cylinder-b").ok).toBe(true);
    expect(store.restore("cylinder-b").ok).toBe(true);
    const created = store.create(tank("Deco"));
    expect(created.ok).toBe(true);
    expect(created.diagnostics.map((item) => item.code)).toEqual(["STORAGE_RECORD_QUARANTINED"]);
    expect(store.delete("cylinder-b").ok).toBe(true);
    expect(store.duplicate("cylinder-a").ok).toBe(true);
    const stored = storedEnvelope(storage, TANK_BANK_KEY);
    expect(stored.schemaVersion).toBe(1);
    expect(stored.records.map((record) => (record as { id: string }).id)).toEqual(["cylinder-a", "cylinder-bad", "cylinder-1", "cylinder-2"]);
    expect(storage.getItem(TANK_BANK_KEY)).toContain(`},${invalid},{`);
    expect((stored.records[0] as { name: string }).name).toBe("Back gas edited");
    const listed = store.list();
    expect(listed.ok && listed.value.map((record) => record.id)).toEqual(["cylinder-a", "cylinder-1", "cylinder-2"]);
    expect(listed.diagnostics).toHaveLength(1);
  });

  it("never reads, mutates, or deletes a quarantined record through its id", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify({ schemaVersion: 1, records: [storedTank("cylinder-a"), stringOxygenTank()] }));
    const raw = storage.getItem(TANK_BANK_KEY);
    storage.writes = 0;
    const store = new TankBankStore(options(storage));
    const found = store.get("cylinder-bad");
    expect(found.ok && found.value).toBeUndefined();
    for (const result of [store.edit("cylinder-bad", { name: "Repaired" }), store.archive("cylinder-bad"), store.duplicate("cylinder-bad"), store.delete("cylinder-bad")]) {
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: "STORAGE_INVALID", message: "Cylinder cylinder-bad was not found." });
      expect(result.diagnostics.map((item) => item.code)).toEqual(["STORAGE_RECORD_QUARANTINED"]);
    }
    expect(storage.writes).toBe(0);
    expect(storage.getItem(TANK_BANK_KEY)).toBe(raw);
  });

  it("copies exact stored text that a JSON re-encode would change, and finds records the way JSON.parse does", () => {
    const storage = new MemoryStorage();
    // Out-of-range and unsafe numbers, a duplicate key, escapes, brackets inside a string, and internal whitespace.
    const exotic = `{ "id": "cylinder-odd", "name": "Odd \\"quoted\\" ]} name", "gas": { "oxygen": 1e400 },\n    "waterVolumeL": 12345678901234567890, "dup": 1, "dup": 2, "note": "\\u0041" }`;
    // JSON.parse keeps the last duplicate key, and the escaped key below decodes to "records".
    storage.setItem(TANK_BANK_KEY, `{\n  "schemaVersion": 1,\n  "records": [{ "id": "decoy" }],\n  "rec\\u006frds": [\n    ${JSON.stringify(storedTank("cylinder-a"))},\n    ${exotic}\n  ]\n}`);
    const store = new TankBankStore(sequentialOptions(storage));
    const listed = store.list();
    expect(listed.ok && listed.value.map((record) => record.id)).toEqual(["cylinder-a"]);
    expect(listed.diagnostics.map((item) => item.record?.id)).toEqual(["cylinder-odd"]);
    expect(store.edit("cylinder-a", { name: "Back gas edited" }).ok).toBe(true);
    expect(store.create(tank("Deco")).ok).toBe(true);
    const written = storage.getItem(TANK_BANK_KEY) ?? "";
    expect(written.startsWith(`{"schemaVersion":1,"records":[{`)).toBe(true);
    expect(written).toContain(`},${exotic},{`);
    expect(storedEnvelope(storage, TANK_BANK_KEY).records.map((record) => (record as { id: string }).id)).toEqual(["cylinder-a", "cylinder-odd", "cylinder-1"]);
  });

  it("reports quarantine positions from the written bank after a write moves them", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify({ schemaVersion: 1, records: [storedTank("cylinder-a"), stringOxygenTank()] }));
    const store = new TankBankStore(options(storage));
    expect(store.list().diagnostics.map((item) => item.record?.index)).toEqual([1]);
    const deleted = store.delete("cylinder-a");
    expect(deleted.ok).toBe(true);
    expect(deleted.diagnostics.map((item) => item.record?.index)).toEqual([0]);
    expect(storage.getItem(TANK_BANK_KEY)).toBe(`{"schemaVersion":1,"records":[${JSON.stringify(stringOxygenTank())}]}`);
  });

  it("refuses to write a record that its own read would quarantine", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify({ schemaVersion: 1, records: [storedTank("cylinder-a")] }));
    const raw = storage.getItem(TANK_BANK_KEY);
    storage.writes = 0;
    const store = new TankBankStore(options(storage));
    const created = store.create({ ...tank("Unmeasured"), waterVolumeL: liters(Number.NaN) });
    expect(created.ok).toBe(false);
    if (!created.ok) expect(created.error).toMatchObject({ code: "STORAGE_INVALID", message: "Cylinder record failed validation (waterVolumeL); nothing was written." });
    const edited = store.edit("cylinder-a", { gas: { ...tank().gas, oxygen: fraction(Number.NaN) } });
    expect(edited.ok).toBe(false);
    if (!edited.ok) expect(edited.error.message).toBe("Cylinder record failed validation (gas.oxygen); nothing was written.");
    expect(storage.writes).toBe(0);
    expect(storage.getItem(TANK_BANK_KEY)).toBe(raw);
  });

  it("writes nothing when a quarantined record's stored text is unknown", () => {
    const storage = new MemoryStorage();
    const result = writeEntries(storage, TANK_BANK_KEY, [{ valid: false, value: { id: "cylinder-x" }, fields: ["name"], source: undefined }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe("Stored record 1 could not be matched to its stored text, so it cannot be written back unchanged; nothing was written.");
    expect(storage.writes).toBe(0);
  });

  it("migrates a fully valid legacy bare array to a current envelope on the first write", () => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify([storedTank("legacy-a"), storedTank("legacy-b", "Stage")]));
    storage.writes = 0;
    const store = new TankBankStore(sequentialOptions(storage));
    const listed = store.list();
    expect(listed.ok && listed.value.map((record) => record.id)).toEqual(["legacy-a", "legacy-b"]);
    expect(listed.diagnostics).toEqual([]);
    expect(storage.writes).toBe(0);
    expect(store.create(tank("Deco")).ok).toBe(true);
    expect(storedEnvelope(storage, TANK_BANK_KEY)).toEqual({
      schemaVersion: 1,
      records: [storedTank("legacy-a"), storedTank("legacy-b", "Stage"), expect.objectContaining({ id: "cylinder-1", name: "Deco" })],
    });
  });

  it.each([
    ["a legacy bare array with an invalid record", [storedTank("cylinder-a"), null], "Stored legacy record list has invalid records; a legacy list loads only when every record is valid."],
    ["a bare array that holds no cylinders", [1, 2], "Stored legacy record list has invalid records; a legacy list loads only when every record is valid."],
    ["an unsupported schema version", { schemaVersion: 2, records: [storedTank("cylinder-a"), { shape: "from a newer app" }] }, "Stored schema version 2 is not supported by this app version."],
    ["a missing schema version", { records: [storedTank("cylinder-a")] }, "Stored data has no numeric schema version."],
    ["a non-list record field", { schemaVersion: 1, records: { "cylinder-a": storedTank("cylinder-a") } }, "Stored data is not a record list."],
    ["a primitive value", 42, "Stored data failed runtime validation."],
  ])("rejects %s whole and never writes over it", (_, value, message) => {
    const storage = new MemoryStorage();
    storage.setItem(TANK_BANK_KEY, JSON.stringify(value));
    const raw = storage.getItem(TANK_BANK_KEY);
    storage.writes = 0;
    const store = new TankBankStore(options(storage));
    const listed = store.list();
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error).toMatchObject({ code: "STORAGE_INVALID", key: TANK_BANK_KEY, message });
    expect(store.create(tank("Stage")).ok).toBe(false);
    expect(store.edit("cylinder-a", { name: "Changed" }).ok).toBe(false);
    expect(store.delete("cylinder-a").ok).toBe(false);
    expect(storage.writes).toBe(0);
    expect(storage.getItem(TANK_BANK_KEY)).toBe(raw);
  });

  it("names every failing field, including nested gas fields, and ignores unknown extra fields", () => {
    const valid = storedTank("cylinder-a");
    expect(cylinderIssues(valid)).toEqual([]);
    expect(cylinderIssues({ ...valid, minimumPressureBar: 50, archivedAt: "2026-01-02T00:00:00.000Z", futureField: { any: "shape" } })).toEqual([]);
    expect(cylinderIssues("cylinder")).toEqual(["record"]);
    expect(cylinderIssues([valid])).toEqual(["record"]);
    expect(cylinderIssues({ ...valid, gas: undefined })).toEqual(["gas"]);
    expect(cylinderIssues({ ...valid, waterVolumeL: "12", minimumPressureBar: null, archived: "false" })).toEqual(["waterVolumeL", "minimumPressureBar", "archived"]);
    expect(cylinderIssues({ ...valid, gas: { ...valid.gas, id: undefined, oxygen: "0.21", switchDepthM: null } })).toEqual(["gas.id", "gas.oxygen", "gas.switchDepthM"]);
  });
});

describe("SavedPlansStore", () => {
  it("stores immutable snapshots and creates a new revision on recalculate", () => {
    const store = new SavedPlansStore(options(new MemoryStorage()));
    const created = store.create({ title: "Deep plan", normalizedInputSnapshot: input, calculatedPlan: plan });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    (input as unknown as { cylinders: unknown[] }).cylinders.push(tank());
    (created.value.normalizedInputSnapshot as unknown as { cylinders: unknown[] }).cylinders.push(tank());
    const read = store.get(created.value.id);
    expect(read.ok && read.value?.normalizedInputSnapshot.cylinders).toHaveLength(0);
    const next = store.recalculate(created.value.id, { title: "Deep plan", normalizedInputSnapshot: input, calculatedPlan: { ...plan, metadata: { ...plan.metadata, engineVersion: "engine-2" } } });
    expect(next.ok && next.value.revision).toBe(2);
    expect(next.ok && next.value.parentRevisionId).toBe(created.value.id);
    expect(next.ok && next.value.lineageId).toBe(created.value.lineageId);
    expect(next.ok && next.value.engineVersion).toBe("engine-2");
  });
  it("supports filtering and defensive corruption diagnostics", () => {
    const storage = new MemoryStorage(); const store = new SavedPlansStore(options(storage));
    expect(store.create({ title: "Cave plan", normalizedInputSnapshot: input, calculatedPlan: plan }).ok).toBe(true);
    const filtered = store.list({
      search: "cave",
      mode: "oc",
      environment: "open-water",
      gas: "air",
      createdFrom: "2025-01-01T00:00:00.000Z",
      createdTo: "2027-01-01T00:00:00.000Z",
    });
    expect(filtered.ok && filtered.value).toHaveLength(1);
    storage.setItem("barefoot-dive:saved-plans", JSON.stringify({ schemaVersion: 99, records: [] }));
    const result = store.list(); expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("STORAGE_INVALID");
  });

  it("stays all-or-nothing: one invalid saved record fails the read and blocks every write", () => {
    const storage = new MemoryStorage(); const store = new SavedPlansStore(options(storage));
    const created = store.create({ title: "Deep plan", normalizedInputSnapshot: input, calculatedPlan: plan });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const stored = storedEnvelope(storage, SAVED_PLANS_KEY);
    const tampered = JSON.stringify({ ...stored, records: [...stored.records, { id: "broken-plan" }] });
    storage.setItem(SAVED_PLANS_KEY, tampered);
    storage.writes = 0;
    const listed = store.list();
    expect(listed.ok).toBe(false);
    if (!listed.ok) expect(listed.error.code).toBe("STORAGE_INVALID");
    expect(listed.diagnostics.map((item) => item.code)).not.toContain("STORAGE_RECORD_QUARANTINED");
    const draft = { title: "Another plan", normalizedInputSnapshot: input, calculatedPlan: plan };
    for (const result of [
      store.get(created.value.id),
      store.create(draft),
      store.rename(created.value.id, "Renamed"),
      store.duplicate(created.value.id),
      store.archive(created.value.id),
      store.restore(created.value.id),
      store.recalculate(created.value.id, draft),
      store.delete(created.value.id),
    ]) expect(result.ok).toBe(false);
    expect(storage.writes).toBe(0);
    expect(storage.getItem(SAVED_PLANS_KEY)).toBe(tampered);
  });

  it("still reads a legacy bare array of valid saved plans", () => {
    const source = new MemoryStorage();
    expect(new SavedPlansStore(options(source)).create({ title: "Legacy plan", normalizedInputSnapshot: input, calculatedPlan: plan }).ok).toBe(true);
    const storage = new MemoryStorage();
    storage.setItem(SAVED_PLANS_KEY, JSON.stringify(storedEnvelope(source, SAVED_PLANS_KEY).records));
    const listed = new SavedPlansStore(options(storage)).list();
    expect(listed.ok && listed.value.map((record) => record.title)).toEqual(["Legacy plan"]);
    expect(listed.diagnostics).toEqual([]);
  });

  it("snapshots and duplicates complete cave context independently", () => {
    const store = new SavedPlansStore(options(new MemoryStorage()));
    const caveInput = { mode: "oc", dive: input, route: [], reserve: { kind: "thirds" } } as const;
    const caveResult = { experimental: true, base: plan, route: {}, scenarios: [] } as unknown as import("../cave").CavePlanResult;
    const caveDiagnostics = [{
      code: "GAS_DISTANCE_LIMIT_EXCEEDED",
      severity: "error" as const,
      message: "The route exceeds its gas-derived maximum penetration distance.",
      field: "route",
    }];
    const created = store.create({
      title: "Cave snapshot",
      normalizedInputSnapshot: input,
      calculatedPlan: plan,
      caveInputSnapshot: caveInput,
      caveResultSnapshot: caveResult,
      warnings: caveDiagnostics,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    (caveInput.route as unknown as unknown[]).push({ id: "caller-mutation" });
    const duplicate = store.duplicate(created.value.id);
    expect(duplicate.ok).toBe(true);
    if (!duplicate.ok) return;
    expect(duplicate.value.caveInputSnapshot?.route).toHaveLength(0);
    expect(duplicate.value.caveResultSnapshot?.experimental).toBe(true);
    expect(duplicate.value.warnings).toEqual(caveDiagnostics);
  });
});
