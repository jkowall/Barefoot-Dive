import { describe, expect, it } from "vitest";
import { capacityInputValue, formatPressure, pressureFromCanonical, pressureInputStep, pressureInputToCanonical, pressureInputValue, pressureToCanonical, ratedCapacityFromCanonical, waterVolumeFromRatedCapacity } from "./helpers";

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
