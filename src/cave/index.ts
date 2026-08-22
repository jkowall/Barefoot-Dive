import type {
  BarAbsolute, BarGauge, CalculationResult, CcrDiveInput, Cylinder, Diagnostic, DivePlan, Gas, GasLedgerEntry,
  Liters, LitersPerMinute, Meters, OcDiveInput, PlanningMode, ReservePolicy, Seconds,
} from "../domain/types";
import { integratedSurfaceGas } from "../calculations";
import { calculateEventDivePlan, type ExposureEvent } from "../engine/planner";
import { barGauge, depthToAmbientPressure, liters, meters, seconds } from "../domain/units";
import { ocBottomSwitchDepth, resolveAssignedCylinder } from "../domain/validation";

/** The cave API is deliberately local: it is a route planner, not a second dive engine. */
export type Propulsion = "fins" | "scooter" | "tow";
export type StageAction = "none" | "drop" | "recover";
export type CaveScenarioKind = "oc-lost-gas" | "lost-buddy" | "scooter-failure" | "stage-failure" | "ccr-loop-failure";

export type RouteLeg = {
  readonly id: string;
  readonly startDepthM: Meters;
  readonly endDepthM: Meters;
  readonly durationSeconds: Seconds;
  readonly distanceM: Meters;
  readonly propulsion: Propulsion;
  readonly accessibleCylinderIds: readonly string[];
  readonly stageAction?: StageAction;
  readonly stageCylinderId?: string;
};

export type CaveReserveSemantics =
  | { readonly kind: "thirds" }
  | { readonly kind: "sixths" }
  | { readonly kind: "rock-bottom"; readonly teamSize: number; readonly stressedRmvLpm: LitersPerMinute }
  | { readonly kind: "custom"; readonly reserveVolumeL: Liters }
  | { readonly kind: "fixed"; readonly minimumPressureBar: BarGauge };

export type CavePlanInput = {
  readonly mode: PlanningMode;
  readonly dive: OcDiveInput | CcrDiveInput;
  readonly route: readonly RouteLeg[];
  readonly reserve: CaveReserveSemantics;
  readonly turnPressureBar?: BarGauge;
  readonly turnTimeSeconds?: Seconds;
  readonly maximumPenetrationDistanceM?: Meters;
  readonly maximumPenetrationTimeSeconds?: Seconds;
  readonly scenarios?: readonly CaveScenarioRequest[];
};

export type CaveScenarioRequest = {
  readonly kind: CaveScenarioKind;
  readonly targetLegId?: string;
  readonly targetDistanceM?: Meters;
};

export type CaveRouteSummary = {
  readonly penetrationDistanceM: Meters;
  readonly exitDistanceM: Meters;
  readonly penetrationTimeSeconds: Seconds;
  readonly exitTimeSeconds: Seconds;
  readonly runtimeSeconds: Seconds;
};

export type CaveScenarioResult = {
  readonly kind: CaveScenarioKind;
  readonly targetLegId?: string;
  readonly plan?: DivePlan;
  readonly diagnostics: readonly Diagnostic[];
  readonly safe: boolean;
};

export type CavePlanResult = {
  readonly experimental: true;
  readonly base: DivePlan;
  readonly route: CaveRouteSummary;
  readonly exitTimeline: readonly RouteLeg[];
  readonly gasLedger: readonly GasLedgerEntry[];
  readonly limitingResource: "turn-pressure" | "penetration-distance" | "penetration-time" | "gas" | "none";
  /** Cylinder with the smallest modeled reserve margin for the limiting calculation. */
  readonly limitingCylinderId?: string;
  readonly reserveMarginL: Liters;
  /** Operational gauge threshold. For thirds/sixths this is 2/3 or 5/6 of starting pressure. */
  readonly turnPressureBar?: BarGauge;
  /** Cylinder whose operational turn threshold determines turnPressureBar. */
  readonly turnCylinderId?: string;
  /** Gas required at the modeled turnaround point to complete the exit and retain reserve. */
  readonly minimumRequiredAtTurnPressureBar?: BarGauge;
  readonly turnTimeSeconds?: Seconds;
  readonly maximumPermittedPenetrationDistanceM?: Meters;
  readonly maximumPermittedPenetrationTimeSeconds?: Seconds;
  readonly scenarios: readonly CaveScenarioResult[];
};

const error = (code: string, message: string, field?: string): Diagnostic => ({ code, severity: "error", message, field });
const warning = (code: string, message: string): Diagnostic => ({ code, severity: "warning", message });
const ok = <T>(
  value: T,
  warnings: readonly Diagnostic[] = [],
  errors: readonly Diagnostic[] = [],
): CalculationResult<T> => ({
  ok: true,
  value,
  warnings,
  ...(errors.length > 0 ? { errors } : {}),
});
const fail = <T>(errors: readonly Diagnostic[], warnings: readonly Diagnostic[] = []): CalculationResult<T> => ({ ok: false, errors, warnings });

function effectiveReserve(input: CavePlanInput): ReservePolicy {
  const reserve = input.reserve;
  return reserve.kind === "rock-bottom"
    ? { kind: "rock-bottom", teamSize: reserve.teamSize, stressedRmvLpm: reserve.stressedRmvLpm }
    : reserve;
}

function reverseLeg(leg: RouteLeg, index: number): RouteLeg {
  return { ...leg, id: `exit-${index + 1}-${leg.id}`, startDepthM: leg.endDepthM, endDepthM: leg.startDepthM, stageAction: leg.stageAction === "drop" ? "recover" : leg.stageAction === "recover" ? "drop" : "none" };
}

