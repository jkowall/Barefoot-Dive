import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RMV,
  EAN50,
  OXYGEN,
} from "../domain/defaults";
import type { Cylinder, DivePlan, Gas, GasLedgerEntry, OcDiveInput, ReservePolicy } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import { calculateDivePlan } from "../engine/planner";

const bottom: Gas = { id: "tx18-45", name: "Tx18/45", oxygen: fraction(0.18), helium: fraction(0.45), role: "bottom" };

function gasOnlyInput(reservePolicy: ReservePolicy, overrides: Partial<OcDiveInput> = {}): OcDiveInput {
  return {
    mode: "oc",
    environment: "open-water",
    depthM: meters(45),
    bottomTimeSeconds: seconds(25 * 60),
    bottomGas: bottom,
    decoGases: [EAN50, OXYGEN],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy,
    gasOnly: true,
    ...overrides,
  };
}

function withCylinders(input: OcDiveInput): OcDiveInput {
  const assign = (gas: Gas): Gas => ({ ...gas, cylinderId: `cyl-${gas.id}` });
  const gases = [input.bottomGas, ...input.decoGases].map(assign);
  const cylinders: Cylinder[] = gases.map((gas) => ({
    id: gas.cylinderId!,
    name: `${gas.name} cylinder`,
    waterVolumeL: liters(12),
    workingPressureBar: barGauge(232),
    currentPressureBar: barGauge(220),
    gas,
    maximumPPO2: barAbsolute(1.6),
    revision: 1,
  }));
  const { gasOnly: _ignored, ...rest } = input;
  void _ignored;
  return { ...rest, bottomGas: gases[0], decoGases: gases.slice(1), cylinders };
}

function plan(input: OcDiveInput): { value: DivePlan; warnings: readonly string[] } {
  const result = calculateDivePlan(input);
  if (!result.ok) throw new Error(result.errors.map((item) => item.code).join(", "));
  return { value: result.value, warnings: result.warnings.map((item) => item.code) };
}

const byGas = (entries: readonly GasLedgerEntry[], gasId: string) => entries.find((entry) => entry.gasId === gasId)!;

