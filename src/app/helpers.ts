import type { BarGauge, Cylinder, DivePlanInput, Gas, Meters } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, roundBound } from "../domain/units";

export type UnitPreferences = { depth: "imperial" | "metric"; pressure: "psi" | "bar"; cylinderCapacity: "imperial" | "metric" };
export const DEFAULT_PREFERENCES: UnitPreferences = { depth: "imperial", pressure: "psi", cylinderCapacity: "imperial" };
export const CUFT_LITERS = 28.316846592;
export const capacityUnit = (units: UnitPreferences["cylinderCapacity"]): "ft³" | "L" => units === "imperial" ? "ft³" : "L";
export const capacityLabel = (units: UnitPreferences["cylinderCapacity"]): string => units === "imperial"
  ? "Rated capacity (ft³)"
  : "Water volume (L)";
export const capacityInputValue = (waterVolumeL: number, workingPressureBar: number, units: UnitPreferences["cylinderCapacity"]): number =>
  Number(ratedCapacityFromCanonical(waterVolumeL, workingPressureBar, units).toFixed(1));
/** Imperial cylinders use rated surface capacity; metric cylinders use water volume. */
export const ratedCapacityFromCanonical = (waterVolumeL: number, workingPressureBar: number, units: UnitPreferences["cylinderCapacity"]): number => {
  if (!Number.isFinite(waterVolumeL) || !Number.isFinite(workingPressureBar) || workingPressureBar <= 0) return Number.NaN;
  return units === "imperial" ? waterVolumeL * workingPressureBar / CUFT_LITERS : waterVolumeL;
};
/** Convert an imperial rating or metric water volume back to canonical water volume. */
export const waterVolumeFromRatedCapacity = (capacity: number, workingPressureBar: number, units: UnitPreferences["cylinderCapacity"]): number => {
  if (!Number.isFinite(capacity) || !Number.isFinite(workingPressureBar) || workingPressureBar <= 0) return Number.NaN;
  return units === "imperial" ? capacity * CUFT_LITERS / workingPressureBar : capacity;
};
export const surfaceGasFromCanonical = (litersValue: number, units: UnitPreferences["cylinderCapacity"]): number => units === "imperial" ? litersValue / CUFT_LITERS : litersValue;
export const surfaceGasUnit = (units: UnitPreferences["cylinderCapacity"]): "ft³" | "L" => capacityUnit(units);
export const surfaceGasInputValue = (litersValue: number, units: UnitPreferences["cylinderCapacity"]): number =>
  Number(surfaceGasFromCanonical(litersValue, units).toFixed(units === "imperial" ? 1 : 0));
export const surfaceGasInputToCanonical = (
  value: number,
  units: UnitPreferences["cylinderCapacity"],
  equivalentValuesL: readonly number[] = [],
): number => {
  const displayValue = Number(value.toFixed(units === "imperial" ? 1 : 0));
  const equivalent = equivalentValuesL.find((candidate) => surfaceGasInputValue(candidate, units) === displayValue);
  return equivalent === undefined ? (units === "imperial" ? displayValue * CUFT_LITERS : displayValue) : equivalent;
};
export const surfaceGasInputStep = (units: UnitPreferences["cylinderCapacity"]): number => units === "imperial" ? 0.1 : 1;
export const surfaceGasRateFromCanonical = (litersPerMinute: number, units: UnitPreferences["cylinderCapacity"]): number =>
  surfaceGasFromCanonical(litersPerMinute, units);
/** ft³/min SAC rates are quoted to two decimals (0.55), L/min to one. */
const surfaceGasRateDecimals = (units: UnitPreferences["cylinderCapacity"]): number => units === "imperial" ? 2 : 1;
export const surfaceGasRateInputValue = (litersPerMinute: number, units: UnitPreferences["cylinderCapacity"]): number =>
  Number(surfaceGasRateFromCanonical(litersPerMinute, units).toFixed(surfaceGasRateDecimals(units)));