function validate(input: CavePlanInput): Diagnostic[] {
  const d: Diagnostic[] = [];
  const finite = (value: number | undefined, code: string, message: string, field: string, positive = false) => {
    if (value !== undefined && (!Number.isFinite(value) || (positive ? value <= 0 : value < 0))) {
      d.push(error(code, message, field));
    }
  };
  if (input.mode !== input.dive.mode) d.push(error("MODE_MISMATCH", "Cave mode must match the production dive input.", "mode"));
  if (input.route.length === 0) d.push(error("ROUTE_REQUIRED", "At least one penetration leg is required.", "route"));
  let previous: RouteLeg | undefined;
  let distance = 0;
  let time = 0;
  const ids = new Set<string>();
  for (const [index, leg] of input.route.entries()) {
    const field = `route.${index}`;
    if (ids.has(leg.id)) d.push(error("LEG_ID_DUPLICATE", `Route leg id ${leg.id} is duplicated.`, `${field}.id`));
    ids.add(leg.id);
    if (!Number.isFinite(leg.startDepthM) || !Number.isFinite(leg.endDepthM) || leg.startDepthM < 0 || leg.endDepthM < 0 || leg.startDepthM > input.dive.depthM || leg.endDepthM > input.dive.depthM) d.push(error("LEG_DEPTH_INVALID", "Route depths must be finite and within the planned maximum depth.", field));
    if (leg.durationSeconds <= 0 || !Number.isFinite(leg.durationSeconds)) d.push(error("LEG_DURATION_INVALID", "Route duration must be positive and finite.", `${field}.durationSeconds`));
    if (leg.distanceM < 0 || !Number.isFinite(leg.distanceM)) d.push(error("LEG_DISTANCE_INVALID", "Route distance must be finite and nonnegative.", `${field}.distanceM`));
    if (previous && Math.abs(previous.endDepthM - leg.startDepthM) > 1e-8) d.push(error("LEG_DISCONTINUITY", "Route legs must form a continuous depth timeline.", `${field}.startDepthM`));
    for (const cylinderId of leg.accessibleCylinderIds) if (!input.dive.cylinders.some((cylinder) => cylinder.id === cylinderId)) d.push(error("CYLINDER_INACCESSIBLE", `Accessible cylinder ${cylinderId} is not in the plan cylinders.`, field));
    if (leg.stageAction !== undefined && leg.stageAction !== "none" && !leg.stageCylinderId) d.push(error("STAGE_ID_REQUIRED", "A stage drop/recovery requires stageCylinderId.", field));
    if (leg.stageCylinderId && !leg.accessibleCylinderIds.includes(leg.stageCylinderId)) d.push(error("STAGE_NOT_ACCESSIBLE", "Stage cylinder must be accessible on the leg where it is manipulated.", field));
    previous = leg; distance += leg.distanceM; time += leg.durationSeconds;
  }
  const dropped = new Set<string>();
  for (const leg of input.route) {
    for (const cylinderId of leg.accessibleCylinderIds) {
      if (dropped.has(cylinderId) && !(leg.stageAction === "recover" && leg.stageCylinderId === cylinderId)) {
        d.push(error("STAGE_ACCESS_AFTER_DROP", `Dropped stage ${cylinderId} cannot be accessible beyond its drop point.`, leg.id));
      }
    }
    if (leg.stageAction === "drop") {
      if (dropped.has(leg.stageCylinderId!)) d.push(error("STAGE_DROP_ORDER", "A stage cannot be dropped twice.", leg.id));
      dropped.add(leg.stageCylinderId!);
    }
    if (leg.stageAction === "recover") {
      if (!dropped.has(leg.stageCylinderId!)) d.push(error("STAGE_RECOVERY_ORDER", "A stage must be dropped before it is recovered.", leg.id));
      dropped.delete(leg.stageCylinderId!);
    }
  }
  finite(input.turnPressureBar, "TURN_PRESSURE_INVALID", "Turn pressure must be positive and finite.", "turnPressureBar", true);
  finite(input.turnTimeSeconds, "TURN_TIME_INVALID", "Turn time must be positive and finite.", "turnTimeSeconds", true);
  finite(input.maximumPenetrationDistanceM, "PENETRATION_DISTANCE_INVALID", "Maximum penetration distance must be finite and nonnegative.", "maximumPenetrationDistanceM");
  finite(input.maximumPenetrationTimeSeconds, "PENETRATION_TIME_INVALID", "Maximum penetration time must be positive and finite.", "maximumPenetrationTimeSeconds", true);
  if (input.maximumPenetrationDistanceM !== undefined && Number.isFinite(input.maximumPenetrationDistanceM) && distance > input.maximumPenetrationDistanceM) d.push(error("PENETRATION_DISTANCE_LIMIT", "Route exceeds maximum permitted penetration distance.", "maximumPenetrationDistanceM"));
  if (input.maximumPenetrationTimeSeconds !== undefined && Number.isFinite(input.maximumPenetrationTimeSeconds) && time > input.maximumPenetrationTimeSeconds) d.push(error("PENETRATION_TIME_LIMIT", "Route exceeds maximum permitted penetration time.", "maximumPenetrationTimeSeconds"));
  const reserve = input.reserve;
  if (reserve.kind === "custom") finite(reserve.reserveVolumeL, "RESERVE_INVALID", "Custom reserve volume must be finite and nonnegative.", "reserve.reserveVolumeL");
  if (reserve.kind === "fixed") finite(reserve.minimumPressureBar, "RESERVE_INVALID", "Fixed reserve pressure must be finite and nonnegative.", "reserve.minimumPressureBar");
  if (reserve.kind === "rock-bottom") {
    finite(reserve.teamSize, "RESERVE_INVALID", "Rock-bottom team size must be positive and finite.", "reserve.teamSize", true);
    finite(reserve.stressedRmvLpm, "RESERVE_INVALID", "Rock-bottom RMV must be positive and finite.", "reserve.stressedRmvLpm", true);
  }
  for (const request of input.scenarios ?? []) {
    finite(request.targetDistanceM, "SCENARIO_TARGET_INVALID", "Scenario target distance must be finite and nonnegative.", "targetDistanceM");
  }
  return d;
}

function event(id: string, kind: "descent" | "penetration" | "exit", leg: RouteLeg, gas: Gas, strategy: ExposureEvent["strategy"]): ExposureEvent {
  return { id, kind, startDepthM: leg.startDepthM, endDepthM: leg.endDepthM, durationSeconds: leg.durationSeconds, gas, strategy };
}

function registeredOcGases(dive: OcDiveInput): readonly Gas[] {
  return [dive.bottomGas, ...(dive.travelGas ? [dive.travelGas] : []), ...dive.decoGases];
}

