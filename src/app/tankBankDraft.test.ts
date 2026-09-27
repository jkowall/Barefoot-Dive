import { describe, expect, it } from "vitest";
import { barAbsolute, barGauge, fraction, liters, meters } from "../domain/units";
import { resolveDepthEntry } from "./helpers";
import { PLAN_STOP_INCREMENT_M } from "./planning";
import {
  draftStateFromRecord,
  EMPTY_TANK_BANK_DRAFT,
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
});
