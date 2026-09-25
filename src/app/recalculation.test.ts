import { describe, expect, it } from "vitest";
import { calculateCavePlan, type CavePlanInput } from "../cave";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV, EAN50 } from "../domain/defaults";
import type { CcrDiveInput, DivePlanInput } from "../domain/types";
import { barAbsolute, fraction, meters, seconds } from "../domain/units";
import { calculateDivePlan } from "../engine/planner";
import { SavedPlansStore } from "../storage/savedPlans";
import type { SavedPlanRecord, StorageLike } from "../storage/types";
import { collectCaveDiagnostics } from "./caveDiagnostics";
import { normalizeCaveRoute, routeCylinders, unsetGasNotices, withCylinderAccess } from "./caveRoute";
import { createInitialCaveWorkspaceSession } from "./caveWorkspace";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput, type GasDraft, type PlanDraft } from "./planning";
import { buildRecalculation } from "./recalculation";

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  public getItem(key: string): string | null { return this.values.get(key) ?? null; }
  public setItem(key: string, value: string): void { this.values.set(key, value); }
  public removeItem(key: string): void { this.values.delete(key); }
}

function storeWith(storage: StorageLike): SavedPlansStore {
  let next = 0;
  return new SavedPlansStore({
    storage,
    clock: () => "2026-09-23T00:00:00.000Z",
    idGenerator: (kind) => `${kind}-${(next += 1)}`,
  });
}

function save(storage: StorageLike, input: DivePlanInput): SavedPlanRecord {
  const calculated = calculateDivePlan(input);
  if (!calculated.ok) throw new Error(calculated.errors.map((item) => item.code).join(", "));
  const created = storeWith(storage).create({ title: "Plan", normalizedInputSnapshot: input, calculatedPlan: calculated.value, warnings: calculated.warnings });
  if (!created.ok) throw new Error("save failed");
  return created.value;
}

function reload(storage: StorageLike, id: string): SavedPlanRecord {
  const found = storeWith(storage).get(id);
  if (!found.ok || !found.value) throw new Error("reload failed");
  return found.value;
}

/** A CCR input shaped exactly like an engine 0.1.0 record: none of the 0.4.0 fields exist. */
const legacyCcr: CcrDiveInput = {
  mode: "ccr",
  environment: "open-water",
  depthM: meters(45),
  bottomTimeSeconds: seconds(30 * 60),
  diluent: { ...AIR, id: "dil", role: "diluent" },
  setpointBar: barAbsolute(1.3),
  setpointActivationDepthM: meters(6),
  bailoutGases: [
    { id: "bo", name: "Tx18/45", oxygen: fraction(0.18), helium: fraction(0.45), role: "bailout" },
    { ...EAN50, id: "bo50", role: "bailout", switchDepthM: meters(21) },
  ],
  cylinders: [],
  settings: DEFAULT_PLANNER_SETTINGS,
  environmentSettings: DEFAULT_ENVIRONMENT,
  rmv: DEFAULT_RMV,
  reservePolicy: DEFAULT_RESERVE_POLICY,
};

