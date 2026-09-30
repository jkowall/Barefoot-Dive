export type Brand<Value, Name extends string> = Value & {
  readonly [key in `__brand_${Name}`]: true;
};

export type Meters = Brand<number, "meters">;
export type Seconds = Brand<number, "seconds">;
/** Absolute pressure, referenced to a vacuum. Ambient pressure and PPO₂ use this unit. */
export type BarAbsolute = Brand<number, "bar-absolute">;
/** Cylinder/manifold pressure, referenced to the surrounding atmosphere. */
export type BarGauge = Brand<number, "bar-gauge">;
/** A pressure difference. It is neither an ambient nor a cylinder reading. */
export type BarDelta = Brand<number, "bar-delta">;
export type Liters = Brand<number, "liters">;
export type LitersPerMinute = Brand<number, "liters-per-minute">;
export type Fraction = Brand<number, "fraction">;

export type PlanningMode = "oc" | "ccr";
export type PlanEnvironment = "open-water" | "cave";
export type GasRole = "bottom" | "travel" | "deco" | "bailout" | "diluent";
export type CylinderRole = GasRole | "stage";
export type DiagnosticSeverity = "info" | "warning" | "error";
export type PlannerConventionId =
  | "barefoot-zhl16c-v1"
  | "multideco-zhlc-compatible-v1"
  | "shearwater-petrel3-v103-compatible-v1";
/** Stop-grid spacing offered in Plan/Cave Setup. Default remains `3m`. */
export type StopGridId = "3m" | "10ft";
export type ValidationStatus = "validated" | "documented-compatible" | "experimental";

export type Diagnostic = {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly field?: string;
  readonly runtimeSeconds?: Seconds;
  readonly depthM?: Meters;
  readonly actual?: number;
  readonly limit?: number;
  readonly gasId?: string;
  readonly cylinderId?: string;
  /**
   * Depths printed in `message`, in order of appearance, with the rounding used to print them,
   * so a display can restate each one in feet. Omitted when the message prints only `depthM`.
   */
  readonly depthMentions?: readonly DepthMention[];
};

export type DepthMention = {
  readonly valueM: Meters;
  readonly rounding: "nearest" | "up" | "down";
};

export type CalculationResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly warnings: readonly Diagnostic[];
      /** Non-fatal unsafe findings when a complete result can still be shown. */
      readonly errors?: readonly Diagnostic[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly Diagnostic[];
      readonly warnings: readonly Diagnostic[];
    };

export type Gas = {
  readonly id: string;
  readonly name: string;
  readonly oxygen: Fraction;
  readonly helium: Fraction;
  readonly role: GasRole;
  readonly switchDepthM?: Meters;
  readonly cylinderId?: string;
  /**
   * Per-gas PPO₂ ceiling used only in gas-only planning, where no cylinder carries
   * the limit. Cylinder plans keep the limit on the assigned cylinder.
   */
  readonly maximumPPO2?: BarAbsolute;
};

export type Cylinder = {
  readonly id: string;
  readonly name: string;
  readonly waterVolumeL: Liters;
  readonly workingPressureBar: BarGauge;
  readonly currentPressureBar: BarGauge;
  readonly minimumPressureBar?: BarGauge;
  readonly gas: Gas;
  readonly maximumPPO2: BarAbsolute;
  readonly role?: CylinderRole;
  readonly archived?: boolean;
  readonly revision: number;
};

export type EnvironmentSettings = {
  readonly surfacePressureBar: BarAbsolute;
  readonly metersPerBar: Meters;
  readonly waterVaporPressureBar: BarAbsolute;
};

export type PlannerSettings = {
  readonly gfLow: Fraction;
  readonly gfHigh: Fraction;
  readonly descentRateMPerMinute: number;
  readonly ascentRateMPerMinute: number;
  readonly decoAscentRateMPerMinute: number;
  readonly stopIncrementM: Meters;
  readonly lastStopDepthM: Meters;
  readonly stopTimeQuantumSeconds: Seconds;
  readonly minimumPPO2: BarAbsolute;
  readonly maximumBottomPPO2: BarAbsolute;
  readonly maximumDecoPPO2: BarAbsolute;
  readonly conventionId: PlannerConventionId;
};

export type RmvSettings = {
  readonly bottomLpm: LitersPerMinute;
  readonly decoLpm: LitersPerMinute;
  readonly bailoutLpm: LitersPerMinute;
  readonly bailoutDecoLpm: LitersPerMinute;
};

export type ReservePolicy =
  | { readonly kind: "fixed"; readonly minimumPressureBar: BarGauge }
  | { readonly kind: "custom"; readonly reserveVolumeL: Liters }
  | { readonly kind: "rock-bottom"; readonly teamSize: number; readonly stressedRmvLpm: LitersPerMinute }
  | { readonly kind: "thirds" }
  | { readonly kind: "sixths" };

export type TissueCompartment = {
  readonly nitrogenBar: BarAbsolute;
  readonly heliumBar: BarAbsolute;
};

