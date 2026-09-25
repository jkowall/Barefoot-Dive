import type {
  BarAbsolute,
  BarDelta,
  BarGauge,
  Fraction,
  Liters,
  LitersPerMinute,
  Meters,
  Seconds,
} from "./types";

const PSI_PER_BAR = 14.5037738;
const FEET_PER_METER = 3.280839895;
const LITERS_PER_CUBIC_FOOT = 28.316846592;

export const barAbsolute = (value: number): BarAbsolute => value as BarAbsolute;
export const barGauge = (value: number): BarGauge => value as BarGauge;
export const barDelta = (value: number): BarDelta => value as BarDelta;
export const fraction = (value: number): Fraction => value as Fraction;
export const liters = (value: number): Liters => value as Liters;
export const litersPerMinute = (value: number): LitersPerMinute => value as LitersPerMinute;
export const meters = (value: number): Meters => value as Meters;
export const seconds = (value: number): Seconds => Math.round(value) as Seconds;

export const feetToMeters = (value: number): Meters => meters(value / FEET_PER_METER);
export const metersToFeet = (value: Meters): number => value * FEET_PER_METER;
export const psiToBar = (value: number): BarGauge => barGauge(value / PSI_PER_BAR);
export const barToPsi = (value: BarGauge): number => value * PSI_PER_BAR;
/** Convert a gauge reading to absolute pressure using the local surface pressure. */
export const gaugeToAbsolute = (pressureBar: BarGauge, surfacePressureBar: BarAbsolute): BarAbsolute =>
  barAbsolute(pressureBar + surfacePressureBar);
/** Convert absolute pressure to a gauge reading using the local surface pressure. */
export const absoluteToGauge = (pressureBar: BarAbsolute, surfacePressureBar: BarAbsolute): BarGauge =>
  barGauge(pressureBar - surfacePressureBar);
export const absolutePressureDelta = (endPressureBar: BarAbsolute, startPressureBar: BarAbsolute): BarDelta =>
  barDelta(endPressureBar - startPressureBar);
export const cubicFeetToLiters = (value: number): Liters => liters(value * LITERS_PER_CUBIC_FOOT);
export const litersToCubicFeet = (value: Liters): number => value / LITERS_PER_CUBIC_FOOT;

export function depthToAmbientPressure(
  depthM: Meters,
  surfacePressureBar: BarAbsolute,
  metersPerBar: Meters,
): BarAbsolute {
  return barAbsolute(surfacePressureBar + depthM / metersPerBar);
}

export function ambientPressureToDepth(
  pressureBar: BarAbsolute,
  surfacePressureBar: BarAbsolute,
  metersPerBar: Meters,
): Meters {
  return meters(Math.max(0, (pressureBar - surfacePressureBar) * metersPerBar));
}

export function roundDepthShallower(depthM: Meters, incrementM: Meters): Meters {
  return meters(Math.max(0, Math.floor((depthM + 1e-9) / incrementM) * incrementM));
}

export function roundDepthDeeper(depthM: Meters, incrementM: Meters): Meters {
  return meters(Math.max(0, Math.ceil((depthM - 1e-9) / incrementM) * incrementM));
}

/**
 * Round a limit for display so the printed value is on its safe side: an upper bound (a maximum)
 * rounds down and a lower bound (a minimum) rounds up. Re-entering the printed value then always
 * satisfies the limit, which rounding to nearest does not guarantee (0.9373 would print as 0.94).
 */
export function roundBound(value: number, decimals: number, bound: "upper" | "lower"): number {
  const factor = 10 ** decimals;
  const scaled = value * factor;
  // The tolerance absorbs binary noise such as 0.93 * 100 = 92.99999999999999.
  return (bound === "upper" ? Math.floor(scaled + 1e-7) : Math.ceil(scaled - 1e-7)) / factor;
}

export function formatBound(value: number, decimals: number, bound: "upper" | "lower"): string {
  return roundBound(value, decimals, bound).toFixed(decimals);
}

/** How a depth printed in a diagnostic message was rounded, so a display can restate it in feet. */
export type DepthRounding = "nearest" | "up" | "down";

/** A depth as printed in diagnostic messages: canonical metres with one decimal. */
export function formatMessageDepth(depthM: number, rounding: DepthRounding = "nearest"): string {
  const value = rounding === "nearest"
    ? depthM.toFixed(1)
    : formatBound(depthM, 1, rounding === "down" ? "upper" : "lower");
  return `${value} m`;
}