export const surfaceGasRateInputToCanonical = (
  value: number,
  units: UnitPreferences["cylinderCapacity"],
  equivalentValuesLpm: readonly number[] = [],
): number => {
  const displayValue = Number(value.toFixed(surfaceGasRateDecimals(units)));
  const equivalent = equivalentValuesLpm.find((candidate) => surfaceGasRateInputValue(candidate, units) === displayValue);
  return equivalent === undefined ? (units === "imperial" ? displayValue * CUFT_LITERS : displayValue) : equivalent;
};
export const surfaceGasRateInputStep = (units?: UnitPreferences["cylinderCapacity"]): number => units === "imperial" ? 0.01 : 0.1;
export const surfaceGasRateUnit = (units: UnitPreferences["cylinderCapacity"]): "ft³/min" | "L/min" =>
  units === "imperial" ? "ft³/min" : "L/min";
export const formatSurfaceGas = (litersValue: number, units: UnitPreferences["cylinderCapacity"], digits?: number): string =>
  `${surfaceGasFromCanonical(litersValue, units).toFixed(digits ?? (units === "imperial" ? 1 : 0))} ${surfaceGasUnit(units)}`;
export const formatSurfaceGasRate = (litersPerMinute: number, units: UnitPreferences["cylinderCapacity"], digits?: number): string =>
  `${surfaceGasRateFromCanonical(litersPerMinute, units).toFixed(digits ?? surfaceGasRateDecimals(units))} ${surfaceGasRateUnit(units)}`;
export const depthToCanonical = (value: number, units: UnitPreferences["depth"]): Meters => meters(units === "imperial" ? value / 3.280839895 : value);
export const depthFromCanonical = (value: number, units: UnitPreferences["depth"]): number => units === "imperial" ? value * 3.280839895 : value;
/** Depth inputs show whole feet, or metres to one decimal. */
const depthInputDecimals = (units: UnitPreferences["depth"]): number => units === "imperial" ? 0 : 1;
export const depthInputValue = (valueMeters: number, units: UnitPreferences["depth"]): number =>
  Number(depthFromCanonical(valueMeters, units).toFixed(depthInputDecimals(units)));
export const depthInputStep = (units: UnitPreferences["depth"]): number => units === "imperial" ? 1 : 0.1;

export type DepthEntryBound =
  /** Any depth or distance: converted exactly. */
  | "free"
  /** Deco or bailout switch depth, limited by a maximum PPO₂: may alias shallower onto the stop grid, never deeper. */
  | "max-ppo2"
  /** Travel-to-bottom switch depth, limited by a minimum and a maximum PPO₂: never aliased. */
  | "min-ppo2"
  /** CCR setpoint switch depth, compared with stop depths exactly: aliases to the nearest stop-grid depth. */
  | "setpoint-switch";

/**
 * Convert a depth typed in the display unit to canonical metres.
 *
 * Retyping the value shown for `focusM` (the stored depth when the field took focus) keeps that depth,
 * so a 6 m switch shown as 20 ft stays 6 m. Otherwise the typed value converts exactly, except that a
 * switch depth may alias to a stop-grid depth that displays as the same value, because the diver
 * switches at the stop (20 ft typed is the 6 m stop). A deco or bailout switch only ever moves
 * shallower, which never raises its PPO₂; a travel-to-bottom switch never moves.
 */
export function resolveDepthEntry(
  typed: number,
  units: UnitPreferences["depth"],
  options: { readonly focusM?: number; readonly gridM?: number; readonly bound?: DepthEntryBound } = {},
): Meters {
  const { focusM, gridM = 3, bound = "free" } = options;
  if (!Number.isFinite(typed)) return meters(typed);
  const shown = Number(typed.toFixed(depthInputDecimals(units)));
  if (focusM !== undefined && Number.isFinite(focusM) && depthInputValue(focusM, units) === shown) return meters(focusM);
  const exact = depthToCanonical(typed, units);
  if (bound === "free" || bound === "min-ppo2" || !(gridM > 0)) return exact;
  const gridDepth = bound === "max-ppo2"
    ? Math.floor((exact + 1e-9) / gridM) * gridM
    : Math.round(exact / gridM) * gridM;
  return depthInputValue(gridDepth, units) === shown ? meters(gridDepth) : exact;
}