describe("saved-plan recalculation across engine versions", () => {
  it("recalculates a 0.1.0 CCR record with legacy breathing as a new revision and keeps the original", () => {
    const storage = new MemoryStorage();
    const original = save(storage, legacyCcr);
    const stored = reload(storage, original.id);
    expect("lowSetpointBar" in stored.normalizedInputSnapshot).toBe(false);

    const errors: string[] = [];
    const draft = buildRecalculation(stored, (message) => errors.push(message));
    expect(errors).toEqual([]);
    const revised = storeWith(storage).recalculate(stored.id, draft!);
    expect(revised.ok).toBe(true);
    if (!revised.ok) return;
    expect(revised.value).toMatchObject({ revision: 2, lineageId: original.lineageId, parentRevisionId: original.id });

    // Legacy breathing: open-circuit diluent from the surface to the switch-up depth and after arriving there on ascent.
    const segments = revised.value.calculatedPlan.segments;
    expect(segments[0]).toMatchObject({ kind: "descent", startDepthM: 0, endDepthM: 6 });
    expect(segments[0].setpointBar).toBeUndefined();
    expect(segments.at(-1)?.setpointBar).toBeUndefined();
    expect(revised.value.calculatedPlan.segments).toEqual(original.calculatedPlan.segments);

    expect(reload(storage, original.id)).toEqual(stored);
  });

  it.each([
    ["CCR low setpoint, switch-down, and dil-out", resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, mode: "ccr", setpointDeactivationDepthM: 9, diluentBailout: true, diluentPreBailoutUseL: 200 }, []).input!],
    ["OC gas only", resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, gasPlanning: "gas-only", reserve: { kind: "thirds" } }, []).input!],
  ])("round-trips the 0.4.0 fields for %s and recalculates the same plan", (_label, input) => {
    const storage = new MemoryStorage();
    const original = save(storage, input);
    const stored = reload(storage, original.id);
    expect(stored.normalizedInputSnapshot).toEqual(input);
    if (input.mode === "ccr") {
      expect(input).toMatchObject({ lowSetpointBar: 0.7, setpointDeactivationDepthM: 9, diluentBailout: true, diluentPreBailoutUseL: 200 });
    } else {
      expect(input.gasOnly).toBe(true);
    }
    const draft = buildRecalculation(stored, () => undefined);
    expect(draft?.calculatedPlan.segments).toEqual(original.calculatedPlan.segments);
    expect(draft?.calculatedPlan.gasLedger).toEqual(original.calculatedPlan.gasLedger);
  });

  it("recalculates each stored OC plan with the deco RMV rule it was saved with", () => {
    const cases = [
      [resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, bottomRmvUntilFirstStop: false }, []).input!, false],
      [resolvePlanInput(DEFAULT_PLAN_DRAFT, []).input!, true],
    ] as const;
    for (const [input, firstStop] of cases) {
      const storage = new MemoryStorage();
      const stored = reload(storage, save(storage, input).id);
      expect("decoRmvFrom" in stored.normalizedInputSnapshot).toBe(firstStop);
      const draft = buildRecalculation(stored, () => undefined);
      expect(draft?.calculatedPlan.diagnostics.some((item) => item.code === "DECO_RMV_FROM_FIRST_STOP")).toBe(firstStop);
      expect(draft?.calculatedPlan.gasLedger).toEqual(stored.calculatedPlan.gasLedger);
    }
  });

  it("reports a malformed stored low setpoint instead of silently falling back to legacy breathing", () => {
    const storage = new MemoryStorage();
    const original = save(storage, legacyCcr);
    const stored = reload(storage, original.id);
    const corrupted = { ...stored, normalizedInputSnapshot: { ...stored.normalizedInputSnapshot, lowSetpointBar: null } } as unknown as SavedPlanRecord;
    const errors: string[] = [];
    expect(buildRecalculation(corrupted, (message) => errors.push(message))).toBeUndefined();
    expect(errors.join(" ")).toContain("CCR_LOW_SETPOINT_INVALID");
  });
});

describe("saved cave recalculation", () => {
  it("keeps a route's warnings for gases a leg left unset, because the stored route is rerun unchanged", () => {
    // A leg edited before EAN80 joined the plan leaves EAN80 off that leg and warns about it.
    const session = createInitialCaveWorkspaceSession();
    const listed = routeCylinders(session.draft, resolvePlanInput(session.draft, [], "cave"));
    const oxygen = listed.find((cylinder) => cylinder.gases.some((gas) => gas.key === "deco-o2"))!;
    const leg = withCylinderAccess(session.route[0]!, oxygen, false, listed);
    const added: GasDraft = { ...session.draft.decoGases[0]!, key: "deco-added", name: "EAN80", oxygenPercent: 80, switchDepthM: 9 };
    const draft: PlanDraft = { ...session.draft, decoGases: [...session.draft.decoGases, added] };
    const resolved = resolvePlanInput(draft, [], "cave");
    if (!resolved.ok) throw new Error("The cave draft should resolve.");
    const cylinders = routeCylinders(draft, resolved);
    const route = normalizeCaveRoute([leg], cylinders);
    if (!route.ok) throw new Error("The cave route should build.");
    const notices = unsetGasNotices([leg], cylinders);
    expect(notices.map((item) => item.cylinderId)).toEqual(["plan-cylinder-deco-added"]);

    const input: CavePlanInput = { mode: "oc", dive: resolved.input, route: route.legs, reserve: resolved.input.reservePolicy, scenarios: [] };
    const calculated = calculateCavePlan(input);
    if (!calculated.ok) throw new Error(calculated.errors.map((item) => item.code).join(", "));
    const storage = new MemoryStorage();
    // One store for the whole lineage, so each new revision gets its own id.
    const store = storeWith(storage);
    const created = store.create({
      title: "Cave",
      normalizedInputSnapshot: input.dive,
      calculatedPlan: calculated.value.base,
      caveInputSnapshot: input,
      caveResultSnapshot: calculated.value,
      warnings: [...collectCaveDiagnostics([...calculated.warnings, ...(calculated.errors ?? [])], calculated.value), ...notices],
    });
    if (!created.ok) throw new Error("save failed");
    const original = reload(storage, created.value.id);

    let parent = original;
    for (const revision of [2, 3]) {
      const errors: string[] = [];
      const draftRevision = buildRecalculation(parent, (message) => errors.push(message));
      expect(errors).toEqual([]);
      const revised = store.recalculate(parent.id, draftRevision!);
      if (!revised.ok) throw new Error("recalculation failed");
      expect(revised.value).toMatchObject({ revision, lineageId: original.lineageId, parentRevisionId: parent.id });
      expect(revised.value.warnings.filter((item) => item.code === "ROUTE_GAS_ACCESS_UNSET")).toEqual(notices);
      parent = revised.value;
    }
    expect(reload(storage, original.id)).toEqual(original);
  });
});
