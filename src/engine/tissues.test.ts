import { describe, expect, it } from "vitest";
import { DEFAULT_ENVIRONMENT } from "../domain/defaults";
import type { Gas } from "../domain/types";
import { barAbsolute, fraction, meters, seconds } from "../domain/units";
import {
  exposeTissues,
  gradientFactorAtDepth,
  gradientFactorCeilingPressure,
  haldaneEquation,
  initializeTissues,
  schreinerEquation,
} from "./tissues";
import {
  ZHL16C_HE_A,
  ZHL16C_HE_B,
  ZHL16C_N2_A,
  ZHL16C_N2_B,
} from "./zhl16c";

const EAN32: Gas = {
  id: "ean32",
  name: "EAN32",
  oxygen: fraction(0.32),
  helium: fraction(0),
  role: "bottom",
};

describe("ZH-L16C coefficient and analytical fixtures", () => {
  it("keeps the independently published OSTC/DecoTengu coefficient literals", () => {
    expect(ZHL16C_N2_A).toHaveLength(16);
    expect(ZHL16C_N2_B).toHaveLength(16);
    expect(ZHL16C_HE_A).toHaveLength(16);
    expect(ZHL16C_HE_B).toHaveLength(16);
    expect(ZHL16C_N2_A[0]).toBe(1.2599);
    expect(ZHL16C_N2_B[15]).toBe(0.9653);
    expect(ZHL16C_HE_A[0]).toBe(1.7424);
    expect(ZHL16C_HE_B[15]).toBe(0.9267);
  });

  it("matches the published ZH-L16B first-compartment Schreiner equation fixture", () => {
    // This fixture validates the equation independently of the C coefficient
    // table. The cited example explicitly uses the B model's 5 minute half-life.
    let nitrogen = 0.74065446;
    nitrogen = schreinerEquation(nitrogen, 0.637364, 1.36, 1.5, 5);
    expect(nitrogen).toBeCloseTo(0.919397, 6);
    nitrogen = schreinerEquation(nitrogen, 2.677364, 0, 20, 5);
    expect(nitrogen).toBeCloseTo(2.567491, 6);
    nitrogen = schreinerEquation(nitrogen, 2.677364, -0.68, 2, 5);
    expect(nitrogen).toBeCloseTo(2.42184, 6);
  });

  it("uses the C model's four-minute first compartment in full tissue exposure", () => {
    const state = exposeTissues(
      initializeTissues(DEFAULT_ENVIRONMENT),
      barAbsolute(1),
      barAbsolute(4),
      seconds(90),
      { kind: "open-circuit", gas: EAN32 },
      DEFAULT_ENVIRONMENT,
    );
    expect(state.compartments[0].nitrogenBar).toBeCloseTo(0.960587365, 9);
  });

  it("reduces Schreiner to Haldane at constant inspired pressure", () => {
    const haldane = haldaneEquation(0.75, 2.1, 18, 12.5);
    const schreiner = schreinerEquation(0.75, 2.1, 0, 18, 12.5);
    expect(schreiner).toBeCloseTo(haldane, 12);
  });

  it("calculates a pure-nitrogen GF ceiling with the C coefficients", () => {
    const pressure = gradientFactorCeilingPressure(0.3, 2.56749, 0, 0);
    const expected = (2.56749 - ZHL16C_N2_A[0] * 0.3) /
      (0.3 / ZHL16C_N2_B[0] + 0.7);
    expect(pressure).toBeCloseTo(expected, 12);
  });

  it("interpolates GF from the first stop to the surface", () => {
    expect(gradientFactorAtDepth(meters(18), meters(18), fraction(0.3), fraction(0.7)))
      .toBeCloseTo(0.3, 12);
    expect(gradientFactorAtDepth(meters(9), meters(18), fraction(0.3), fraction(0.7)))
      .toBeCloseTo(0.5, 12);
    expect(gradientFactorAtDepth(meters(0), meters(18), fraction(0.3), fraction(0.7)))
      .toBeCloseTo(0.7, 12);
  });
});
