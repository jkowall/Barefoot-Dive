import { describe, expect, it } from "vitest";
import { capacityInputValue, depthInputStep, depthInputValue, formatDepthBound, formatPressure, formatSurfaceGas, formatSurfaceGasRate, pressureFromCanonical, pressureInputStep, pressureInputToCanonical, pressureInputValue, pressureToCanonical, ratedCapacityFromCanonical, surfaceGasInputStep, surfaceGasInputToCanonical, surfaceGasInputValue, surfaceGasRateInputStep, surfaceGasRateInputToCanonical, surfaceGasRateInputValue, surfaceGasRateUnit, surfaceGasUnit, resolveDepthEntry, waterVolumeFromRatedCapacity } from "./helpers";

describe("rated cylinder capacity conversions", () => {
  it("round-trips imperial rated cubic feet using working pressure", () => {
    const capacity = ratedCapacityFromCanonical(24, 232, "imperial");
    expect(capacity).toBeCloseTo(196.632, 2);
    expect(waterVolumeFromRatedCapacity(capacity, 232, "imperial")).toBeCloseTo(24, 10);
    expect(capacityInputValue(24, 232, "imperial")).toBe(196.6);
  });

  it("round-trips metric rated liters and rejects non-positive pressure", () => {
    const capacity = ratedCapacityFromCanonical(12, 200, "metric");
    expect(capacity).toBe(12);
    expect(waterVolumeFromRatedCapacity(capacity, 200, "metric")).toBe(12);
    expect(capacityInputValue(10.5, 200, "metric")).toBe(10.5);
    expect(waterVolumeFromRatedCapacity(2400, 0, "metric")).toBeNaN();
  });
});

describe("pressure presentation", () => {
  it("uses whole-number PSI and one-decimal bar at the UI boundary", () => {
    expect(pressureInputValue(232, "psi")).toBe(3365);
    expect(pressureInputValue(35, "psi")).toBe(508);
    expect(formatPressure(232, "psi")).toBe("3365 psi");
    expect(formatPressure(232, "psi", 2)).toBe("3365 psi");
    expect(formatPressure(232, "bar")).toBe("232.0 bar");
    expect(pressureInputStep("psi")).toBe(1);
    expect(pressureInputStep("bar")).toBe(0.1);
  });

  it("retains precise canonical bar values for whole PSI input", () => {
    const canonical = pressureToCanonical(3000, "psi");
    expect(canonical).toBeCloseTo(206.8427184, 7);
    expect(pressureFromCanonical(canonical, "psi")).toBeCloseTo(3000, 10);
    expect(pressureInputValue(canonical, "psi")).toBe(3000);
  });

  it("preserves an exact canonical value when its rounded display value is re-entered", () => {
    expect(pressureInputToCanonical(3365, "psi", [232])).toBe(232);
    expect(pressureInputToCanonical(3000.5, "psi")).toBeCloseTo(pressureToCanonical(3001, "psi"), 12);
    expect(pressureInputToCanonical(232.04, "bar")).toBe(232);
    expect(pressureInputToCanonical(232.06, "bar")).toBe(232.1);
  });
});

describe("surface gas presentation", () => {
  it("uses capacity preferences for volume units and rounded input values", () => {
    expect(surfaceGasUnit("imperial")).toBe("ft³");
    expect(surfaceGasUnit("metric")).toBe("L");
    expect(surfaceGasInputValue(100, "imperial")).toBe(3.5);
    expect(surfaceGasInputValue(100, "metric")).toBe(100);
    expect(surfaceGasInputStep("imperial")).toBe(0.1);
    expect(surfaceGasInputStep("metric")).toBe(1);
    expect(formatSurfaceGas(100, "imperial")).toBe("3.5 ft³");
    expect(formatSurfaceGas(100, "metric")).toBe("100 L");
  });

  it("preserves an equivalent canonical volume when rounded input is re-entered", () => {
    expect(surfaceGasInputToCanonical(3.5, "imperial", [100])).toBe(100);
    expect(surfaceGasInputToCanonical(3.56, "imperial")).toBeCloseTo(3.6 * 28.316846592, 10);
    expect(surfaceGasInputToCanonical(100.4, "metric")).toBe(100);
  });

  it("formats and round-trips rates using the same capacity preference", () => {
    expect(surfaceGasRateUnit("imperial")).toBe("ft³/min");
    expect(surfaceGasRateUnit("metric")).toBe("L/min");
    expect(surfaceGasRateInputValue(20, "imperial")).toBe(0.71);
    expect(surfaceGasRateInputValue(20, "metric")).toBe(20);
    expect(surfaceGasRateInputStep("imperial")).toBe(0.01);
    expect(surfaceGasRateInputStep("metric")).toBe(0.1);
    expect(formatSurfaceGasRate(20, "imperial")).toBe("0.71 ft³/min");
    expect(formatSurfaceGasRate(20, "metric")).toBe("20.0 L/min");
    expect(surfaceGasRateInputToCanonical(0.71, "imperial", [20])).toBe(20);
    expect(surfaceGasRateInputToCanonical(20.04, "metric")).toBe(20);
  });

  it("accepts two-decimal ft³/min SAC rates such as 0.55", () => {
    const canonical = surfaceGasRateInputToCanonical(0.55, "imperial");
    expect(canonical).toBeCloseTo(0.55 * 28.316846592, 10);
    expect(surfaceGasRateInputValue(canonical, "imperial")).toBe(0.55);
  });
});