export type TissueState = {
  readonly modelId: "zhl-16c-ostc";
  readonly modelVersion: string;
  readonly compartments: readonly TissueCompartment[];
};

export type ProfileSegmentKind =
  | "descent"
  | "bottom"
  | "ascent"
  | "stop"
  | "gas-switch"
  | "setpoint-switch"
  | "penetration"
  | "exit"
  | "bailout";

export type ProfileSegment = {
  readonly id: string;
  readonly kind: ProfileSegmentKind;
  readonly startRuntimeSeconds: Seconds;
  readonly durationSeconds: Seconds;
  readonly startDepthM: Meters;
  readonly endDepthM: Meters;
  readonly gasId: string;
  readonly gasName: string;
  readonly setpointBar?: BarAbsolute;
  /**
   * CCR only: the setpoint the loop holds on this segment before the depth limit, as the tissue
   * model breathed it. The loop PPO₂ at depth d on the segment is what the tissue model breathes
   * on it with the plan's diluent (`loopPPO2` in `src/engine/tissues.ts`): min(held, ambient −
   * water vapor), or oxygen at ambient pressure with a pure-oxygen diluent. Planner and Cave legs
   * never cross the depth where the held setpoint becomes achievable; an explicit event plan from
   * another caller could.
   * It differs from `setpointBar` on ambient-limited Cave exits, where `setpointBar` reports the
   * shallow end, and on a timed switch to a higher setpoint, which is modeled on the lower one for
   * the switch time. An instantaneous switch holds the new setpoint. Absent on segments calculated
   * before plans recorded it.
   */
  readonly heldSetpointBar?: BarAbsolute;
  readonly gf: Fraction;
  readonly ceilingDepthM: Meters;
  readonly tissuesAfter: TissueState;
};

export type DecoStop = {
  readonly depthM: Meters;
  readonly durationSeconds: Seconds;
  readonly gasId: string;
  readonly gasName: string;
};

export type EngineMetadata = {
  readonly engineVersion: string;
  readonly modelId: string;
  readonly coefficientSet: string;
  readonly coefficientHash: string;
  readonly conventionId: PlannerConventionId;
  readonly conventionVersion: string;
  readonly validationStatus: ValidationStatus;
  readonly assumptionsHash: string;
};

export type PlanSummary = {
  readonly runtimeSeconds: Seconds;
  readonly ttsSeconds: Seconds;
  readonly decompressionSeconds: Seconds;
  readonly maximumDepthM: Meters;
  readonly firstStopDepthM?: Meters;
};

export type GasLedgerEntry = {
  readonly gasId: string;
  readonly gasName: string;
  readonly cylinderId?: string;
  readonly cylinderName?: string;
  readonly cylinderWaterVolumeL?: Liters;
  readonly startingPressureBar?: BarGauge;
  readonly workingPressureBar?: BarGauge;
  readonly startingVolumeL?: Liters;
  readonly bottomUsedL: Liters;
  readonly decoUsedL: Liters;
  readonly totalUsedL: Liters;
  readonly reserveL?: Liters;
  readonly remainingVolumeL?: Liters;
  readonly remainingPressureBar?: BarGauge;
  /** False when no cylinder was checked (gas-only entries) or the cylinder does not keep its reserve. */
  readonly sufficient: boolean;
  /** Gas-only planning entry: no cylinder, capacity, pressure, or reserve crossing was checked. */
  readonly gasOnly?: true;
  /** Gas-only planning: minimum surface volume to carry, expected use plus the reserve policy. */
  readonly requiredVolumeL?: Liters;
  /**
   * Dil-out: surface volume removed from the diluent cylinder before bailout starts
   * (diver-entered loop, ADV, flush, wing, and suit use plus any modeled open-circuit
   * diluent breathing before the trigger). startingVolumeL is already reduced by it.
   */
  readonly preBailoutDeductionL?: Liters;
  readonly reserveCrossing?: {
    readonly runtimeSeconds: Seconds;
    readonly depthM: Meters;
    readonly expectedPressureBar: BarGauge;
    readonly requiredPressureBar: BarGauge;
  };
};

export type DivePlan = {
  readonly id: string;
  readonly mode: PlanningMode;
  readonly environment: PlanEnvironment;
  readonly metadata: EngineMetadata;
  readonly segments: readonly ProfileSegment[];
  readonly stops: readonly DecoStop[];
  readonly finalTissues: TissueState;
  readonly summary: PlanSummary;
  readonly gasLedger: readonly GasLedgerEntry[];
  readonly diagnostics: readonly Diagnostic[];
  readonly safetyStatus: "calculated" | "unsafe";
  readonly bailoutPlan?: DivePlan;
};

export type BaseDiveInput = {
  readonly environment: PlanEnvironment;
  readonly depthM: Meters;
  /** Time at target depth. Descent is not included. */
  readonly bottomTimeSeconds: Seconds;
  readonly settings: PlannerSettings;
  readonly environmentSettings: EnvironmentSettings;
  readonly cylinders: readonly Cylinder[];
  readonly rmv: RmvSettings;
  readonly reservePolicy: ReservePolicy;
  /**
   * Plan gas volumes without cylinders (open water only). Emitted only when true.
   * Capacity, pressure, and reserve crossings are not checked.
   */
  readonly gasOnly?: boolean;
};

