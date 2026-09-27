import { describe, expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV } from "../domain/defaults";
import type { Gas, OcDiveInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { validateDiveInput } from "../domain/validation";
import { resolveDepthEntry } from "./helpers";
import { PLAN_STOP_INCREMENT_M } from "./planning";
import {
  draftStateFromRecord,
  EMPTY_TANK_BANK_DRAFT,
  modSwitchDepthM,
  tankBankDraftModM,
  toTankDraft,
  validateTankBankDraft,
  type TankBankDraftState,
} from "./tankBankDraft";
import type { TankRecord } from "../storage/types";

function record(overrides: Partial<TankRecord> & { gas?: Partial<TankRecord["gas"]> } = {}): TankRecord {
  const { gas: gasOverrides, ...rest } = overrides;
  return {
    id: "tank-1",
    name: "Oxygen stage",
    waterVolumeL: liters(11.1),
    workingPressureBar: barGauge(207),
    currentPressureBar: barGauge(200),
    minimumPressureBar: barGauge(35),
    maximumPPO2: barAbsolute(1.6),
    role: "deco",
    revision: 1,
    archived: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
    gas: {
      id: "oxygen",
      name: "Oxygen",
      oxygen: fraction(1),
      helium: fraction(0),
      role: "deco",
      switchDepthM: meters(6),
      ...gasOverrides,
    },
  };
}

describe("tank bank switch-depth form mapping", () => {
  it("round-trips a deco record's switch depth in metres", () => {
    const source = record();
    const draft = draftStateFromRecord(source);
    expect(draft.switchDepthM).toBe(6);
    const saved = toTankDraft(draft, source);
    expect(saved.gas.switchDepthM).toBe(6);
    expect(saved.gas.role).toBe("deco");
  });

  it("removes switch depth when the role changes to bottom", () => {
    const draft: TankBankDraftState = {
      ...EMPTY_TANK_BANK_DRAFT,
      role: "deco",
      oxygen: 100,
      gasName: "Oxygen",
      switchDepthM: 6,
    };
    expect(toTankDraft(draft).gas.switchDepthM).toBe(6);
    const asBottom = toTankDraft({ ...draft, role: "bottom", switchDepthM: undefined });
    expect(asBottom.gas.switchDepthM).toBeUndefined();
    // Even if a stale form value remained, a non-deco/bailout role must strip it.
    expect(toTankDraft({ ...draft, role: "bottom" }).gas.switchDepthM).toBeUndefined();
  });

  it("stores a 20 ft feet entry as the 6 m stop", () => {
    const stored = resolveDepthEntry(20, "imperial", { bound: "max-ppo2", gridM: PLAN_STOP_INCREMENT_M });
    expect(stored).toBe(6);
    const draft: TankBankDraftState = {
      ...EMPTY_TANK_BANK_DRAFT,
      role: "deco",
      oxygen: 100,
      maximumPPO2: 1.6,
      gasName: "Oxygen",
      switchDepthM: stored,
    };
    expect(toTankDraft(draft).gas.switchDepthM).toBeCloseTo(6, 6);
    expect(validateTankBankDraft(draft)).toEqual([]);
  });

  it("rejects a switch depth deeper than the MOD", () => {
    const draft: TankBankDraftState = {
      ...EMPTY_TANK_BANK_DRAFT,
      role: "deco",
      oxygen: 100,
      maximumPPO2: 1.6,
      gasName: "Oxygen",
      switchDepthM: 21,
    };
    expect(validateTankBankDraft(draft)).toContain(
      "Switch depth must not be deeper than the MOD at this maximum PPO₂.",
    );
  });

  it("rejects a switch depth when MOD cannot be calculated", () => {
    const draft: TankBankDraftState = {
      ...EMPTY_TANK_BANK_DRAFT,
      role: "bailout",
      oxygen: 21,
      // Below surface PPO₂ for air, so calculateMOD fails with MOD_BELOW_SURFACE.
      maximumPPO2: 0.1,
      gasName: "Air bailout",
      switchDepthM: 6,
    };
    expect(validateTankBankDraft(draft)).toContain(
      "Switch depth cannot be validated without a calculable MOD at this maximum PPO₂.",
    );
  });

  it("round-trips a bailout record's switch depth and strips it when the role changes", () => {
    const source = record({
      name: "Bailout 50",
      role: "bailout",
      gas: { id: "ean50", name: "EAN50", oxygen: fraction(0.5), helium: fraction(0), role: "bailout", switchDepthM: meters(21) },
    });
    const draft = draftStateFromRecord(source);
    expect(draft.role).toBe("bailout");
    expect(draft.switchDepthM).toBe(21);
    expect(toTankDraft(draft, source).gas.switchDepthM).toBe(21);
    expect(validateTankBankDraft(draft)).toEqual([]);
    expect(toTankDraft({ ...draft, role: "diluent" }).gas.switchDepthM).toBeUndefined();
  });
});

describe("modSwitchDepthM (Use MOD)", () => {
  /** Whether the planner accepts a deco gas switching at this depth on a cylinder with this maximum PPO₂. */
  function plannerAccepts(oxygenPercent: number, maximumPPO2: number, switchDepthM: number): boolean {
    const gas: Gas = {
      id: "deco",
      name: "Deco",
      oxygen: fraction(oxygenPercent / 100),
      helium: fraction(0),
      role: "deco",
      switchDepthM: meters(switchDepthM),
      cylinderId: "deco-cylinder",
    };
    const input: OcDiveInput = {
      mode: "oc",
      environment: "open-water",
      depthM: meters(40),
      bottomTimeSeconds: seconds(20 * 60),
      bottomGas: { ...AIR, id: "air" },
      decoGases: [gas],
      cylinders: [{
        id: "deco-cylinder",
        name: "Deco cylinder",
        waterVolumeL: liters(11.1),
        workingPressureBar: barGauge(207),
        currentPressureBar: barGauge(200),
        gas,
        maximumPPO2: barAbsolute(maximumPPO2),
        revision: 1,
      }],
      settings: DEFAULT_PLANNER_SETTINGS,
      environmentSettings: DEFAULT_ENVIRONMENT,
      rmv: DEFAULT_RMV,
      reservePolicy: DEFAULT_RESERVE_POLICY,
    };
    const result = validateDiveInput(input);
    const errors = result.ok ? [] : result.errors;
    return !errors.some((item) => item.code === "CYLINDER_PPO2_LIMIT_EXCEEDED" || item.code === "GAS_PPO2_LIMIT_EXCEEDED");
  }

  it("keeps oxygen on its stop and rounds other MODs down to 0.1 m", () => {
    expect(modSwitchDepthM({ oxygen: 100, maximumPPO2: 1.6 })).toBe(6);
    expect(modSwitchDepthM({ oxygen: 50, maximumPPO2: 1.6 })).toBe(22);
    expect(modSwitchDepthM({ oxygen: 32, maximumPPO2: 1.4 })).toBe(33.7);
    expect(modSwitchDepthM({ oxygen: 32, maximumPPO2: 0 })).toBeUndefined();
  });

  it("fills a value the planner accepts where the raw MOD is rejected (EAN32 at 1.4 bar)", () => {
    const rawM = tankBankDraftModM({ oxygen: 32, maximumPPO2: 1.4 })!;
    expect(plannerAccepts(32, 1.4, rawM)).toBe(false);
    expect(plannerAccepts(32, 1.4, modSwitchDepthM({ oxygen: 32, maximumPPO2: 1.4 })!)).toBe(true);
  });

  it("never exceeds the MOD and is always accepted by the planner", () => {
    for (let oxygen = 21; oxygen <= 100; oxygen += 1) {
      for (const maximumPPO2 of [1.2, 1.3, 1.4, 1.45, 1.5, 1.55, 1.6]) {
        const rawM = tankBankDraftModM({ oxygen, maximumPPO2 })!;
        const filledM = modSwitchDepthM({ oxygen, maximumPPO2 })!;
        expect(filledM, `${oxygen}% at ${maximumPPO2} bar`).toBeLessThanOrEqual(rawM + 1e-9);
        expect(rawM - filledM, `${oxygen}% at ${maximumPPO2} bar`).toBeLessThan(0.1 + 1e-9);
        expect(plannerAccepts(oxygen, maximumPPO2, filledM), `${oxygen}% at ${maximumPPO2} bar`).toBe(true);
      }
    }
  });
});
