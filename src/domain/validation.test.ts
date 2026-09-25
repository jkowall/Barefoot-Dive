import { describe, expect, it } from "vitest";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
} from "./defaults";
import type { CcrDiveInput, Cylinder, OcDiveInput } from "./types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "./units";
import { validateDiveInput } from "./validation";

function input(): OcDiveInput {
  return {
    mode: "oc",
    environment: "open-water",
    depthM: meters(30),
    bottomTimeSeconds: seconds(20 * 60),
    bottomGas: AIR,
    decoGases: [],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
  };
}

describe("complete normalized-plan validation", () => {
  it("rejects invalid environment, RMV, reserve, and cylinder dimensions", () => {
    const cylinder: Cylinder = {
      id: "bad-cylinder",
      name: "Bad cylinder",
      waterVolumeL: liters(0),
      workingPressureBar: barGauge(200),
      currentPressureBar: barGauge(Number.NaN),
      gas: AIR,
      maximumPPO2: barAbsolute(1.4),
      revision: 1,
    };
    const result = validateDiveInput({
      ...input(),
      cylinders: [cylinder],
      environmentSettings: { ...DEFAULT_ENVIRONMENT, surfacePressureBar: barAbsolute(0) },
      rmv: { ...DEFAULT_RMV, bottomLpm: 0 as typeof DEFAULT_RMV.bottomLpm },
      reservePolicy: { kind: "custom", reserveVolumeL: liters(-1) },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = new Set(result.errors.map((item) => item.code));
    for (const code of [
      "SURFACE_PRESSURE_INVALID",
      "RMV_INVALID",
      "RESERVE_INVALID",
      "CYLINDER_VALUE_INVALID",
      "CYLINDER_PRESSURE_INVALID",
    ]) expect(codes.has(code)).toBe(true);
  });

  it("rejects a CCR bailout trigger outside at-depth time", () => {
    const diluent = {
      id: "diluent",
      name: "Tx18/45",
      oxygen: fraction(0.18),
      helium: fraction(0.45),
      role: "diluent" as const,
    };
    const ccr: CcrDiveInput = {
      ...input(),
      mode: "ccr",
      diluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [{ ...diluent, id: "bailout", role: "bailout" }],
      bailoutTriggerSecondsAtDepth: seconds(21 * 60),
    };
    const result = validateDiveInput(ccr);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "CCR_BAILOUT_TRIGGER_INVALID")).toBe(true);
  });

  it("enforces a uniquely matching cylinder PPO2 limit without an explicit cylinder ID", () => {
    const ean50 = {
      id: "ean50",
      name: "EAN50",
      oxygen: fraction(0.5),
      helium: fraction(0),
      role: "deco" as const,
      switchDepthM: meters(21),
    };
    const result = validateDiveInput({
      ...input(),
      decoGases: [ean50],
      cylinders: [{
        id: "ean50-cylinder",
        name: "EAN50 stage",
        waterVolumeL: liters(11),
        workingPressureBar: barGauge(200),
        currentPressureBar: barGauge(200),
        gas: ean50,
        maximumPPO2: barAbsolute(1.4),
        revision: 1,
      }],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "CYLINDER_PPO2_LIMIT_EXCEEDED")).toBe(true);
  });

  it("rejects an OC bottom gas above both plan and assigned-cylinder PPO2 limits", () => {
    const hotBottom = { ...AIR, id: "hot-bottom", name: "Hot bottom", oxygen: fraction(0.5), cylinderId: "hot-cylinder" };
    const result = validateDiveInput({
      ...input(), bottomGas: hotBottom,
      cylinders: [{ id: "hot-cylinder", name: "Hot cylinder", waterVolumeL: liters(12), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: hotBottom, maximumPPO2: barAbsolute(1.4), revision: 1 }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "BOTTOM_PPO2_LIMIT_EXCEEDED")).toBe(true);
    expect(result.errors.some((item) => item.code === "CYLINDER_PPO2_LIMIT_EXCEEDED")).toBe(true);
  });

  it("enforces the travel cylinder PPO2 limit across the full descent interval", () => {
    const bottom = { ...AIR, id: "travel-bottom", switchDepthM: meters(21) };
    const travel = { ...AIR, id: "travel-air", role: "travel" as const, cylinderId: "travel-cylinder" };
    const result = validateDiveInput({
      ...input(),
      bottomGas: bottom,
      travelGas: travel,
      cylinders: [{
        id: "travel-cylinder",
        name: "Restricted travel cylinder",
        waterVolumeL: liters(11),
        workingPressureBar: barGauge(200),
        currentPressureBar: barGauge(200),
        gas: travel,
        maximumPPO2: barAbsolute(0.6),
        revision: 1,
      }],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "TRAVEL_GAS_OPERATING_RANGE")).toBe(true);
    expect(result.errors.some((item) => item.code === "CYLINDER_PPO2_LIMIT_EXCEEDED")).toBe(true);
  });

  it("rejects a CCR setpoint above the configured maximum PPO2", () => {
    const diluent = { ...AIR, id: "ccr-diluent", role: "diluent" as const };
    const bailout = { ...AIR, id: "ccr-bailout", role: "bailout" as const };
    const result = validateDiveInput({ ...input(), mode: "ccr", depthM: meters(30), diluent, setpointBar: barAbsolute(1.5), setpointActivationDepthM: meters(6), bailoutGases: [bailout], bailoutTriggerSecondsAtDepth: seconds(60) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((item) => item.code === "CCR_SETPOINT_LIMIT_EXCEEDED")).toBe(true);
  });
});

describe("deco RMV boundary validation", () => {
  const codes = (candidate: unknown): readonly string[] => {
    const result = validateDiveInput(candidate as OcDiveInput);
    return result.ok ? [] : result.errors.map((item) => item.code);
  };

  it("accepts first-stop on open-water OC and rejects other values and contexts", () => {
    expect(validateDiveInput({ ...input(), decoRmvFrom: "first-stop" }).ok).toBe(true);
    expect(codes({ ...input(), decoRmvFrom: "end-of-bottom" })).toContain("DECO_RMV_BOUNDARY_INVALID");
    expect(codes({ ...input(), environment: "cave", decoRmvFrom: "first-stop" }))
      .toContain("DECO_RMV_BOUNDARY_CAVE_UNSUPPORTED");
    const diluent = { id: "diluent", name: "Air", oxygen: fraction(0.21), helium: fraction(0), role: "diluent" as const };
    expect(codes({
      ...input(),
      mode: "ccr",
      diluent,
      setpointBar: barAbsolute(1.3),
      setpointActivationDepthM: meters(6),
      bailoutGases: [{ ...diluent, id: "bailout", role: "bailout" }],
      decoRmvFrom: "first-stop",
    })).toContain("DECO_RMV_BOUNDARY_OC_ONLY");
  });
});
