import type {
  PlannerConventionId,
  PlannerSettings,
  ValidationStatus,
} from "../domain/types";

export type ConventionPolicy = {
  readonly id: PlannerConventionId;
  readonly name: string;
  readonly version: string;
  readonly validationStatus: ValidationStatus;
  readonly gasSwitchDurationSeconds: number;
  readonly setpointSwitchDurationSeconds: number;
  readonly ascentRateMPerMinute?: number;
  readonly decoAscentRateMPerMinute?: number;
  readonly notes: readonly string[];
};

/**
 * Convention presets are explicit scheduling policies layered on the same
 * ZH-L16C tissue model. They remain experimental until broader independent
 * multi-gas, CCR, altitude, and product-comparison vectors are committed.
 */
export const CONVENTION_POLICIES: Readonly<Record<PlannerConventionId, ConventionPolicy>> = {
  "barefoot-zhl16c-v1": {
    id: "barefoot-zhl16c-v1",
    name: "Barefoot ZHL-16C preset",
    version: "1.0.0",
    validationStatus: "experimental",
    gasSwitchDurationSeconds: 0,
    setpointSwitchDurationSeconds: 0,
    notes: ["Deterministic 3 m stop grid", "User-selected ascent rates and last stop"],
  },
  "shearwater-petrel3-v103-compatible-v1": {
    id: "shearwater-petrel3-v103-compatible-v1",
    name: "Shearwater Petrel 3 settings preset",
    version: "1.0.0",
    validationStatus: "experimental",
    gasSwitchDurationSeconds: 5,
    setpointSwitchDurationSeconds: 5,
    ascentRateMPerMinute: 10,
    decoAscentRateMPerMinute: 10,
    notes: [
      "Uses documented 10 m/min ascent behavior",
      "Not a claim of Petrel firmware schedule parity or compatibility",
    ],
  },
  "multideco-zhlc-compatible-v1": {
    id: "multideco-zhlc-compatible-v1",
    name: "MultiDeco ZHL-C settings preset",
    version: "1.0.0",
    validationStatus: "experimental",
    gasSwitchDurationSeconds: 0,
    setpointSwitchDurationSeconds: 0,
    notes: ["Selectable settings preset; no MultiDeco parity or compatibility claim"],
  },
};

export function conventionFor(settings: PlannerSettings): ConventionPolicy {
  return CONVENTION_POLICIES[settings.conventionId];
}

export function effectiveAscentRate(settings: PlannerSettings, inDeco: boolean): number {
  const policy = conventionFor(settings);
  return inDeco
    ? (policy.decoAscentRateMPerMinute ?? settings.decoAscentRateMPerMinute)
    : (policy.ascentRateMPerMinute ?? settings.ascentRateMPerMinute);
}