function gasAndCylinderCandidates(
  input: CavePlanInput,
  leg: RouteLeg,
  gases: readonly Gas[],
  excludedCylinderIds: ReadonlySet<string>,
): readonly { gas: Gas; cylinder: Cylinder }[] {
  const accessible = new Set(leg.accessibleCylinderIds);
  return gases.flatMap((gas) => {
    const cylinder = resolveAssignedCylinder(gas, input.dive.cylinders);
    return cylinder && accessible.has(cylinder.id) && !excludedCylinderIds.has(cylinder.id)
      ? [{ gas, cylinder }]
      : [];
  });
}

function entranceAccessibleGases(
  input: CavePlanInput,
  gases: readonly Gas[],
  excludedCylinderIds: ReadonlySet<string> = new Set<string>(),
): readonly Gas[] {
  const entranceLeg = input.route[0];
  if (!entranceLeg) return [];
  return gasAndCylinderCandidates(input, entranceLeg, gases, excludedCylinderIds)
    .map(({ gas }) => gas);
}

function baseAscentGases(input: CavePlanInput): readonly Gas[] {
  return input.dive.mode === "oc"
    ? entranceAccessibleGases(input, registeredOcGases(input.dive))
    : entranceAccessibleGases(input, [input.dive.diluent]);
}

function gasBreathableOnLeg(
  input: CavePlanInput,
  gas: Gas,
  cylinder: Cylinder,
  leg: RouteLeg,
  planMaximumPPO2: BarAbsolute,
  respectPlannedTravelSwitch: boolean,
): boolean {
  const maximum = Math.min(planMaximumPPO2, cylinder.maximumPPO2);
  const maximumDepth = Math.max(leg.startDepthM, leg.endDepthM);
  const minimumDepth = Math.min(leg.startDepthM, leg.endDepthM);
  if (input.dive.mode === "oc") {
    const isBottom = gas.id === input.dive.bottomGas.id;
    const isTravel = gas.id === input.dive.travelGas?.id;
    if (respectPlannedTravelSwitch && input.dive.travelGas && isBottom && minimumDepth < ocBottomSwitchDepth(input.dive) - 1e-8) return false;
    if (respectPlannedTravelSwitch && isTravel && maximumDepth > ocBottomSwitchDepth(input.dive) + 1e-8) return false;
    if (!isBottom && !isTravel && gas.switchDepthM !== undefined && maximumDepth > gas.switchDepthM + 1e-8) return false;
  } else if (gas.switchDepthM !== undefined && maximumDepth > gas.switchDepthM + 1e-8) {
    return false;
  }
  return [leg.startDepthM, leg.endDepthM].every((depth) => {
    const ppo2 = gas.oxygen * depthToAmbientPressure(
      depth,
      input.dive.environmentSettings.surfacePressureBar,
      input.dive.environmentSettings.metersPerBar,
    );
    return ppo2 >= input.dive.settings.minimumPPO2 - 1e-8 && ppo2 <= maximum + 1e-8;
  });
}

function selectAccessibleGas(
  input: CavePlanInput,
  leg: RouteLeg,
  gases: readonly Gas[],
  excludedCylinderIds: ReadonlySet<string>,
  planMaximumPPO2: BarAbsolute,
  respectPlannedTravelSwitch = true,
): Gas | undefined {
  return gasAndCylinderCandidates(input, leg, gases, excludedCylinderIds)
    .filter(({ gas, cylinder }) => gasBreathableOnLeg(input, gas, cylinder, leg, planMaximumPPO2, respectPlannedTravelSwitch))
    .slice()
    .sort((left, right) => right.gas.oxygen - left.gas.oxygen || left.gas.id.localeCompare(right.gas.id))[0]?.gas;
}

function targetRoute(input: CavePlanInput, request: CaveScenarioRequest): { route: RouteLeg[]; targetIndex: number; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const targetDistance = request.targetDistanceM;
  if (targetDistance !== undefined && (targetDistance < 0 || targetDistance > input.route.reduce((sum, leg) => sum + leg.distanceM, 0))) {
    diagnostics.push(error("SCENARIO_TARGET_INVALID", "targetDistanceM must be within the penetration route.", "targetDistanceM"));
    return { route: [], targetIndex: -1, diagnostics };
  }
  let targetIndex = request.targetLegId ? input.route.findIndex((leg) => leg.id === request.targetLegId) : input.route.length - 1;
  if (targetIndex < 0) return { route: [], targetIndex, diagnostics: [error("SCENARIO_TARGET_INVALID", "Scenario target leg does not exist.", "targetLegId")] };
  if (targetDistance !== undefined) {
    let cursor = 0;
    targetIndex = input.route.findIndex((leg) => { const hit = targetDistance <= cursor + leg.distanceM; cursor += leg.distanceM; return hit; });
    const leg = input.route[targetIndex];
    const before = cursor - leg.distanceM;
    const fraction = leg.distanceM === 0 ? 0 : (targetDistance - before) / leg.distanceM;
    const partial: RouteLeg = { ...leg, id: `${leg.id}-at-${Math.round(targetDistance)}`, durationSeconds: seconds(leg.durationSeconds * Math.max(0, Math.min(1, fraction))), distanceM: meters(targetDistance - before), endDepthM: meters(leg.startDepthM + (leg.endDepthM - leg.startDepthM) * fraction) };
    if (partial.durationSeconds <= 0) diagnostics.push(error("SCENARIO_TARGET_INVALID", "targetDistanceM must select a positive-duration penetration point.", "targetDistanceM"));
    return { route: [...input.route.slice(0, targetIndex), partial], targetIndex, diagnostics };
  }
  return { route: input.route.slice(0, targetIndex + 1), targetIndex, diagnostics };
}

