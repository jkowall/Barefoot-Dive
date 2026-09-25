import { describe, expect, it } from "vitest";
import { calculateCavePlan, type RouteLeg } from "../cave";
import { barAbsolute, barGauge, fraction, liters } from "../domain/units";
import type { TankRecord } from "../storage";
import {
  normalizeCaveRoute,
  routeCylinderAccess,
  routeCylinders,
  routeStageCylinder,
  unsetGasNotices,
  unsetRouteCylinders,
  withCylinderAccess,
  withStageCylinder,
  withUnsetGasesKept,
  type RouteCylinder,
} from "./caveRoute";
import { createInitialCaveWorkspaceSession, type RouteDraft } from "./caveWorkspace";
import { activeGasDrafts, resolvePlanInput, type GasDraft, type PlanDraft, type TankBankSnapshot } from "./planning";

const tank = (id: string, name: string, oxygen: number, archived = false): TankRecord => ({
  id,
  name,
  waterVolumeL: liters(12),
  workingPressureBar: barGauge(232),
  currentPressureBar: barGauge(210),
  gas: { id: `${id}-gas`, name: `O₂ ${oxygen * 100}%`, oxygen: fraction(oxygen), helium: fraction(0), role: "bottom" },
  maximumPPO2: barAbsolute(1.4),
  revision: 1,
  archived,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const backGas = tank("bank-back", "Back gas 12 L", 0.21);
const stage = tank("bank-stage", "Stage 11 L", 0.5);
const bank = [backGas, stage];

const initialSession = createInitialCaveWorkspaceSession();
/** Cave's initial draft: OC Tx18/45 bottom gas with EAN50 and oxygen deco gases, all ad hoc. */
const caveDraft = initialSession.draft;
/** Cave's initial leg: 0 to 18 m on fins, every plan cylinder accessible. */
const leg = initialSession.route[0]!;
const dropLeg: RouteDraft = { ...leg, stageAction: "drop" };

function withSource(draft: PlanDraft, key: string, cylinderId: string | undefined): PlanDraft {
  const set = (gas: GasDraft): GasDraft => gas.key === key ? { ...gas, cylinderId } : gas;
  return {
    ...draft,
    bottomGas: set(draft.bottomGas),
    travelGas: set(draft.travelGas),
    decoGases: draft.decoGases.map(set),
    diluent: set(draft.diluent),
    bailoutGases: draft.bailoutGases.map(set),
  };
}

function withDecoIncluded(draft: PlanDraft, key: string, enabled: boolean): PlanDraft {
  return { ...draft, decoGases: draft.decoGases.map((gas) => gas.key === key ? { ...gas, enabled } : gas) };
}

const cylindersFor = (draft: PlanDraft, tankBank: TankBankSnapshot | readonly TankRecord[] = bank) =>
  routeCylinders(draft, resolvePlanInput(draft, tankBank, "cave"));

function cylinderUsedBy(cylinders: readonly RouteCylinder[], key: string): RouteCylinder {
  const cylinder = cylinders.find((candidate) => candidate.gases.some((gas) => gas.key === key));
  if (!cylinder) throw new Error(`No plan cylinder is used by ${key}.`);
  return cylinder;
}

function legsOf(route: readonly RouteDraft[], cylinders: readonly RouteCylinder[]): readonly RouteLeg[] {
  const normalized = normalizeCaveRoute(route, cylinders);
  if (!normalized.ok) throw new Error(normalized.diagnostics.map((item) => item.message).join(" "));
  return normalized.legs;
}

const accessibleIds = (route: readonly RouteDraft[], cylinders: readonly RouteCylinder[]) =>
  legsOf(route, cylinders).map((item) => item.accessibleCylinderIds);

function calculate(draft: PlanDraft, route: readonly RouteDraft[]) {
  const resolved = resolvePlanInput(draft, bank, "cave");
  if (!resolved.ok) throw new Error("The cave draft should resolve.");
  const legs = legsOf(route, routeCylinders(draft, resolved));
  return calculateCavePlan({ mode: draft.mode, dive: resolved.input, route: legs, reserve: resolved.input.reservePolicy, scenarios: [] });
}

describe("cave route cylinders", () => {
  it("names each plan cylinder's gas by role and name, in plan order", () => {
    const draft = withDecoIncluded(
      { ...withSource(caveDraft, "bottom", backGas.id), travelGasEnabled: true },
      "deco-50",
      false,
    );
    expect(cylindersFor(draft)).toEqual([
      { id: backGas.id, name: "Back gas 12 L", gases: [{ key: "bottom", label: "bottom gas Tx18/45" }] },
      { id: "plan-cylinder-travel", name: "Travel air cylinder", gases: [{ key: "travel", label: "travel gas Travel air" }] },
      { id: "plan-cylinder-deco-o2", name: "Oxygen cylinder", gases: [{ key: "deco-o2", label: "deco gas Oxygen" }] },
    ]);
  });

  it("pairs every active gas with the cylinder it resolves to, across modes, switches, and sources", () => {
    const sources = ["ad hoc", "loaded", "archived", "deleted"] as const;
    const records = (keys: readonly string[]) => keys.flatMap((key) => [
      tank(`loaded-${key}`, `Loaded ${key}`, 0.21),
      tank(`archived-${key}`, `Archived ${key}`, 0.21, true),
    ]);
    const choices = <T,>(options: readonly T[], count: number): T[][] => count === 0
      ? [[]]
      : choices(options, count - 1).flatMap((rest) => options.map((option) => [option, ...rest]));
    let checked = 0;
    for (const mode of ["oc", "ccr"] as const) {
      for (const travelGasEnabled of [false, true]) {
        for (const included of choices([true, false], 2)) {
          const base: PlanDraft = {
            ...caveDraft,
            mode,
            travelGasEnabled,
            decoGases: caveDraft.decoGases.map((gas, index) => ({ ...gas, enabled: included[index] })),
            bailoutGases: caveDraft.bailoutGases.map((gas, index) => ({ ...gas, enabled: included[index] })),
          };
          const active = activeGasDrafts(base);
          const tankBank = records(active.map((gas) => gas.key));
          for (const picked of choices(sources, active.length)) {
            const draft = active.reduce((next, gas, index) => withSource(next, gas.key, {
              "ad hoc": undefined,
              loaded: `loaded-${gas.key}`,
              archived: `archived-${gas.key}`,
              deleted: `deleted-${gas.key}`,
            }[picked[index]!]), base);
            const expected = active.map((gas, index) => picked[index] === "loaded" ? `loaded-${gas.key}` : `plan-cylinder-${gas.key}`);
            expect(cylindersFor(draft, tankBank).map((cylinder) => [cylinder.id, cylinder.gases.map((gas) => gas.key)]))
              .toEqual(active.map((gas, index) => [expected[index], [gas.key]]));
            checked += 1;
          }
        }
      }
    }
    expect(checked).toBe(700);
  });
});

describe("cave route access follows each gas", () => {
  it("keeps a leg's recorded access when a gas's cylinder source changes", () => {
    const sourcedCylinders = cylindersFor(withSource(caveDraft, "bottom", backGas.id));
    const ean50 = cylinderUsedBy(sourcedCylinders, "deco-50");
    // Untick and re-tick one cylinder so the leg's list is explicit, as in the reported case.
    const explicit = withCylinderAccess(
      withCylinderAccess(leg, ean50, false, sourcedCylinders),
      ean50,
      true,
      sourcedCylinders,
    );
    expect(explicit.accessibleGasKeys).toEqual(["bottom", "deco-o2", "deco-50"]);
    expect(accessibleIds([explicit], sourcedCylinders)).toEqual([[backGas.id, "plan-cylinder-deco-50", "plan-cylinder-deco-o2"]]);

    // "Ad hoc plan cylinder" (or "Detach to ad hoc values"), another cylinder, then back.
    for (const [cylinderId, expected] of [
      [undefined, "plan-cylinder-bottom"],
      [stage.id, stage.id],
      [backGas.id, backGas.id],
    ] as const) {
      const cylinders = cylindersFor(withSource(caveDraft, "bottom", cylinderId));
      expect(routeCylinderAccess(explicit, cylinderUsedBy(cylinders, "bottom"))).toBe("accessible");
      expect(accessibleIds([explicit], cylinders)).toEqual([[expected, "plan-cylinder-deco-50", "plan-cylinder-deco-o2"]]);
    }
  });

  it("calculates the cave plan with the bottom gas still accessible after it is detached", () => {
    const sourcedCylinders = cylindersFor(withSource(caveDraft, "bottom", backGas.id));
    const ean50 = cylinderUsedBy(sourcedCylinders, "deco-50");
    const explicit = withCylinderAccess(
      withCylinderAccess(leg, ean50, false, sourcedCylinders),
      ean50,
      true,
      sourcedCylinders,
    );
    const result = calculate(caveDraft, [explicit]);
    expect(result.errors ?? []).toEqual([]);
    if (!result.ok) throw new Error("The cave plan should calculate.");
    // The penetration leg breathes the detached bottom gas from its ad hoc cylinder.
    expect(result.value.base.segments[0]).toMatchObject({ gasId: "plan-gas-bottom", startDepthM: 0, endDepthM: 18 });
    expect(result.value.gasLedger.map((entry) => entry.cylinderId)).toContain("plan-cylinder-bottom");
  });

  it("follows a gas through an unavailable source, its detach, and its restore", () => {
    const sourced = withSource(caveDraft, "bottom", backGas.id);
    const sourcedCylinders = cylindersFor(sourced);
    const explicit = withCylinderAccess(leg, cylinderUsedBy(sourcedCylinders, "deco-o2"), false, sourcedCylinders);

    // While the record is archived, Cave lists the ad hoc cylinder a detach would use.
    const archived = cylindersFor(sourced, [{ ...backGas, archived: true }, stage]);
    expect(cylinderUsedBy(archived, "bottom").id).toBe("plan-cylinder-bottom");
    expect(routeCylinderAccess(explicit, cylinderUsedBy(archived, "bottom"))).toBe("accessible");

    expect(accessibleIds([explicit], cylindersFor(withSource(sourced, "bottom", undefined)))).toEqual([["plan-cylinder-bottom", "plan-cylinder-deco-50"]]);
    expect(accessibleIds([explicit], sourcedCylinders)).toEqual([[backGas.id, "plan-cylinder-deco-50"]]);
  });

  it("gives an unedited leg every plan cylinder in plan order, and restores that exact leg after edits", () => {
    const cylinders = cylindersFor(caveDraft);
    const ean50 = cylinderUsedBy(cylinders, "deco-50");
    const oxygen = cylinderUsedBy(cylinders, "deco-o2");
    const edited = [
      (next: RouteDraft) => withCylinderAccess(next, oxygen, false, cylinders),
      (next: RouteDraft) => withCylinderAccess(next, ean50, false, cylinders),
      (next: RouteDraft) => withCylinderAccess(next, oxygen, true, cylinders),
      (next: RouteDraft) => withCylinderAccess(next, ean50, true, cylinders),
    ].reduce((next, edit) => edit(next), leg);
    expect(accessibleIds([leg], cylinders)).toEqual([["plan-cylinder-bottom", "plan-cylinder-deco-50", "plan-cylinder-deco-o2"]]);
    // Same cave input, so the same signature: re-ticking does not start a recalculation.
    expect(JSON.stringify(normalizeCaveRoute([edited], cylinders))).toBe(JSON.stringify(normalizeCaveRoute([leg], cylinders)));
  });

  it("records the gases on the leg at its first access edit, so a gas that takes part later starts inaccessible", () => {
    const withoutEan50 = withDecoIncluded(caveDraft, "deco-50", false);
    const listed = cylindersFor(withoutEan50);
    const explicit = withCylinderAccess(leg, cylinderUsedBy(listed, "deco-o2"), false, listed);
    expect(explicit.accessibleGasKeys).toEqual(["bottom"]);

    // EAN50 switched back on, a travel gas turned on, and a newly added gas were never shown on the leg.
    const added: GasDraft = { ...caveDraft.decoGases[0]!, key: "deco-added", name: "EAN80", oxygenPercent: 80 };
    const later = { ...caveDraft, travelGasEnabled: true, decoGases: [...caveDraft.decoGases, added] };
    const laterCylinders = cylindersFor(later);
    for (const key of ["deco-50", "travel", "deco-added"]) {
      expect(routeCylinderAccess(explicit, cylinderUsedBy(laterCylinders, key))).toBe("inaccessible");
      expect(routeCylinderAccess(leg, cylinderUsedBy(laterCylinders, key))).toBe("accessible");
    }
    expect(accessibleIds([explicit], laterCylinders)).toEqual([["plan-cylinder-bottom"]]);
  });

  it("keeps a gas's recorded access while it is switched off, leaving no cylinder the plan lacks", () => {
    const cylinders = cylindersFor(caveDraft);
    const explicit = withCylinderAccess(leg, cylinderUsedBy(cylinders, "deco-o2"), false, cylinders);
    const withoutEan50 = withDecoIncluded(caveDraft, "deco-50", false);
    expect(accessibleIds([explicit], cylindersFor(withoutEan50))).toEqual([["plan-cylinder-bottom"]]);
    const result = calculate(withoutEan50, [explicit]);
    expect(result.errors ?? []).toEqual([]);
    expect(result.ok).toBe(true);
    expect(accessibleIds([explicit], cylinders)).toEqual([["plan-cylinder-bottom", "plan-cylinder-deco-50"]]);
  });

  it("keeps the other breathing mode's gases inaccessible on a leg edited before the switch", () => {
    const cylinders = cylindersFor(caveDraft);
    const explicit = withCylinderAccess(leg, cylinderUsedBy(cylinders, "deco-o2"), false, cylinders);
    const ccr = { ...caveDraft, mode: "ccr" as const };
    expect(accessibleIds([explicit], cylindersFor(ccr))).toEqual([[]]);
    expect(accessibleIds([leg], cylindersFor(ccr))).toEqual([["plan-cylinder-diluent", "plan-cylinder-bailout-bottom", "plan-cylinder-bailout-50"]]);
    // The cave layer then rejects the leg until the diver ticks the diluent cylinder.
    const result = calculate(ccr, [explicit]);
    expect(result.ok).toBe(false);
    expect(result.errors?.map((item) => item.code)).toContain("CYLINDER_INACCESSIBLE");
  });
});

describe("cave route stage follows its gas", () => {
  it("keeps the stage with its gas when that gas's cylinder source changes", () => {
    const staged = withStageCylinder(dropLeg, cylinderUsedBy(cylindersFor(caveDraft), "deco-50"));
    expect(staged.stageGasKey).toBe("deco-50");
    for (const [cylinderId, expected] of [
      [undefined, "plan-cylinder-deco-50"],
      [stage.id, stage.id],
      [undefined, "plan-cylinder-deco-50"],
    ] as const) {
      const cylinders = cylindersFor(withSource(caveDraft, "deco-50", cylinderId));
      expect(routeStageCylinder(staged, cylinders)?.id).toBe(expected);
      expect(legsOf([staged], cylinders)[0]).toMatchObject({ stageAction: "drop", stageCylinderId: expected });
    }
    expect(withStageCylinder(staged, undefined).stageGasKey).toBeUndefined();
  });

  it("leaves out a stage whose gas is switched off, which the cave layer rejects", () => {
    const staged = withStageCylinder(dropLeg, cylinderUsedBy(cylindersFor(caveDraft), "deco-50"));
    const withoutEan50 = withDecoIncluded(caveDraft, "deco-50", false);
    const [normalized] = legsOf([staged], cylindersFor(withoutEan50));
    expect(normalized).toMatchObject({ stageAction: "drop" });
    expect(normalized).not.toHaveProperty("stageCylinderId");
    const result = calculate(withoutEan50, [staged]);
    expect(result.ok).toBe(false);
    expect(result.errors?.map((item) => item.code)).toContain("STAGE_ID_REQUIRED");
  });

  it("ignores a recorded stage on a leg with no stage action", () => {
    const staged = withStageCylinder(dropLeg, cylinderUsedBy(cylindersFor(caveDraft), "deco-50"));
    const [normalized] = legsOf([{ ...staged, stageAction: "none" }], cylindersFor(caveDraft));
    expect(normalized).not.toHaveProperty("stageAction");
    expect(normalized).not.toHaveProperty("stageCylinderId");
  });
});

describe("a Tank Bank cylinder selected for several gases", () => {
  const sharedDraft = withSource(withSource(caveDraft, "bottom", backGas.id), "deco-o2", backGas.id);

  it("builds no route and names the gases and the cylinder", () => {
    const cylinders = cylindersFor(sharedDraft);
    expect(cylinderUsedBy(cylinders, "deco-o2").gases.map((gas) => gas.key)).toEqual(["bottom", "deco-o2"]);
    expect(normalizeCaveRoute([leg], cylinders)).toEqual({
      ok: false,
      diagnostics: [{
        code: "ROUTE_CYLINDER_SHARED",
        severity: "error",
        message: "Bottom gas Tx18/45 and deco gas Oxygen both use Tank Bank cylinder “Back gas 12 L”. Choose another cylinder for one of them; a cave plan needs one cylinder per gas.",
        cylinderId: backGas.id,
      }],
    });

    const allThree = withSource(sharedDraft, "deco-50", backGas.id);
    expect(normalizeCaveRoute([leg], cylindersFor(allThree)).diagnostics).toEqual([expect.objectContaining({
      message: "Bottom gas Tx18/45, deco gas EAN50 and deco gas Oxygen all use Tank Bank cylinder “Back gas 12 L”. Choose another cylinder for all but one of them; a cave plan needs one cylinder per gas.",
    })]);
  });

  it("leaves every gas's recorded access and stage untouched until the gases have their own cylinders again", () => {
    const sourced = withSource(caveDraft, "bottom", backGas.id);
    const sourcedCylinders = cylindersFor(sourced);
    const explicit = withStageCylinder(
      withCylinderAccess(dropLeg, cylinderUsedBy(sourcedCylinders, "deco-o2"), false, sourcedCylinders),
      cylinderUsedBy(sourcedCylinders, "deco-50"),
    );
    const before = legsOf([explicit], sourcedCylinders);

    // The oxygen gas is pointed at the bottom gas's record: the leg shows the shared cylinder as mixed.
    const shared = cylindersFor(withSource(sourced, "deco-o2", backGas.id));
    expect(routeCylinderAccess(explicit, cylinderUsedBy(shared, "bottom"))).toBe("mixed");
    expect(normalizeCaveRoute([explicit], shared).ok).toBe(false);

    // Back on its own cylinder, the oxygen gas is still inaccessible and the EAN50 stage is unchanged.
    expect(legsOf([explicit], cylindersFor(sourced))).toEqual(before);
    expect(before[0]).toMatchObject({ accessibleCylinderIds: [backGas.id, "plan-cylinder-deco-50"], stageCylinderId: "plan-cylinder-deco-50" });
  });
});

describe("gases a leg has not set", () => {
  const added: GasDraft = { ...caveDraft.decoGases[0]!, key: "deco-added", name: "EAN80", oxygenPercent: 80 };
  const withAdded: PlanDraft = { ...caveDraft, decoGases: [...caveDraft.decoGases, added] };

  it("records the gases listed at a leg's first access edit as set, and never flags an unedited leg", () => {
    const cylinders = cylindersFor(caveDraft);
    const edited = withCylinderAccess(leg, cylinderUsedBy(cylinders, "deco-o2"), false, cylinders);
    expect(edited.setGasKeys).toEqual(["bottom", "deco-50", "deco-o2"]);
    expect(unsetGasNotices([edited], cylinders)).toEqual([]);
    expect(unsetGasNotices([leg], cylindersFor({ ...withAdded, travelGasEnabled: true }))).toEqual([]);
  });

  it("warns once per edited leg for each gas that joined later, without changing the cave input", () => {
    const withoutEan50 = withDecoIncluded(caveDraft, "deco-50", false);
    const listed = cylindersFor(withoutEan50);
    const edited = withCylinderAccess(leg, cylinderUsedBy(listed, "deco-o2"), false, listed);
    // EAN50 switched back on, a travel gas turned on, and EAN80 added.
    const later = cylindersFor({ ...withAdded, travelGasEnabled: true });
    expect(unsetRouteCylinders(edited, later).map((cylinder) => cylinder.id))
      .toEqual(["plan-cylinder-travel", "plan-cylinder-deco-50", "plan-cylinder-deco-added"]);
    expect(unsetGasNotices([edited, { ...leg, id: "route-2" }], later)).toEqual([
      expect.objectContaining({ code: "ROUTE_GAS_ACCESS_UNSET", severity: "warning", cylinderId: "plan-cylinder-travel" }),
      expect.objectContaining({ code: "ROUTE_GAS_ACCESS_UNSET", severity: "warning", cylinderId: "plan-cylinder-deco-50" }),
      {
        code: "ROUTE_GAS_ACCESS_UNSET",
        severity: "warning",
        message: "Deco gas EAN80 (“EAN80 cylinder”) joined the plan after the cylinders on leg route-1 were set, so that leg treats it as not carried. Tick it on the leg if you carry it there, or keep it not carried.",
        field: "route.0.accessibleCylinderIds",
        cylinderId: "plan-cylinder-deco-added",
      },
    ]);
    expect(accessibleIds([edited], later)).toEqual([["plan-cylinder-bottom"]]);
  });

  it("clears a notice when the gas is ticked, unticked, or kept not carried", () => {
    const cylinders = cylindersFor(caveDraft);
    const edited = withCylinderAccess(leg, cylinderUsedBy(cylinders, "deco-o2"), false, cylinders);
    const addedCylinders = cylindersFor(withAdded);
    const ean80 = cylinderUsedBy(addedCylinders, "deco-added");
    expect(unsetGasNotices([edited], addedCylinders)).toHaveLength(1);

    const ticked = withCylinderAccess(edited, ean80, true, addedCylinders);
    expect(unsetGasNotices([ticked], addedCylinders)).toEqual([]);
    expect(routeCylinderAccess(ticked, ean80)).toBe("accessible");
    const unticked = withCylinderAccess(ticked, ean80, false, addedCylinders);
    expect(unsetGasNotices([unticked], addedCylinders)).toEqual([]);
    expect(routeCylinderAccess(unticked, ean80)).toBe("inaccessible");

    const kept = withUnsetGasesKept(edited, addedCylinders);
    expect(unsetGasNotices([kept], addedCylinders)).toEqual([]);
    // Keeping a gas not carried changes nothing the calculation sees, so a current result stays current.
    expect(JSON.stringify(normalizeCaveRoute([kept], addedCylinders))).toBe(JSON.stringify(normalizeCaveRoute([edited], addedCylinders)));
    expect(withUnsetGasesKept(leg, addedCylinders)).toBe(leg);
  });

  it("keeps a gas set while it is switched off, and flags the other breathing mode's gases", () => {
    const cylinders = cylindersFor(caveDraft);
    const edited = withCylinderAccess(leg, cylinderUsedBy(cylinders, "deco-o2"), false, cylinders);
    expect(unsetGasNotices([edited], cylindersFor(withDecoIncluded(caveDraft, "deco-50", false)))).toEqual([]);
    expect(unsetGasNotices([edited], cylinders)).toEqual([]);
    expect(unsetGasNotices([edited], cylindersFor({ ...caveDraft, mode: "ccr" })).map((item) => item.cylinderId))
      .toEqual(["plan-cylinder-diluent", "plan-cylinder-bailout-bottom", "plan-cylinder-bailout-50"]);
  });

  it("leaves a cylinder used by several gases to its blocking error", () => {
    const sourced = withSource(caveDraft, "bottom", backGas.id);
    const sourcedCylinders = cylindersFor(sourced);
    const edited = withCylinderAccess(leg, cylinderUsedBy(sourcedCylinders, "deco-o2"), false, sourcedCylinders);
    // EAN80 is added on the record the bottom gas already uses.
    const shared = cylindersFor(withSource({ ...sourced, decoGases: [...sourced.decoGases, added] }, "deco-added", backGas.id));
    expect(normalizeCaveRoute([edited], shared).ok).toBe(false);
    expect(unsetGasNotices([edited], shared)).toEqual([]);
    expect(withUnsetGasesKept(edited, shared).setGasKeys).not.toContain("deco-added");
  });
});
