import { describe, expect, it } from "vitest";
import type { DivePlan, DivePlanInput } from "../domain/types";
import { SavedPlansStore } from "./savedPlans";
import { TankBankStore } from "./tankBank";
import type { StorageLike, TankDraft } from "./types";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
  public removeItem(key: string): void { this.values.delete(key); }
}
const tank = (name = "Back gas"): TankDraft => ({ name, waterVolumeL: liters(12), workingPressureBar: barGauge(232), currentPressureBar: barGauge(200), gas: { id: "air", name: "Air", oxygen: fraction(0.21), helium: fraction(0), role: "bottom" }, maximumPPO2: barAbsolute(1.4), role: "bottom" });
const input = { mode: "oc", environment: "open-water", depthM: 30, bottomTimeSeconds: 1200, cylinders: [], bottomGas: { id: "air", name: "Air", oxygen: 0.21, helium: 0, role: "bottom" }, decoGases: [], settings: {}, environmentSettings: {}, rmv: {}, reservePolicy: { kind: "fixed", minimumPressureBar: 35 } } as unknown as DivePlanInput;
const plan = { id: "plan-output", metadata: { engineVersion: "engine-1", conventionId: "barefoot-zhl16c-v1", conventionVersion: "1.0.0" }, diagnostics: [], mode: "oc", environment: "open-water", segments: [], stops: [], finalTissues: {}, summary: {}, gasLedger: [] } as unknown as DivePlan;
const options = (storage: StorageLike) => ({ storage, clock: () => "2026-01-01T00:00:00.000Z", idGenerator: (kind: "cylinder" | "plan") => `${kind}-1` });

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