function splitLegAtDepth(leg: RouteLeg, boundaryDepthM: Meters): readonly RouteLeg[] {
  const crosses =
    (leg.startDepthM < boundaryDepthM - 1e-8 && leg.endDepthM > boundaryDepthM + 1e-8) ||
    (leg.startDepthM > boundaryDepthM + 1e-8 && leg.endDepthM < boundaryDepthM - 1e-8);
  if (!crosses) return [leg];
  const fraction = Math.abs((boundaryDepthM - leg.startDepthM) / (leg.endDepthM - leg.startDepthM));
  const first: RouteLeg = {
    ...leg,
    id: `${leg.id}-before-${boundaryDepthM}`,
    endDepthM: boundaryDepthM,
    durationSeconds: seconds(leg.durationSeconds * fraction),
    distanceM: meters(leg.distanceM * fraction),
    stageAction: "none",
    stageCylinderId: undefined,
  };
  const second: RouteLeg = {
    ...leg,
    id: `${leg.id}-after-${boundaryDepthM}`,
    startDepthM: boundaryDepthM,
    durationSeconds: seconds(leg.durationSeconds * (1 - fraction)),
    distanceM: meters(leg.distanceM * (1 - fraction)),
  };
  return [first, second];
}

function baseLegEvents(
  input: CavePlanInput,
  leg: RouteLeg,
  kind: "descent" | "penetration" | "exit",
  index: number,
): readonly ExposureEvent[] {
  const dive = input.dive;
  if (dive.mode === "ccr") {
    return splitLegAtDepth(leg, dive.setpointActivationDepthM).map((part, partIndex) => {
      const useCcr = Math.min(part.startDepthM, part.endDepthM) >= dive.setpointActivationDepthM - 1e-8;
      const strategy: ExposureEvent["strategy"] = useCcr
        ? { kind: "ccr", diluent: dive.diluent, setpointBar: dive.setpointBar }
        : { kind: "open-circuit", gas: dive.diluent };
      return event(`${kind}-${index + 1}-${partIndex + 1}-${leg.id}`, kind, part, dive.diluent, strategy);
    });
  }
  const boundary = dive.travelGas ? meters(ocBottomSwitchDepth(dive)) : undefined;
  const candidates = kind === "exit"
    ? registeredOcGases(dive)
    : [dive.bottomGas, ...(dive.travelGas ? [dive.travelGas] : [])];
  const planMaximumPPO2 = kind === "exit"
    ? dive.settings.maximumDecoPPO2
    : dive.settings.maximumBottomPPO2;
  return (boundary ? splitLegAtDepth(leg, boundary) : [leg]).flatMap((part, partIndex) => {
    const gas = selectAccessibleGas(input, part, candidates, new Set<string>(), planMaximumPPO2);
    return gas
      ? [event(`${kind}-${index + 1}-${partIndex + 1}-${leg.id}`, kind, part, gas, { kind: "open-circuit", gas })]
      : [];
  });
}

function validateBaseBreathingAccess(input: CavePlanInput): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const routeWithKinds = [
    ...input.route.map((leg) => ({ leg, kind: "penetration" as const })),
    ...input.route.slice().reverse().map((leg, index) => ({ leg: reverseLeg(leg, index), kind: "exit" as const })),
  ];
  for (const [index, { leg, kind }] of routeWithKinds.entries()) {
    if (input.dive.mode === "ccr") {
      const cylinder = resolveAssignedCylinder(input.dive.diluent, input.dive.cylinders);
      if (!cylinder || !leg.accessibleCylinderIds.includes(cylinder.id)) {
        diagnostics.push(error(
          "CYLINDER_INACCESSIBLE",
          `The assigned diluent cylinder is not accessible on ${kind} leg ${leg.id}.`,
          `route.${index}.accessibleCylinderIds`,
        ));
      }
      continue;
    }
    const boundary = input.dive.travelGas ? meters(ocBottomSwitchDepth(input.dive)) : undefined;
    const expectedParts = boundary ? splitLegAtDepth(leg, boundary).length : 1;
    if (baseLegEvents(input, leg, kind, index).length !== expectedParts) {
      diagnostics.push(error(
        "CYLINDER_INACCESSIBLE",
        `No assigned, accessible, breathable cylinder is available for ${kind} leg ${leg.id}.`,
        `route.${index}.accessibleCylinderIds`,
      ));
    }
  }
  const entrance = input.route[0];
  if (entrance && entrance.startDepthM > 0) {
    const ascentGases = baseAscentGases(input);
    const surfaceLeg: RouteLeg = {
      ...entrance,
      id: "post-exit-surface",
      startDepthM: meters(0),
      endDepthM: meters(0),
      durationSeconds: seconds(1),
      distanceM: meters(0),
      stageAction: "none",
      stageCylinderId: undefined,
    };
    const hasSurfaceGas = gasAndCylinderCandidates(input, surfaceLeg, ascentGases, new Set<string>())
      .some(({ gas, cylinder }) => gasBreathableOnLeg(
        input,
        gas,
        cylinder,
        surfaceLeg,
        input.dive.settings.maximumDecoPPO2,
        false,
      ));
    if (!hasSurfaceGas) {
      diagnostics.push(error(
        "CAVE_ASCENT_GAS_UNAVAILABLE",
        "No assigned gas accessible at the cave entrance is breathable for the final ascent to the surface.",
        "route.0.accessibleCylinderIds",
      ));
    }
  }
  return diagnostics;
}

function penetrationEvents(input: CavePlanInput, route = input.route): ExposureEvent[] {
  const events: ExposureEvent[] = [];
  const first = route[0];
  if (first && first.startDepthM > 0) {
    const descent: RouteLeg = {
      id: "descent",
      startDepthM: meters(0),
      endDepthM: first.startDepthM,
      durationSeconds: seconds(first.startDepthM / input.dive.settings.descentRateMPerMinute * 60),
      distanceM: meters(0),
      propulsion: "fins",
      accessibleCylinderIds: first.accessibleCylinderIds,
    };
    events.push(...baseLegEvents(input, descent, "descent", 0));
  }
  route.forEach((leg, index) => events.push(...baseLegEvents(input, leg, "penetration", index)));
  return events;
}

function baseEvents(input: CavePlanInput): ExposureEvent[] {
  const events = penetrationEvents(input);
  input.route.slice().reverse().forEach((leg, index) => {
    events.push(...baseLegEvents(input, reverseLeg(leg, index), "exit", index));
  });
  return events;
}

