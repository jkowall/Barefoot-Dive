import type {
  BarAbsolute,
  EnvironmentSettings,
  Fraction,
  Gas,
  Meters,
  Seconds,
  TissueCompartment,
  TissueState,
} from "../domain/types";
import { ambientPressureToDepth, barAbsolute, fraction, meters } from "../domain/units";
import { nitrogenFraction } from "../domain/validation";
import {
  ZHL16C_COMPARTMENT_COUNT,
  ZHL16C_HE_A,
  ZHL16C_HE_B,
  ZHL16C_HE_HALF_LIFE_MINUTES,
  ZHL16C_MODEL_ID,
  ZHL16C_MODEL_VERSION,
  ZHL16C_N2_A,
  ZHL16C_N2_B,
  ZHL16C_N2_HALF_LIFE_MINUTES,
} from "./zhl16c";

const LN_2 = Math.log(2);
const INITIAL_NITROGEN_FRACTION = 0.7902;

export type BreathingStrategy =
  | { readonly kind: "open-circuit"; readonly gas: Gas }
  | { readonly kind: "ccr"; readonly diluent: Gas; readonly setpointBar: BarAbsolute };

export type CeilingResult = {
  readonly pressureBar: BarAbsolute;
  readonly depthM: Meters;
  readonly controllingCompartment: number;
};

export function initializeTissues(environment: EnvironmentSettings): TissueState {
  const initialNitrogen = barAbsolute(
    INITIAL_NITROGEN_FRACTION *
      (environment.surfacePressureBar - environment.waterVaporPressureBar),
  );
  const compartments: TissueCompartment[] = Array.from(
    { length: ZHL16C_COMPARTMENT_COUNT },
    () => ({ nitrogenBar: initialNitrogen, heliumBar: barAbsolute(0) }),
  );
  return {
    modelId: ZHL16C_MODEL_ID,
    modelVersion: ZHL16C_MODEL_VERSION,
    compartments,
  };
}

export function haldaneEquation(
  initialTissuePressureBar: number,
  inspiredPressureBar: number,
  durationMinutes: number,
  halfLifeMinutes: number,
): number {
  const k = LN_2 / halfLifeMinutes;
  return inspiredPressureBar +
    (initialTissuePressureBar - inspiredPressureBar) * Math.exp(-k * durationMinutes);
}

export function schreinerEquation(
  initialTissuePressureBar: number,
  inspiredPressureAtStartBar: number,
  inspiredPressureRateBarPerMinute: number,
  durationMinutes: number,
  halfLifeMinutes: number,
): number {
  const k = LN_2 / halfLifeMinutes;
  return inspiredPressureAtStartBar +
    inspiredPressureRateBarPerMinute * (durationMinutes - 1 / k) -
    (
      inspiredPressureAtStartBar -
      initialTissuePressureBar -
      inspiredPressureRateBarPerMinute / k
    ) * Math.exp(-k * durationMinutes);
}

function inertInspiredPressure(
  strategy: BreathingStrategy,
  ambientPressureBar: number,
  environment: EnvironmentSettings,
): readonly [number, number] {
  if (strategy.kind === "open-circuit") {
    const dryGasPressure = Math.max(0, ambientPressureBar - environment.waterVaporPressureBar);
    return [
      nitrogenFraction(strategy.gas) * dryGasPressure,
      strategy.gas.helium * dryGasPressure,
    ];
  }
  const inertFraction = 1 - strategy.diluent.oxygen;
  if (inertFraction <= 0) return [0, 0];
  const dryInertPressure = Math.max(
    0,
    ambientPressureBar - environment.waterVaporPressureBar - strategy.setpointBar,
  );
  return [
    (nitrogenFraction(strategy.diluent) / inertFraction) * dryInertPressure,
    (strategy.diluent.helium / inertFraction) * dryInertPressure,
  ];
}

export function exposeTissues(
  state: TissueState,
  startAmbientPressureBar: BarAbsolute,
  endAmbientPressureBar: BarAbsolute,
  durationSeconds: Seconds,
  strategy: BreathingStrategy,
  environment: EnvironmentSettings,
): TissueState {
  if (durationSeconds <= 0) return state;
  const durationMinutes = durationSeconds / 60;
  const [startN2, startHe] = inertInspiredPressure(
    strategy,
    startAmbientPressureBar,
    environment,
  );
  const [endN2, endHe] = inertInspiredPressure(
    strategy,
    endAmbientPressureBar,
    environment,
  );
  const n2Rate = (endN2 - startN2) / durationMinutes;
  const heRate = (endHe - startHe) / durationMinutes;
  const compartments = state.compartments.map((compartment, index) => ({
    nitrogenBar: barAbsolute(schreinerEquation(
      compartment.nitrogenBar,
      startN2,
      n2Rate,
      durationMinutes,
      ZHL16C_N2_HALF_LIFE_MINUTES[index],
    )),
    heliumBar: barAbsolute(schreinerEquation(
      compartment.heliumBar,
      startHe,
      heRate,
      durationMinutes,
      ZHL16C_HE_HALF_LIFE_MINUTES[index],
    )),
  }));
  return { ...state, compartments };
}

export function gradientFactorCeilingPressure(
  gf: number,
  nitrogenBar: number,
  heliumBar: number,
  compartmentIndex: number,
): number {
  const total = nitrogenBar + heliumBar;
  if (total <= 1e-12) return 0;
  const a = (
    ZHL16C_N2_A[compartmentIndex] * nitrogenBar +
    ZHL16C_HE_A[compartmentIndex] * heliumBar
  ) / total;
  const b = (
    ZHL16C_N2_B[compartmentIndex] * nitrogenBar +
    ZHL16C_HE_B[compartmentIndex] * heliumBar
  ) / total;
  return (total - a * gf) / (gf / b + 1 - gf);
}

export function calculateCeiling(
  state: TissueState,
  gf: Fraction,
  environment: EnvironmentSettings,
): CeilingResult {
  let controllingCompartment = 0;
  let pressure = Number.NEGATIVE_INFINITY;
  state.compartments.forEach((compartment, index) => {
    const candidate = gradientFactorCeilingPressure(
      gf,
      compartment.nitrogenBar,
      compartment.heliumBar,
      index,
    );
    if (candidate > pressure) {
      pressure = candidate;
      controllingCompartment = index;
    }
  });
  const pressureBar = barAbsolute(Math.max(0, pressure));
  return {
    pressureBar,
    depthM: ambientPressureToDepth(
      pressureBar,
      environment.surfacePressureBar,
      environment.metersPerBar,
    ),
    controllingCompartment,
  };
}

export function gradientFactorAtDepth(
  depthM: Meters,
  firstStopDepthM: Meters,
  low: Fraction,
  high: Fraction,
): Fraction {
  if (firstStopDepthM <= 0) return high;
  const ratio = Math.min(1, Math.max(0, depthM / firstStopDepthM));
  return fraction(high + (low - high) * ratio);
}

export function emptyCeiling(): CeilingResult {
  return { pressureBar: barAbsolute(0), depthM: meters(0), controllingCompartment: 0 };
}