/** CCR setpoint switch depth entry: 20 ft, or a displayed 19.7 ft, is the 6 m stop. */
export const switchDepthToCanonical = (value: number, units: UnitPreferences["depth"], gridM = 3): Meters =>
  resolveDepthEntry(value, units, { gridM, bound: "setpoint-switch" });

/**
 * A depth limit rounded to whole display units on its safe side: a maximum (MOD) rounds down and a
 * minimum (END, a ceiling) rounds up, so a diver working to the printed value stays within the limit.
 */
export const formatDepthBound = (valueMeters: number, units: UnitPreferences["depth"], bound: "upper" | "lower"): string =>
  `${roundBound(depthFromCanonical(valueMeters, units), 0, bound).toFixed(0)} ${depthUnit(units)}`;
export const pressureToCanonical = (value: number, units: UnitPreferences["pressure"]): BarGauge => barGauge(units === "psi" ? value / 14.5037738 : value);
export const pressureFromCanonical = (value: number, units: UnitPreferences["pressure"]): number => units === "psi" ? value * 14.5037738 : value;
export const pressureUnit = (units: UnitPreferences["pressure"]): "psi" | "bar" => units;
export const depthUnit = (units: UnitPreferences["depth"]): "ft" | "m" => units === "imperial" ? "ft" : "m";
export const pressureInputValue = (valueBar: number, units: UnitPreferences["pressure"]): number => Number(pressureFromCanonical(valueBar, units).toFixed(units === "psi" ? 0 : 1));
export const pressureInputStep = (units: UnitPreferences["pressure"]): number => units === "psi" ? 1 : 0.1;
export const pressureInputToCanonical = (value: number, units: UnitPreferences["pressure"], equivalentValuesBar: readonly number[] = []): BarGauge => {
  const displayValue = Number(value.toFixed(units === "psi" ? 0 : 1));
  const equivalent = equivalentValuesBar.find((candidate) => pressureInputValue(candidate, units) === displayValue);
  return equivalent === undefined ? pressureToCanonical(displayValue, units) : barGauge(equivalent);
};
export const formatDuration = (valueSeconds: number): string => {
  const total = Math.max(0, Math.round(valueSeconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor(total % 3600 / 60);
  const secondsValue = total % 60;
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secondsValue).padStart(2, "0")}`
    : `${minutes}:${String(secondsValue).padStart(2, "0")}`;
};
export const formatDepth = (valueMeters: number, units: UnitPreferences["depth"], digits = 0): string => `${depthFromCanonical(valueMeters, units).toFixed(digits)} ${depthUnit(units)}`;
export const formatPressure = (valueBar: number, units: UnitPreferences["pressure"], digits?: number): string => {
  const decimals = units === "psi" ? 0 : (digits ?? 1);
  return `${pressureFromCanonical(valueBar, units).toFixed(decimals)} ${pressureUnit(units)}`;
};
export const gas = (id: string, name: string, oxygen: number, helium = 0, role: Gas["role"] = "bottom", switchDepthM?: Meters, cylinderId?: string): Gas => ({ id, name, oxygen: fraction(oxygen / 100), helium: fraction(helium / 100), role, ...(switchDepthM === undefined ? {} : { switchDepthM }), ...(cylinderId ? { cylinderId } : {}) });
export const defaultCylinder = (g: Gas, id = "default-cylinder"): Cylinder => ({ id, name: "Planner cylinder", waterVolumeL: liters(24), workingPressureBar: barGauge(232), currentPressureBar: barGauge(232), minimumPressureBar: barGauge(35), gas: { ...g, cylinderId: id }, maximumPPO2: barAbsolute(1.6), role: g.role, revision: 1 });
export function diagnosticsToText(items: readonly { message: string; code?: string }[]): string[] { return items.map((item) => item.code ? `${item.message} (${item.code})` : item.message); }
export function planInputToDraft(input: DivePlanInput): DivePlanInput { return structuredClone(input); }