function surfaceUseForCylinder(
  events: readonly ExposureEvent[],
  input: CavePlanInput,
  cylinder: Cylinder,
  rmvLpm: LitersPerMinute,
): number {
  return events
    .filter((item) => resolveAssignedCylinder(item.gas, input.dive.cylinders)?.id === cylinder.id)
    .reduce((sum, item) => sum + integratedSurfaceGas({
      startDepthM: item.startDepthM,
      endDepthM: item.endDepthM,
      durationSeconds: item.durationSeconds,
      rmvLpm,
    }, input.dive.environmentSettings.surfacePressureBar, input.dive.environmentSettings.metersPerBar), 0);
}

function gasLimits(input: CavePlanInput, routeEvents: readonly ExposureEvent[], basePlan: DivePlan): {
  turnPressureBar?: BarGauge;
  turnCylinderId?: string;
  limitingCylinderId?: string;
  minimumRequiredAtTurnPressureBar?: BarGauge;
  turnTimeSeconds?: Seconds;
  maximumDistanceM?: Meters;
  maximumTimeSeconds?: Seconds;
  reserveMarginL?: Liters;
  gasLedger?: readonly GasLedgerEntry[];
  diagnostics: Diagnostic[];
} {
  const diagnostics: Diagnostic[] = [];
  const limitPlan = input.dive.mode === "ccr" ? calculateCcrTurnLimitPlan(input) : basePlan;
  if (input.dive.mode === "ccr" && !limitPlan) {
    return { diagnostics: [error("GAS_LIMIT_UNDETERMINED", "The CCR bailout plan could not be calculated; no numeric penetration maximum is presented.")] };
  }
  const sourcePlan = limitPlan ?? basePlan;
  const ambiguous = sourcePlan.diagnostics.some((item) => item.severity === "warning" && (item.code === "CYLINDER_UNASSIGNED" || item.code === "CYLINDER_ASSIGNMENT_AMBIGUOUS"));
  if (ambiguous) return { diagnostics: [error("GAS_LIMIT_UNDETERMINED", "Gas consumption is unassigned or ambiguous; no numeric penetration maximum is presented.")] };
  const entries = sourcePlan.gasLedger.filter((entry) => entry.cylinderId && entry.startingVolumeL !== undefined && entry.reserveL !== undefined && entry.totalUsedL > 0);
  if (entries.length === 0) {
    return {
      diagnostics: [warning(
        "TURN_GAS_UNASSIGNED",
        input.dive.mode === "ccr"
          ? "No assigned bailout cylinder has modeled use; CCR bailout-derived turn limits are unavailable."
          : "No assigned accessible cylinder has modeled use; gas-derived penetration limits are unavailable.",
      )],
    };
  }
  const rmv = input.dive.mode === "ccr" ? input.dive.rmv.bailoutLpm : input.dive.rmv.bottomLpm;
  const routeTimeSeconds = input.route.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const routeDistanceM = input.route.reduce((sum, leg) => sum + leg.distanceM, 0);
  const cylinderById = new Map(input.dive.cylinders.map((cylinder) => [cylinder.id, cylinder]));
  const limitEntries = sourcePlan.gasLedger;
  const actual = entries.map((entry) => {
    const cylinder = cylinderById.get(entry.cylinderId!);
    const limitEntry = limitEntries.find((candidate) => candidate.cylinderId === entry.cylinderId) ?? entry;
    const starting = entry.startingVolumeL!;
    const reserve = entry.reserveL!;
    const totalUse = limitEntry.totalUsedL;
    const penetrationUse = cylinder
      ? surfaceUseForCylinder(routeEvents.filter((event) => event.kind === "descent" || event.kind === "penetration"), input, cylinder, rmv)
      : 0;
    return { entry, cylinder, starting, reserve, totalUse, penetrationUse };
  }).filter((item) => item.cylinder);
  const complete = actual.length > 0 && actual.every(({ starting, reserve, totalUse }) => Number.isFinite(starting) && Number.isFinite(reserve) && Number.isFinite(totalUse));
  if (!complete) return { diagnostics: [error("GAS_LIMIT_UNDETERMINED", "A finite per-cylinder gas limit could not be determined; no numeric maximum is presented.")] };

  const operationalValues = actual.map(({ entry, cylinder, penetrationUse }) => {
    if (input.reserve.kind === "thirds") return entry.startingPressureBar! * 2 / 3;
    if (input.reserve.kind === "sixths") return entry.startingPressureBar! * 5 / 6;
    return ((entry.reserveL ?? 0) + Math.max(0, (limitEntries.find((candidate) => candidate.cylinderId === entry.cylinderId)?.totalUsedL ?? 0) - penetrationUse)) / cylinder!.waterVolumeL;
  });
  const minimumValues = actual.map(({ entry, cylinder, penetrationUse }) => {
    const exitUse = Math.max(0, (limitEntries.find((candidate) => candidate.cylinderId === entry.cylinderId)?.totalUsedL ?? 0) - penetrationUse);
    return (exitUse + entry.reserveL!) / cylinder!.waterVolumeL;
  });
  const margins = actual.map(({ entry, cylinder, penetrationUse }, index) =>
    entry.startingVolumeL! - penetrationUse - minimumValues[index] * cylinder!.waterVolumeL);
  const operationalIndex = margins.reduce((best, value, index) => value < margins[best] ? index : best, 0);
  const operationalTurnPressure = operationalValues[operationalIndex];
  const turnCylinderId = actual[operationalIndex]?.entry.cylinderId;
  const minimumRequired = minimumValues[operationalIndex];
  const currentReserveMargins = entries.map((entry) => ({
    cylinderId: entry.cylinderId!,
    marginL: (entry.remainingVolumeL ?? Number.NEGATIVE_INFINITY) - entry.reserveL!,
  }));
  const currentLimiting = currentReserveMargins.reduce(
    (lowest, candidate) => candidate.marginL < lowest.marginL ? candidate : lowest,
  );

  // Re-plan each candidate route. This intentionally evaluates tissues, deco, and every cylinder ledger.
  const evaluate = (scale: number): { readonly safe: boolean; readonly plan?: DivePlan; readonly reason?: string } => {
    // Seconds are canonical integer quanta. Keep every scaled leg at one
    // second so the low-bound probe remains a valid route after conversion.
    const candidateRoute = input.route.map((leg) => ({
      ...leg,
      durationSeconds: seconds(Math.max(1, leg.durationSeconds * scale)),
      distanceM: meters(leg.distanceM * scale),
    }));
    const candidateInput = { ...input, route: candidateRoute, scenarios: [], maximumPenetrationDistanceM: undefined, maximumPenetrationTimeSeconds: undefined, turnTimeSeconds: undefined };
    const candidate = calculateCavePlanInternal(candidateInput, false);
    if (!candidate.ok) return { safe: false, reason: candidate.errors.map((item) => item.code).join(", ") || "candidate-plan-failed" };
    const candidatePlan = input.dive.mode === "ccr"
      ? calculateCcrTurnLimitPlan({ ...candidateInput, dive: { ...candidateInput.dive, environment: "cave", reservePolicy: effectiveReserve(candidateInput) } })
      : candidate.value.base;
    if (!candidatePlan) return { safe: false, reason: "candidate-bailout-plan-failed" };
    const insufficient = candidatePlan.gasLedger.filter((entry) => entry.cylinderId && !entry.sufficient);
    const errors = candidatePlan.diagnostics.filter((item) => item.severity === "error");
    return {
      safe: insufficient.length === 0 && errors.length === 0,
      plan: candidatePlan,
      ...((insufficient.length > 0 || errors.length > 0) ? {
        reason: [
          ...insufficient.map((entry) => `insufficient:${entry.cylinderId}`),
          ...errors.map((item) => item.code),
        ].join(", "),
      } : {}),
    };
  };
  let low = 1e-6;
  const minimumCandidate = evaluate(low);
  if (!minimumCandidate.safe) {
    diagnostics.push(error("GAS_LIMIT_UNDETERMINED", `No safe recalculated cave plan was found (${minimumCandidate.reason ?? "unknown reason"}), so no numeric penetration maximum is presented.`));
    return {
      turnPressureBar: barGauge(operationalTurnPressure),
      turnCylinderId,
      limitingCylinderId: currentLimiting.cylinderId,
      minimumRequiredAtTurnPressureBar: barGauge(minimumRequired),
      reserveMarginL: liters(currentLimiting.marginL),
      gasLedger: sourcePlan.gasLedger,
      diagnostics,
    };
  }
  let high = 1;
  while (high < 1024 && evaluate(high).safe) high *= 2;
  if (evaluate(high).safe) return {
    turnPressureBar: barGauge(operationalTurnPressure),
    turnCylinderId,
    limitingCylinderId: currentLimiting.cylinderId,
    minimumRequiredAtTurnPressureBar: barGauge(minimumRequired),
    reserveMarginL: liters(currentLimiting.marginL),
    gasLedger: sourcePlan.gasLedger,
    diagnostics: [error("GAS_LIMIT_UNDETERMINED", "The finite penetration search cap remained safe; no numeric maximum is presented.")],
  };
  for (let iteration = 0; iteration < 48; iteration += 1) {
    const midpoint = (low + high) / 2;
    if (evaluate(midpoint).safe) low = midpoint;
    else high = midpoint;
  }
  const maximumOneWayTimeSeconds = routeTimeSeconds * low;
  const maximumDistance = meters(routeDistanceM * low);
  const boundedPlan = evaluate(low).plan;
  const boundedMargins = boundedPlan?.gasLedger
    .filter((entry) => entry.cylinderId && entry.remainingVolumeL !== undefined && entry.reserveL !== undefined)
    .map((entry) => ({
      cylinderId: entry.cylinderId!,
      marginL: entry.remainingVolumeL! - entry.reserveL!,
    })) ?? [];
  const limitingAtBound = boundedMargins.length > 0
    ? boundedMargins.reduce((lowest, candidate) => candidate.marginL < lowest.marginL ? candidate : lowest)
    : currentLimiting;
  if (input.dive.mode === "ccr") {
    diagnostics.push(warning(
      "CCR_TURN_LIMIT_USES_BAILOUT",
      "CCR gas-derived turn limits use all actually used assigned bailout cylinders and bailout RMV.",
    ));
  }
  return {
    turnPressureBar: barGauge(operationalTurnPressure),
    turnCylinderId,
    limitingCylinderId: limitingAtBound.cylinderId,
    minimumRequiredAtTurnPressureBar: barGauge(minimumRequired),
    turnTimeSeconds: seconds(maximumOneWayTimeSeconds),
    maximumDistanceM: maximumDistance,
    maximumTimeSeconds: seconds(maximumOneWayTimeSeconds),
    reserveMarginL: liters(currentLimiting.marginL),
    gasLedger: sourcePlan.gasLedger,
    diagnostics,
  };
}

