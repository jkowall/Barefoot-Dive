import type {
  EnvironmentSettings,
  Gas,
  PlannerSettings,
  ReservePolicy,
  RmvSettings,
} from "./types";
import { barAbsolute, barGauge, fraction, litersPerMinute, meters, seconds } from "./units";

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  surfacePressureBar: barAbsolute(1),
  metersPerBar: meters(10),
  waterVaporPressureBar: barAbsolute(0.0627),
};

export const DEFAULT_PLANNER_SETTINGS: PlannerSettings = {
  gfLow: fraction(0.3),
  gfHigh: fraction(0.7),
  descentRateMPerMinute: 18,
  ascentRateMPerMinute: 9,
  decoAscentRateMPerMinute: 3,
  stopIncrementM: meters(3),
  lastStopDepthM: meters(6),
  stopTimeQuantumSeconds: seconds(60),
  minimumPPO2: barAbsolute(0.16),
  maximumBottomPPO2: barAbsolute(1.4),
  maximumDecoPPO2: barAbsolute(1.6),
  conventionId: "barefoot-zhl16c-v1",
};

export const DEFAULT_RMV: RmvSettings = {
  bottomLpm: litersPerMinute(20),
  decoLpm: litersPerMinute(15),
  bailoutLpm: litersPerMinute(30),
  bailoutDecoLpm: litersPerMinute(20),
};

export const DEFAULT_RESERVE_POLICY: ReservePolicy = {
  kind: "fixed",
  minimumPressureBar: barGauge(35),
};

export const AIR: Gas = {
  id: "air",
  name: "Air",
  oxygen: fraction(0.21),
  helium: fraction(0),
  role: "bottom",
};

export const EAN50: Gas = {
  id: "ean50",
  name: "EAN50",
  oxygen: fraction(0.5),
  helium: fraction(0),
  role: "deco",
  switchDepthM: meters(21),
};

export const OXYGEN: Gas = {
  id: "oxygen",
  name: "Oxygen",
  oxygen: fraction(1),
  helium: fraction(0),
  role: "deco",
  switchDepthM: meters(6),
};
