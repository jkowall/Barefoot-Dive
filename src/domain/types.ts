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

export type CcrDiveInput = BaseDiveInput & {
  readonly mode: "ccr";
  readonly diluent: Gas;
  /** High (bottom) setpoint. */
  readonly setpointBar: BarAbsolute;
  /** Switch-up depth on descent. */
  readonly setpointActivationDepthM: Meters;
  /**
   * Low setpoint breathed on the loop from the surface to the switch-up depth, and
   * after leaving the switch-down depth on ascent. Absent means the legacy convention:
   * open-circuit diluent above the switch-up depth in both directions.
   */
  readonly lowSetpointBar?: BarAbsolute;
  /**
   * Switch-down depth on ascent, used only with lowSetpointBar. The high setpoint is
   * held at any depth at or below it, including a stop there; the switch happens when
   * leaving it. Absent means the switch-up depth. The open-water planner switches no shallower than
   * the depth where the high setpoint is achievable; cave plans reject a shallower value.
   */
  readonly setpointDeactivationDepthM?: Meters;
  readonly bailoutGases: readonly Gas[];
  /** Dil-out: the diluent and its cylinder join the open-circuit bailout gas set. */
  readonly diluentBailout?: boolean;
  /**
   * Dil-out only and then required: surface volume the diver expects to have used from
   * the diluent cylinder before bailout (loop make-up, ADV, flushes, wing, suit).
   */
  readonly diluentPreBailoutUseL?: Liters;
  readonly bailoutTriggerSecondsAtDepth?: Seconds;
};

export type DivePlanInput = OcDiveInput | CcrDiveInput;