function scenarioEvents(input: CavePlanInput, request: CaveScenarioRequest): {
  events: ExposureEvent[];
  target?: RouteLeg;
  diagnostics: Diagnostic[];
  ascentGases?: readonly Gas[];
} {
  const selected = targetRoute(input, request);
  const diagnostics = [...selected.diagnostics];
  if (selected.targetIndex < 0 || diagnostics.some((item) => item.severity === "error")) return { events: [], diagnostics };
  const route = selected.route;
  const targetIndex = selected.targetIndex;
  const target = route[targetIndex];
  const dive = input.dive;
  const scenarioInput = { ...input, route };
  const prefix = penetrationEvents(scenarioInput, route);
  const ocScenario = request.kind !== "ccr-loop-failure";
  if (ocScenario && dive.mode !== "oc") {
    diagnostics.push(error("SCENARIO_MODE_INVALID", `${request.kind} requires an OC cave plan.`));
    return { events: [], target, diagnostics };
  }
  if (request.kind === "ccr-loop-failure" && (dive.mode !== "ccr" || dive.bailoutGases.length === 0)) {
    diagnostics.push(error("BAILOUT_GAS_REQUIRED", "CCR loop failure requires at least one assigned, accessible bailout gas."));
    return { events: [], target, diagnostics };
  }
  const excludedCylinderIds = new Set<string>();
  if (request.kind === "oc-lost-gas" && dive.mode === "oc") {
    const lostCylinder = resolveAssignedCylinder(dive.bottomGas, dive.cylinders);
    if (!lostCylinder) diagnostics.push(error("LOST_GAS_ASSIGNMENT_REQUIRED", "Lost-gas analysis requires a unique bottom-gas cylinder assignment."));
    else excludedCylinderIds.add(lostCylinder.id);
  }
  if (request.kind === "stage-failure") {
    if (!target.stageCylinderId) diagnostics.push(error("STAGE_FAILURE_TARGET_REQUIRED", "Stage failure must target a leg with a stage cylinder."));
    else excludedCylinderIds.add(target.stageCylinderId);
  }
  if (request.kind === "scooter-failure" && target.propulsion !== "scooter") diagnostics.push(error("SCENARIO_TARGET_INVALID", "Scooter failure must target a scooter-propelled leg."));
  if (diagnostics.some((item) => item.severity === "error")) return { events: [], target, diagnostics };

  const gases = dive.mode === "ccr" ? dive.bailoutGases : registeredOcGases(dive);
  const exitEvents: ExposureEvent[] = [];
  route.slice().reverse().forEach((leg, index) => {
    const reversed = reverseLeg(leg, index);
    const adjusted = request.kind === "scooter-failure" && leg.propulsion === "scooter"
      ? { ...reversed, durationSeconds: seconds(reversed.durationSeconds * 2) }
      : request.kind === "lost-buddy"
        ? { ...reversed, durationSeconds: seconds(reversed.durationSeconds * 2) }
        : reversed;
    const boundary = dive.mode === "oc" && dive.travelGas
      ? meters(ocBottomSwitchDepth(dive))
      : undefined;
    const parts = boundary ? splitLegAtDepth(adjusted, boundary) : [adjusted];
    parts.forEach((part, partIndex) => {
      const gas = selectAccessibleGas(
        input,
        part,
        gases,
        excludedCylinderIds,
        input.dive.settings.maximumDecoPPO2,
        false,
      );
      if (!gas) {
        diagnostics.push(error(
          "BAILOUT_ACCESS_INVALID",
          `No assigned, accessible, breathable gas remains for exit leg ${leg.id}.`,
          leg.id,
        ));
        return;
      }
      exitEvents.push(event(
        `scenario-exit-${index + 1}-${partIndex + 1}-${leg.id}`,
        "exit",
        part,
        gas,
        { kind: "open-circuit", gas },
      ));
    });
  });
  if (diagnostics.some((item) => item.severity === "error")) return { events: [], target, diagnostics };
  const ascentGases = entranceAccessibleGases(input, gases, excludedCylinderIds);
  if (request.kind === "ccr-loop-failure") {
    const bailout = exitEvents[0]?.gas;
    if (!bailout) return { events: [], target, diagnostics: [error("BAILOUT_ACCESS_INVALID", "No bailout gas is accessible at the loop-failure point.")] };
    const bailoutEvent: ExposureEvent = {
      id: "loop-failure-bailout",
      kind: "bailout",
      startDepthM: target.endDepthM,
      endDepthM: target.endDepthM,
      durationSeconds: seconds(1),
      gas: bailout,
      strategy: { kind: "open-circuit", gas: bailout },
    };
    return {
      events: [
        ...prefix,
        bailoutEvent,
        ...exitEvents.map((item): ExposureEvent => ({ ...item, kind: "bailout" })),
      ],
      target,
      diagnostics,
      ascentGases,
    };
  }
  return { events: [...prefix, ...exitEvents], target, diagnostics, ascentGases };
}

