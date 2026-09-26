import { describe, expect, it } from "vitest";
import {
  AIR,
  DEFAULT_ENVIRONMENT,
  DEFAULT_PLANNER_SETTINGS,
  DEFAULT_RESERVE_POLICY,
  DEFAULT_RMV,
  OXYGEN,
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

function ccrInput(overrides: Partial<CcrDiveInput> = {}): CcrDiveInput {
  return {
    mode: "ccr",
    environment: "open-water",
    depthM: meters(45),
    bottomTimeSeconds: seconds(30 * 60),
    diluent: { ...AIR, id: "dil", role: "diluent" },
    setpointBar: barAbsolute(1.3),
    setpointActivationDepthM: meters(6),
    bailoutGases: [{ ...AIR, id: "bo", role: "bailout" }],
    cylinders: [],
    settings: DEFAULT_PLANNER_SETTINGS,
    environmentSettings: DEFAULT_ENVIRONMENT,
    rmv: DEFAULT_RMV,
    reservePolicy: DEFAULT_RESERVE_POLICY,
    ...overrides,
  };
}

describe("limit diagnostics state the value and the limit", () => {
  const codes = (result: ReturnType<typeof validateDiveInput>) => [...(result.ok ? [] : result.errors), ...result.warnings].map((item) => item.code);
  const find = (result: ReturnType<typeof validateDiveInput>, code: string) =>
    [...(result.ok ? [] : result.errors), ...result.warnings].find((item) => item.code === code);

  it("prints the surface low-setpoint limit rounded down, so the printed value is accepted", () => {
    const rejected = validateDiveInput(ccrInput({ lowSetpointBar: barAbsolute(0.94) }));
    const diagnostic = find(rejected, "CCR_LOW_SETPOINT_NOT_ACHIEVABLE");
    expect(diagnostic?.message).toContain("at most 0.93 bar");
    expect(diagnostic).toMatchObject({ actual: 0.94 });
    expect(diagnostic?.limit).toBeCloseTo(0.9373, 10);
    expect(codes(validateDiveInput(ccrInput({ lowSetpointBar: barAbsolute(0.93) })))).not.toContain("CCR_LOW_SETPOINT_NOT_ACHIEVABLE");
  });

  it("reports oxygen at 20 ft (6.096 m) with its PPO₂ and the deco limit, and accepts the 6 m stop", () => {
    const at20ft = validateDiveInput({ ...input(), decoGases: [{ ...OXYGEN, switchDepthM: meters(6.096) }] });
    const diagnostic = find(at20ft, "DECO_SWITCH_UNBREATHABLE");
    expect(diagnostic?.message).toContain("1.610 bar");
    expect(diagnostic?.message).toContain("6.1 m");
    expect(diagnostic?.message).toContain("1.60 bar deco limit");
    expect(diagnostic?.actual).toBeCloseTo(1.6096, 10);
    expect(diagnostic).toMatchObject({ limit: 1.6, depthM: 6.096, gasId: OXYGEN.id });
    expect(codes(validateDiveInput({ ...input(), decoGases: [{ ...OXYGEN, switchDepthM: meters(6) }] }))).not.toContain("DECO_SWITCH_UNBREATHABLE");
  });

  it("reports the assigned cylinder's limit at the switch depth", () => {
    const oxygen = { ...OXYGEN, switchDepthM: meters(6.096), cylinderId: "o2" };
    const cylinder: Cylinder = { id: "o2", name: "O₂ stage", waterVolumeL: liters(7), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: oxygen, maximumPPO2: barAbsolute(1.6), revision: 1 };
    const diagnostic = find(validateDiveInput({ ...input(), decoGases: [oxygen], cylinders: [cylinder] }), "CYLINDER_PPO2_LIMIT_EXCEEDED");
    expect(diagnostic?.message).toContain("above the assigned cylinder's 1.60 bar maximum");
    expect(diagnostic).toMatchObject({ limit: 1.6, cylinderId: "o2", gasId: OXYGEN.id, depthM: 6.096 });
  });

  it("states the travel gas PPO₂, the limit, and the travel-to-bottom switch depth", () => {
    const tx1070 = { id: "tx10-70", name: "Tx10/70", oxygen: fraction(0.1), helium: fraction(0.7), role: "bottom" as const };
    const withTravel = (travel: OcDiveInput["travelGas"], switchDepthM: number): OcDiveInput =>
      ({ ...input(), depthM: meters(70), bottomGas: { ...tx1070, switchDepthM: meters(switchDepthM) }, travelGas: travel });
    // Air to a 60 m switch: 0.21 × 7.0 = 1.470 bar, above the 1.40 bar bottom limit that caps travel gas.
    const tooDeep = find(validateDiveInput(withTravel({ ...AIR, id: "travel-air", role: "travel" }, 60)), "TRAVEL_GAS_OPERATING_RANGE");
    expect(tooDeep?.message).toBe("Air reaches PPO₂ 1.470 bar at the 60.0 m travel-to-bottom switch, above the 1.40 bar travel-gas limit.");
    expect(tooDeep).toMatchObject({ depthM: 60, limit: 1.4, gasId: "travel-air" });
    expect(tooDeep?.actual).toBeCloseTo(1.47, 10);
    // A hypoxic travel gas: 0.10 bar at the surface.
    const hypoxic = find(validateDiveInput(withTravel({ ...tx1070, id: "travel-tx", role: "travel" }, 30)), "TRAVEL_GAS_OPERATING_RANGE");
    expect(hypoxic?.message).toBe("Tx10/70 is only PPO₂ 0.100 bar at the surface, below the 0.16 bar minimum, so it cannot be breathed from the surface to the 30.0 m travel-to-bottom switch.");
    expect(hypoxic).toMatchObject({ depthM: 30, limit: 0.16, gasId: "travel-tx" });
  });

  it("states the bottom gas PPO₂, the limit, and its switch depth", () => {
    const tx1070 = { id: "tx10-70", name: "Tx10/70", oxygen: fraction(0.1), helium: fraction(0.7), role: "bottom" as const };
    // Tx10/70 at a 3 m switch: 0.10 × 1.3 = 0.130 bar, below the 0.16 bar minimum.
    const shallow = find(validateDiveInput({ ...input(), depthM: meters(70), bottomGas: { ...tx1070, switchDepthM: meters(3) }, travelGas: { ...AIR, id: "travel-air", role: "travel" } }), "BOTTOM_SWITCH_UNBREATHABLE");
    expect(shallow?.message).toBe("Tx10/70 is only PPO₂ 0.130 bar at its 3.0 m switch depth, below the 0.16 bar minimum.");
    expect(shallow).toMatchObject({ depthM: 3, limit: 0.16, gasId: "tx10-70" });
    // Air as bottom gas switched to at 60 m: 1.470 bar, above the 1.40 bar bottom limit.
    const deep = find(validateDiveInput({ ...input(), depthM: meters(70), bottomGas: { ...AIR, switchDepthM: meters(60) }, travelGas: { id: "travel-32", name: "EAN32", oxygen: fraction(0.32), helium: fraction(0), role: "travel" } }), "BOTTOM_SWITCH_UNBREATHABLE");
    expect(deep?.message).toBe("Air reaches PPO₂ 1.470 bar at its 60.0 m switch depth, above the 1.40 bar bottom limit.");
    expect(deep).toMatchObject({ depthM: 60, limit: 1.4, gasId: "air" });
  });

  it("reports how far the loop can reach at an unachievable switch-up depth", () => {
    const diagnostic = find(validateDiveInput(ccrInput({ setpointActivationDepthM: meters(3) })), "CCR_SETPOINT_NOT_ACHIEVABLE");
    expect(diagnostic?.message).toContain("at the 3.0 m switch-up depth, where the loop reaches at most 1.23 bar");
    expect(diagnostic?.limit).toBeCloseTo(1.2373, 10);
  });

  it("lists every depth a switch-down warning prints, rounded on its safe side", () => {
    const diagnostic = find(validateDiveInput(ccrInput({ lowSetpointBar: barAbsolute(0.7), setpointDeactivationDepthM: meters(0) })), "CCR_SWITCH_DOWN_DEEPENED");
    expect(diagnostic?.message).toContain("shallower than 3.7 m, so the plan switches to the low setpoint at 3.7 m instead of 0.0 m");
    expect(diagnostic?.depthMentions?.map((mention) => mention.rounding)).toEqual(["up", "up", "nearest"]);
  });
});