export type OcDiveInput = BaseDiveInput & {
  readonly mode: "oc";
  readonly bottomGas: Gas;
  readonly travelGas?: Gas;
  readonly decoGases: readonly Gas[];
  /**
   * Where the gas ledger switches from the bottom RMV to the deco RMV. Absent means the
   * engine 0.1.0 boundary: every segment from the end of bottom time, including the ascent
   * to the first stop, uses the deco RMV. "first-stop" keeps the bottom RMV until arrival at
   * the first stop (a gas switch made on arrival counts as the stop), or for the whole ascent
   * when there is no stop. Decompression and cylinder reserves are unaffected; gas-only thirds
   * and sixths reserves follow expected use. Open water only: cave plans reject it until it
   * has cave review.
   */
  readonly decoRmvFrom?: "first-stop";
};

/**
 * Opt-in CCR bailout RMV phase mode. Absent keeps the engine 0.3.0 rule: travel legs at
 * `rmv.bailoutLpm`, stop segments only at `rmv.bailoutDecoLpm`.
 *
 * - `"static"`: one bailout SAC for the whole bailout ascent and stops.
 * - `"bottom-deco"`: bailout SAC until first-stop arrival; bailout deco SAC from then on,
 *   including moves between stops.
 * - `"timed"`: bailout SAC for `bailoutRmvSwitchSeconds` after the bailout ledger start
 *   (including problem-solving), then bailout deco SAC. A straddling segment is split for
 *   charging only.
 */
export type BailoutRmvMode = "static" | "bottom-deco" | "timed";

export type CcrDiveInput = BaseDiveInput & {
  readonly mode: "ccr";
  readonly diluent: Gas;
  /** High (bottom) setpoint. */
  readonly setpointBar: BarAbsolute;
  /** Switch-up depth on descent. */
  readonly setpointActivationDepthM: Meters;
  /**
   * Low setpoint breathed on the loop from the surface to the switch-up depth, and
   * after leaving the switch-down depth on ascent when ascentSetpointMode is absent
   * (the 0.4.0/0.6.0 leave-the-depth → fixed low rule). Absent means the legacy
   * convention: open-circuit diluent above the switch-up depth in both directions.
   */
  readonly lowSetpointBar?: BarAbsolute;
  /**
   * Switch-down depth on ascent, used only with lowSetpointBar. Without
   * ascentSetpointMode, the high setpoint is held at any depth at or below it,
   * including a stop there, and the loop switches to the fixed low setpoint when
   * leaving it. Absent means the switch-up depth. Under that leave-to-low rule the
   * open-water planner switches no shallower than the depth where the high setpoint
   * is achievable; cave plans reject a shallower value. With
   * ascentSetpointMode "ambient-limited-high", the switch-down depth no longer
   * drops the loop to the fixed low setpoint (see that field).
   */
  readonly setpointDeactivationDepthM?: Meters;
  /**
   * After the high setpoint is active on ascent: hold
   * min(high setpoint, max loop PPO₂ at the current depth) instead of switching to
   * the fixed low setpoint when leaving the switch-down depth. Absent means the
   * 0.4.0/0.6.0 leave-the-depth → low setpoint schedule. New plans set this field;
   * stored plans without it keep the older schedule when recalculated.
   */
  readonly ascentSetpointMode?: "ambient-limited-high";
  readonly bailoutGases: readonly Gas[];
  /** Dil-out: the diluent and its cylinder join the open-circuit bailout gas set. */
  readonly diluentBailout?: boolean;
  /**
   * Dil-out only and then required: surface volume the diver expects to have used from
   * the diluent cylinder before bailout (loop make-up, ADV, flushes, wing, suit).
   */
  readonly diluentPreBailoutUseL?: Liters;
  readonly bailoutTriggerSecondsAtDepth?: Seconds;
  /**
   * Opt-in bailout RMV phase mode. Absent keeps travel @ bailout SAC and stops @ bailout
   * deco SAC. Open water only; cave plans reject it until cave review.
   */
  readonly bailoutRmvMode?: BailoutRmvMode;
  /**
   * Mode `"timed"` only: duration of `rmv.bailoutLpm` after the bailout ledger start before
   * switching to `rmv.bailoutDecoLpm`. Required when `bailoutRmvMode` is `"timed"`.
   */
  readonly bailoutRmvSwitchSeconds?: Seconds;
  /**
   * Hold at the bailout trigger depth after the OC gas switch and before ascent. Charged at
   * `rmv.bailoutLpm`; tissues and gas advance for the hold. Absent or zero means no hold.
   */
  readonly problemSolvingTimeSeconds?: Seconds;
};

export type DivePlanInput = OcDiveInput | CcrDiveInput;