describe("gas-only planning ledger", () => {
  it("reports the same used volume as cylinder planning for the same profile", () => {
    const gasOnly = plan(gasOnlyInput({ kind: "thirds" })).value;
    const cylinders = plan(withCylinders(gasOnlyInput({ kind: "thirds" }))).value;
    for (const gas of [bottom, EAN50, OXYGEN]) {
      expect(byGas(gasOnly.gasLedger, gas.id).totalUsedL).toBeCloseTo(byGas(cylinders.gasLedger, gas.id).totalUsedL, 9);
    }
    expect(gasOnly.segments).toEqual(cylinders.segments);
  });

  it.each([
    [{ kind: "thirds" } as ReservePolicy, 1.5],
    [{ kind: "sixths" } as ReservePolicy, 3],
  ])("inverts the %o cylinder rule into a volume to carry", (policy, multiplier) => {
    const { value } = plan(gasOnlyInput(policy));
    for (const entry of value.gasLedger) {
      expect(entry.gasOnly).toBe(true);
      expect(entry.cylinderId).toBeUndefined();
      expect(entry.requiredVolumeL).toBeCloseTo(entry.totalUsedL * multiplier, 9);
      expect(entry.reserveL).toBeCloseTo(entry.totalUsedL * (multiplier - 1), 9);
      expect(entry.sufficient).toBe(false);
      expect(entry.remainingVolumeL).toBeUndefined();
    }
  });

  it("adds a custom reserve volume to every gas", () => {
    const { value } = plan(gasOnlyInput({ kind: "custom", reserveVolumeL: liters(500) }));
    for (const entry of value.gasLedger) {
      expect(entry.requiredVolumeL).toBeCloseTo(entry.totalUsedL + 500, 9);
    }
  });

  it("computes a per-gas rock-bottom reserve equal to the cylinder-mode reserve", () => {
    const policy: ReservePolicy = { kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(40) };
    const gasOnly = plan(gasOnlyInput(policy)).value;
    const cylinders = plan(withCylinders(gasOnlyInput(policy))).value;
    for (const gas of [bottom, EAN50, OXYGEN]) {
      const cylinderEntry = byGas(cylinders.gasLedger, gas.id);
      const gasEntry = byGas(gasOnly.gasLedger, gas.id);
      expect(gasEntry.reserveL).toBeCloseTo(cylinderEntry.reserveL!, 9);
      expect(gasEntry.requiredVolumeL).toBeCloseTo(gasEntry.totalUsedL + cylinderEntry.reserveL!, 9);
    }
  });

  it("explains what is not checked and drops the unassigned-cylinder warnings", () => {
    const { value } = plan(gasOnlyInput({ kind: "thirds" }));
    const codes = value.diagnostics.map((item) => item.code);
    expect(codes).toContain("GAS_ONLY_VOLUMES");
    expect(codes).not.toContain("CYLINDER_UNASSIGNED");
    expect(value.diagnostics.find((item) => item.code === "GAS_ONLY_VOLUMES")?.severity).toBe("info");
    const { gasOnly: _ignored, ...cylinderless } = gasOnlyInput({ kind: "thirds" });
    void _ignored;
    expect(plan(cylinderless).value.diagnostics.map((item) => item.code)).toContain("CYLINDER_UNASSIGNED");
  });

  it("keeps a per-gas maximum PPO₂ for deco switches when no cylinder carries it", () => {
    const decoOnly: Gas = { ...EAN50, switchDepthM: undefined, maximumPPO2: barAbsolute(1.4) };
    const { value } = plan(gasOnlyInput({ kind: "thirds" }, { decoGases: [decoOnly] }));
    const switchSegment = value.segments.find((segment) => segment.kind === "gas-switch" && segment.gasId === EAN50.id)!;
    expect(switchSegment.startDepthM).toBeLessThanOrEqual((1.4 / 0.5 - 1) * 10 + 1e-9);
    const unlimited = plan(gasOnlyInput({ kind: "thirds" }, { decoGases: [{ ...decoOnly, maximumPPO2: undefined }] })).value;
    expect(unlimited.segments.find((segment) => segment.kind === "gas-switch" && segment.gasId === EAN50.id)!.startDepthM)
      .toBeGreaterThan(switchSegment.startDepthM);
  });

  it("warns when rock bottom leaves a travel gas with no reserve", () => {
    const travel: Gas = { id: "travel-air", name: "Travel air", oxygen: fraction(0.21), helium: fraction(0), role: "travel" };
    const policy: ReservePolicy = { kind: "rock-bottom", teamSize: 2, stressedRmvLpm: litersPerMinute(40) };
    const { value, warnings } = plan(gasOnlyInput(policy, { bottomGas: { ...bottom, switchDepthM: meters(21) }, travelGas: travel }));
    const entry = byGas(value.gasLedger, "travel-air");
    expect(entry.totalUsedL).toBeGreaterThan(0);
    expect(entry.reserveL).toBe(0);
    expect(entry.requiredVolumeL).toBeCloseTo(entry.totalUsedL, 9);
    const zero = value.diagnostics.filter((item) => item.code === "GAS_ONLY_RESERVE_ZERO");
    expect(zero.map((item) => item.gasId)).toEqual(["travel-air"]);
    expect(zero[0].severity).toBe("warning");
    expect(warnings).toContain("GAS_ONLY_RESERVE_ZERO");
    expect(plan(gasOnlyInput({ kind: "thirds" }, { bottomGas: { ...bottom, switchDepthM: meters(21) }, travelGas: travel })).warnings)
      .not.toContain("GAS_ONLY_RESERVE_ZERO");
  });

  it("rejects a per-gas maximum PPO₂ on a cylinder plan, where the cylinder carries the limit", () => {
    const cylinderPlan = withCylinders(gasOnlyInput({ kind: "thirds" }));
    const result = calculateDivePlan({ ...cylinderPlan, bottomGas: { ...cylinderPlan.bottomGas, maximumPPO2: barAbsolute(1.2) } });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.find((item) => item.code === "GAS_MAXIMUM_PPO2_REQUIRES_GAS_ONLY")?.field).toBe("gases.0.maximumPPO2");
  });

  it.each([
    [gasOnlyInput({ kind: "fixed", minimumPressureBar: barGauge(35) }), "GAS_ONLY_RESERVE_POLICY"],
    [withCylinders(gasOnlyInput({ kind: "thirds" })), undefined],
    [{ ...gasOnlyInput({ kind: "thirds" }), bottomGas: { ...bottom, cylinderId: "stray" } }, "GAS_ONLY_CYLINDER_PRESENT"],
    [{ ...gasOnlyInput({ kind: "thirds" }), environment: "cave" as const }, "GAS_ONLY_CAVE_UNSUPPORTED"],
    [{ ...gasOnlyInput({ kind: "thirds" }), bottomGas: { ...bottom, maximumPPO2: barAbsolute(1.7) } }, "GAS_MAXIMUM_PPO2_INVALID"],
  ])("validates gas-only inputs (%#)", (input, code) => {
    const result = calculateDivePlan(input);
    if (code === undefined) {
      expect(result.ok).toBe(true);
      return;
    }
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.map((item) => item.code)).toContain(code);
  });
});