describe("depth entry", () => {
  it("shows whole feet and one-decimal metres", () => {
    expect(depthInputValue(6, "imperial")).toBe(20);
    expect(depthInputValue(21, "imperial")).toBe(69);
    expect(depthInputValue(21.336, "imperial")).toBe(70);
    expect(depthInputValue(21.336, "metric")).toBe(21.3);
    expect(depthInputStep("imperial")).toBe(1);
    expect(depthInputStep("metric")).toBe(0.1);
  });

  it("keeps the stored depth when its displayed value is retyped", () => {
    expect(resolveDepthEntry(20, "imperial", { focusM: 6 })).toBe(6);
    expect(resolveDepthEntry(69, "imperial", { focusM: 21 })).toBe(21);
    expect(resolveDepthEntry(21.3, "metric", { focusM: 21.336 })).toBe(21.336);
    // A different value converts exactly.
    expect(resolveDepthEntry(21, "imperial", { focusM: 6 })).toBeCloseTo(21 / 3.280839895, 9);
  });

  it.each([
    [20, 6],
    [30, 9],
    [10, 3],
    [69, 21],
  ])("aligns a %d ft deco switch with the %d m stop", (feet, metres) => {
    expect(resolveDepthEntry(feet, "imperial", { bound: "max-ppo2" })).toBe(metres);
  });

  it("never moves a deco switch deeper than the typed depth", () => {
    expect(resolveDepthEntry(70, "imperial", { bound: "max-ppo2" })).toBeCloseTo(70 / 3.280839895, 9);
    expect(resolveDepthEntry(19, "imperial", { bound: "max-ppo2" })).toBeCloseTo(19 / 3.280839895, 9);
    for (let feet = 0; feet <= 330; feet += 1) {
      const resolved = resolveDepthEntry(feet, "imperial", { bound: "max-ppo2" });
      expect(resolved).toBeLessThanOrEqual(feet / 3.280839895 + 1e-9);
      expect(depthInputValue(resolved, "imperial")).toBe(feet);
    }
  });

  it("aligns to the active stop grid", () => {
    expect(resolveDepthEntry(20, "imperial", { bound: "max-ppo2", gridM: 3.048 })).toBeCloseTo(6.096, 9);
    expect(resolveDepthEntry(20, "imperial", { bound: "setpoint-switch", gridM: 3.048 })).toBeCloseTo(6.096, 9);
    expect(resolveDepthEntry(40, "imperial", { bound: "setpoint-switch", gridM: 3.048 })).toBeCloseTo(12.192, 9);
  });

  it("never aliases a travel-to-bottom switch or a free depth", () => {
    expect(resolveDepthEntry(20, "imperial", { bound: "min-ppo2" })).toBeCloseTo(6.096, 9);
    expect(resolveDepthEntry(20, "imperial")).toBeCloseTo(6.096, 9);
    expect(resolveDepthEntry(6, "metric", { bound: "max-ppo2" })).toBe(6);
    expect(resolveDepthEntry(5.9, "metric", { bound: "max-ppo2" })).toBe(5.9);
  });

  it("prints depth limits on their safe side", () => {
    expect(formatDepthBound(33.75, "imperial", "upper")).toBe("110 ft");
    expect(formatDepthBound(33.75, "metric", "upper")).toBe("33 m");
    expect(formatDepthBound(30.2, "metric", "lower")).toBe("31 m");
    expect(formatDepthBound(6, "imperial", "upper")).toBe("19 ft");
  });

  it("accepts every printed MOD when it is re-entered as a deco switch depth", () => {
    for (let oxygenPercent = 21; oxygenPercent <= 100; oxygenPercent += 1) {
      for (const maximumPPO2 of [1.2, 1.4, 1.5, 1.6]) {
        const oxygen = oxygenPercent / 100;
        const modM = (maximumPPO2 / oxygen - 1) * 10;
        for (const units of ["imperial", "metric"] as const) {
          const printed = Number(formatDepthBound(modM, units, "upper").split(" ")[0]);
          const entered = resolveDepthEntry(printed, units, { bound: "max-ppo2" });
          expect(oxygen * (1 + entered / 10), `${oxygenPercent}% at ${maximumPPO2} bar, ${printed} ${units}`).toBeLessThanOrEqual(maximumPPO2 + 1e-9);
        }
      }
    }
  });
});