function calculateCcrTurnLimitPlan(input: CavePlanInput): DivePlan | undefined {
  if (input.dive.mode !== "ccr") return undefined;
  const generated = scenarioEvents(input, { kind: "ccr-loop-failure" });
  if (generated.diagnostics.some((item) => item.severity === "error")) return undefined;
  const result = calculateEventDivePlan(input.dive, generated.events, {
    ascentGases: generated.ascentGases,
    idSuffix: "turn-limit-ccr-bailout",
    bailout: true,
  });
  return result.ok ? result.value : undefined;
}

function calculateCavePlanInternal(input: CavePlanInput, solveLimits = true): CalculationResult<CavePlanResult> {
  const dive = { ...input.dive, environment: "cave" as const, reservePolicy: effectiveReserve(input) } as CavePlanInput["dive"];
  const normalizedInput = { ...input, dive };
  const diagnostics = [...validate(normalizedInput), ...validateBaseBreathingAccess(normalizedInput)];
  if (diagnostics.some((item) => item.severity === "error")) return fail(diagnostics);
  const routeEvents = baseEvents(normalizedInput);
  const eventResult = calculateEventDivePlan(dive, routeEvents, {
    ascentGases: baseAscentGases(normalizedInput),
  });
  if (!eventResult.ok) return eventResult;
  const base = eventResult.value;
  const limits = solveLimits ? gasLimits(normalizedInput, routeEvents, base) : { diagnostics: [] as Diagnostic[] };
  const routeDistance = input.route.reduce((sum, leg) => sum + leg.distanceM, 0);
  const routeTime = input.route.reduce((sum, leg) => sum + leg.durationSeconds, 0);
  const exitTimeline = input.route.slice().reverse().map((leg, index) => reverseLeg(leg, index));
  const baseReserveMargins = base.gasLedger
    .filter((entry) => entry.cylinderId && entry.remainingVolumeL !== undefined && entry.reserveL !== undefined)
    .map((entry) => ({ cylinderId: entry.cylinderId!, marginL: entry.remainingVolumeL! - entry.reserveL! }));
  const baseLimiting = baseReserveMargins.length > 0
    ? baseReserveMargins.reduce((lowest, candidate) => candidate.marginL < lowest.marginL ? candidate : lowest)
    : undefined;
  const limitMargin = limits.reserveMarginL ?? Number.POSITIVE_INFINITY;
  // A CCR cave result exposes the bailout contingency ledger, so its margin
  // and limiting-cylinder context must come from that same ledger. Normal
  // shallow diluent insufficiency still marks base.safetyStatus unsafe.
  const effectiveLimiting = input.mode === "ccr" && limits.gasLedger
    ? limits.limitingCylinderId
      ? { cylinderId: limits.limitingCylinderId, marginL: limitMargin }
      : undefined
    : baseLimiting && baseLimiting.marginL <= limitMargin
      ? baseLimiting
      : limits.limitingCylinderId
        ? { cylinderId: limits.limitingCylinderId, marginL: limitMargin }
        : baseLimiting;
  const reserveMarginL = effectiveLimiting?.marginL ?? Number.POSITIVE_INFINITY;
  const distanceLimits = [input.maximumPenetrationDistanceM, limits.maximumDistanceM]
    .filter((value): value is Meters => value !== undefined);
  const timeLimits = [input.maximumPenetrationTimeSeconds, input.turnTimeSeconds, limits.maximumTimeSeconds]
    .filter((value): value is Seconds => value !== undefined);
  const maximumDistance = distanceLimits.length > 0 ? meters(Math.min(...distanceLimits)) : undefined;
  const maximumTime = timeLimits.length > 0 ? seconds(Math.min(...timeLimits)) : undefined;
  const calculatedTurnPressure = limits.turnPressureBar;
  const turnPressure = input.turnPressureBar === undefined
    ? calculatedTurnPressure
    : calculatedTurnPressure === undefined
      ? input.turnPressureBar
      : barGauge(Math.max(input.turnPressureBar, calculatedTurnPressure));
  const safetyErrors: Diagnostic[] = [];
  if (input.turnPressureBar !== undefined && calculatedTurnPressure !== undefined && input.turnPressureBar < calculatedTurnPressure - 1e-8) {
    safetyErrors.push(error("TURN_PRESSURE_BELOW_CALCULATED", "Entered turn pressure is below the calculated operational turn threshold.", "turnPressureBar"));
  }
  if (maximumDistance !== undefined && routeDistance > maximumDistance + 1e-8) {
    safetyErrors.push(error("GAS_DISTANCE_LIMIT_EXCEEDED", "The route exceeds its gas-derived maximum penetration distance.", "route"));
  }
  if (maximumTime !== undefined && routeTime > maximumTime + 1e-8) {
    safetyErrors.push(error("GAS_TIME_LIMIT_EXCEEDED", "The route exceeds its gas-derived maximum penetration time.", "route"));
  }
  const limitErrors = limits.diagnostics.filter((item) => item.severity === "error");
  const limitWarnings = limits.diagnostics.filter((item) => item.severity !== "error");
  const limitingResource = reserveMarginL < 0 || base.safetyStatus === "unsafe" || limitErrors.length > 0
    ? "gas"
    : maximumDistance !== undefined && routeDistance >= maximumDistance - 1e-8
      ? "penetration-distance"
      : maximumTime !== undefined && routeTime >= maximumTime - 1e-8
        ? "penetration-time"
        : input.turnPressureBar !== undefined && calculatedTurnPressure !== undefined && input.turnPressureBar < calculatedTurnPressure
          ? "turn-pressure"
          : "none";
  const defaultScenarios: readonly CaveScenarioRequest[] = input.mode === "oc"
    ? [{ kind: "oc-lost-gas" }, { kind: "lost-buddy" }, { kind: "scooter-failure" }, { kind: "stage-failure" }]
    : [{ kind: "ccr-loop-failure" }];
  const scenarios = (input.scenarios ?? defaultScenarios).map((request) => {
    const generated = scenarioEvents({ ...input, dive }, request);
    if (generated.diagnostics.some((item) => item.severity === "error")) return { kind: request.kind, targetLegId: request.targetLegId, diagnostics: generated.diagnostics, safe: false };
    const result = calculateEventDivePlan(dive, generated.events, {
      ascentGases: generated.ascentGases,
      idSuffix: `scenario-${request.kind}-${request.targetLegId ?? "end"}`,
      bailout: request.kind === "ccr-loop-failure",
    });
    return result.ok
      ? {
          kind: request.kind,
          targetLegId: request.targetLegId,
          plan: result.value,
          diagnostics: result.value.diagnostics,
          safe: result.value.safetyStatus === "calculated" && !(result.errors?.length),
        }
      : { kind: request.kind, targetLegId: request.targetLegId, diagnostics: result.errors, safe: false };
  });
  return ok({
    experimental: true,
    base,
    route: {
      penetrationDistanceM: meters(routeDistance),
      exitDistanceM: meters(routeDistance),
      penetrationTimeSeconds: seconds(routeTime),
      exitTimeSeconds: seconds(routeTime),
      runtimeSeconds: base.summary.runtimeSeconds,
    },
    exitTimeline,
    // For CCR this is the exact end-of-penetration bailout contingency ledger;
    // normal loop oxygen/diluent consumables remain explicitly unmodeled.
    gasLedger: limits.gasLedger ?? base.gasLedger,
    limitingResource,
    ...(effectiveLimiting?.cylinderId !== undefined ? { limitingCylinderId: effectiveLimiting.cylinderId } : {}),
    reserveMarginL: liters(reserveMarginL === Infinity ? 0 : reserveMarginL),
    ...(turnPressure !== undefined ? { turnPressureBar: turnPressure } : {}),
    ...(limits.turnCylinderId !== undefined ? { turnCylinderId: limits.turnCylinderId } : {}),
    ...(limits.minimumRequiredAtTurnPressureBar !== undefined
      ? { minimumRequiredAtTurnPressureBar: limits.minimumRequiredAtTurnPressureBar }
      : {}),
    ...(maximumTime !== undefined ? { turnTimeSeconds: maximumTime } : {}),
    ...(maximumDistance !== undefined ? { maximumPermittedPenetrationDistanceM: maximumDistance } : {}),
    ...(maximumTime !== undefined ? { maximumPermittedPenetrationTimeSeconds: maximumTime } : {}),
    scenarios,
  }, [
    warning("CAVE_EXPERIMENTAL", "Cave results are experimental decision support and require qualified-diver review."),
    ...limitWarnings,
  ], [...safetyErrors, ...limitErrors]);
}

export function calculateCavePlan(input: CavePlanInput): CalculationResult<CavePlanResult> {
  return calculateCavePlanInternal(input, true);
}

export const calculateCaveDivePlan = calculateCavePlan;
