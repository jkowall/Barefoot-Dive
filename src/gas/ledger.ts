import type {
  BarGauge,
  Cylinder,
  Diagnostic,
  DivePlanInput,
  GasLedgerEntry,
  Liters,
  ProfileSegment,
  Seconds,
} from "../domain/types";
import { integratedSurfaceGas } from "../calculations";
import { barGauge, liters, meters, seconds } from "../domain/units";

type ConsumptionRecord = {
  readonly segment: ProfileSegment;
  readonly cylinder?: Cylinder;
  readonly gasId: string;
  readonly gasName: string;
  readonly usedL: number;
  readonly phase: "bottom" | "deco";
};

export type GasLedgerResult = {
  readonly entries: readonly GasLedgerEntry[];
  readonly diagnostics: readonly Diagnostic[];
};

function findCylinder(
  segment: ProfileSegment,
  input: DivePlanInput,
): { cylinder?: Cylinder; ambiguous: boolean } {
  const gases = input.mode === "oc"
    ? [input.bottomGas, ...(input.travelGas ? [input.travelGas] : []), ...input.decoGases]
    : [input.diluent, ...input.bailoutGases];
  const gas = gases.find((candidate) => candidate.id === segment.gasId);
  if (gas?.cylinderId) {
    return {
      cylinder: input.cylinders.find((candidate) => candidate.id === gas.cylinderId),
      ambiguous: false,
    };
  }
  const candidates = input.cylinders.filter((candidate) => candidate.gas.id === segment.gasId);
  return { cylinder: candidates.length === 1 ? candidates[0] : undefined, ambiguous: candidates.length > 1 };
}

function surfaceGasForSegment(
  segment: ProfileSegment,
  input: DivePlanInput,
  bailout: boolean,
  bottomEndRuntimeSeconds: Seconds,
): number {
  const isDeco = bailout
    ? segment.kind === "stop"
    : segment.kind === "stop" || segment.startRuntimeSeconds >= bottomEndRuntimeSeconds;
  const rmv = bailout
    ? (isDeco ? input.rmv.bailoutDecoLpm : input.rmv.bailoutLpm)
    : (isDeco ? input.rmv.decoLpm : input.rmv.bottomLpm);
  return integratedSurfaceGas({
    startDepthM: segment.startDepthM,
    endDepthM: segment.endDepthM,
    durationSeconds: segment.durationSeconds,
    rmvLpm: rmv,
  }, input.environmentSettings.surfacePressureBar, input.environmentSettings.metersPerBar);
}

function consumptionFractionAtTime(
  record: ConsumptionRecord,
  input: DivePlanInput,
  elapsedFraction: number,
): number {
  const startPressure = input.environmentSettings.surfacePressureBar +
    record.segment.startDepthM / input.environmentSettings.metersPerBar;
  const endPressure = input.environmentSettings.surfacePressureBar +
    record.segment.endDepthM / input.environmentSettings.metersPerBar;
  const totalPressureIntegral = (startPressure + endPressure) / 2;
  const partialPressureIntegral = startPressure * elapsedFraction +
    (endPressure - startPressure) * elapsedFraction * elapsedFraction / 2;
  return totalPressureIntegral <= 0 ? 0 : partialPressureIntegral / totalPressureIntegral;
}

function crossingFraction(
  record: ConsumptionRecord,
  input: DivePlanInput,
  requiredUseL: number,
): number {
  if (requiredUseL <= 0) return 0;
  if (requiredUseL >= record.usedL) return 1;
  let lower = 0;
  let upper = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const midpoint = (lower + upper) / 2;
    const use = record.usedL * consumptionFractionAtTime(record, input, midpoint);
    if (use < requiredUseL) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

function policyReserve(
  input: DivePlanInput,
  cylinder: Cylinder,
  records: readonly ConsumptionRecord[],
): number {
  const starting = cylinder.waterVolumeL * cylinder.currentPressureBar;
  let reserve = 0;
  switch (input.reservePolicy.kind) {
    case "fixed":
      reserve = cylinder.waterVolumeL * input.reservePolicy.minimumPressureBar;
      break;
    case "custom":
      reserve = input.reservePolicy.reserveVolumeL;
      break;
    case "thirds":
      reserve = starting / 3;
      break;
    case "sixths":
      reserve = starting * 2 / 3;
      break;
    case "rock-bottom": {
      const multiplier = input.reservePolicy.teamSize *
        input.reservePolicy.stressedRmvLpm;
      reserve = records
        .filter((record) =>
          record.cylinder?.id === cylinder.id &&
          (
            record.phase === "deco" ||
            record.segment.kind === "exit" ||
            record.segment.kind === "bailout" ||
            record.segment.kind === "ascent"
          )
        )
        .reduce((total, record) => {
          const averageDepth = (record.segment.startDepthM + record.segment.endDepthM) / 2;
          const ambient = input.environmentSettings.surfacePressureBar +
            averageDepth / input.environmentSettings.metersPerBar;
          return total + multiplier * ambient * (record.segment.durationSeconds / 60);
        }, 0);
      break;
    }
  }
  const cylinderMinimum = cylinder.minimumPressureBar === undefined
    ? 0
    : cylinder.minimumPressureBar * cylinder.waterVolumeL;
  return Math.max(reserve, cylinderMinimum);
}

export function calculateGasLedger(
  segments: readonly ProfileSegment[],
  input: DivePlanInput,
  options: {
    readonly bailout?: boolean;
    readonly startRuntimeSeconds?: Seconds;
    readonly bottomEndRuntimeSeconds: Seconds;
  },
): GasLedgerResult {
  const diagnostics: Diagnostic[] = [];
  const records: ConsumptionRecord[] = [];
  const missing = new Set<string>();
  const ambiguous = new Set<string>();
  let bailoutStarted = !options.bailout;

  for (const segment of segments) {
    if (segment.startRuntimeSeconds < (options.startRuntimeSeconds ?? 0)) continue;
    if (options.bailout && segment.kind === "bailout") bailoutStarted = true;
    if (options.bailout && !bailoutStarted && segment.kind !== "gas-switch") continue;
    if (input.mode === "ccr" && segment.setpointBar !== undefined) continue;
    if (segment.durationSeconds <= 0) continue;
    const assignment = findCylinder(segment, input);
    if (!assignment.cylinder) {
      (assignment.ambiguous ? ambiguous : missing).add(segment.gasId);
    }
    const phase = options.bailout
      ? (segment.kind === "stop" ? "deco" : "bottom")
      : (segment.kind === "stop" || segment.startRuntimeSeconds >= options.bottomEndRuntimeSeconds
          ? "deco"
          : "bottom");
    records.push({
      segment,
      cylinder: assignment.cylinder,
      gasId: segment.gasId,
      gasName: segment.gasName,
      usedL: surfaceGasForSegment(
        segment,
        input,
        Boolean(options.bailout),
        options.bottomEndRuntimeSeconds,
      ),
      phase,
    });
  }

  for (const gasId of missing) {
    diagnostics.push({
      code: "CYLINDER_UNASSIGNED",
      severity: "warning",
      message: `Gas ${gasId} has consumption but no unique cylinder assignment.`,
      gasId,
    });
  }
  for (const gasId of ambiguous) {
    diagnostics.push({
      code: "CYLINDER_ASSIGNMENT_AMBIGUOUS",
      severity: "warning",
      message: `Gas ${gasId} matches multiple cylinders; assign one explicitly.`,
      gasId,
    });
  }
  if (input.mode === "ccr" && !options.bailout) {
    diagnostics.push({
      code: "CCR_LOOP_CONSUMABLES_NOT_MODELED",
      severity: "info",
      message: "Normal CCR oxygen metabolism and diluent flush/use are not inferred from OC RMV; bailout gas is modeled separately.",
    });
  }

  const keys = new Set(records.map((record) => record.cylinder?.id ?? `gas:${record.gasId}`));
  const entries: GasLedgerEntry[] = [];
  for (const key of keys) {
    const group = records.filter((record) => (record.cylinder?.id ?? `gas:${record.gasId}`) === key);
    const first = group[0];
    const cylinder = first.cylinder;
    const bottomUsed = group.filter((record) => record.phase === "bottom")
      .reduce((sum, record) => sum + record.usedL, 0);
    const decoUsed = group.filter((record) => record.phase === "deco")
      .reduce((sum, record) => sum + record.usedL, 0);
    const totalUsed = bottomUsed + decoUsed;
    const startingVolume = cylinder
      ? cylinder.waterVolumeL * cylinder.currentPressureBar
      : undefined;
    const reserve = cylinder ? policyReserve(input, cylinder, records) : undefined;
    const remaining = startingVolume === undefined ? undefined : startingVolume - totalUsed;
    const remainingPressure = cylinder && remaining !== undefined
      ? remaining / cylinder.waterVolumeL
      : undefined;
    let reserveCrossing: GasLedgerEntry["reserveCrossing"];
    if (cylinder && reserve !== undefined && startingVolume !== undefined) {
      let cumulative = 0;
      for (const record of group) {
        const availableBeforeRecord = startingVolume - cumulative;
        if (availableBeforeRecord - record.usedL < reserve - 1e-7) {
          const fraction = crossingFraction(
            record,
            input,
            Math.max(0, availableBeforeRecord - reserve),
          );
          const usedWithinRecord = record.usedL * consumptionFractionAtTime(record, input, fraction);
          const pressureValue = (availableBeforeRecord - usedWithinRecord) /
            cylinder.waterVolumeL;
          const crossingRuntime = seconds(
            record.segment.startRuntimeSeconds + record.segment.durationSeconds * fraction,
          );
          const crossingDepth = meters(
            record.segment.startDepthM +
              (record.segment.endDepthM - record.segment.startDepthM) * fraction,
          );
          reserveCrossing = {
            runtimeSeconds: crossingRuntime,
            depthM: crossingDepth,
            expectedPressureBar: barGauge(pressureValue),
            requiredPressureBar: barGauge(reserve / cylinder.waterVolumeL),
          };
          diagnostics.push({
            code: "RESERVE_CROSSED",
            severity: "error",
            message: `${cylinder.name} crosses reserve at ${crossingDepth.toFixed(1)} m and ${(crossingRuntime / 60).toFixed(1)} min.`,
            cylinderId: cylinder.id,
            gasId: first.gasId,
            runtimeSeconds: reserveCrossing.runtimeSeconds,
            depthM: reserveCrossing.depthM,
            actual: pressureValue,
            limit: reserveCrossing.requiredPressureBar,
          });
          break;
        }
        cumulative += record.usedL;
      }
    }
    entries.push({
      gasId: first.gasId,
      gasName: first.gasName,
      ...(cylinder ? {
        cylinderId: cylinder.id,
        cylinderName: cylinder.name,
        cylinderWaterVolumeL: cylinder.waterVolumeL,
        startingPressureBar: cylinder.currentPressureBar,
        workingPressureBar: cylinder.workingPressureBar,
        startingVolumeL: liters(startingVolume ?? 0),
      } : {}),
      bottomUsedL: liters(bottomUsed),
      decoUsedL: liters(decoUsed),
      totalUsedL: liters(totalUsed),
      ...(reserve !== undefined ? { reserveL: liters(reserve) } : {}),
      ...(remaining !== undefined ? { remainingVolumeL: liters(remaining) } : {}),
      ...(remainingPressure !== undefined ? { remainingPressureBar: barGauge(remainingPressure) } : {}),
      sufficient: reserve !== undefined && remaining !== undefined && remaining + 1e-7 >= reserve,
      ...(reserveCrossing ? { reserveCrossing } : {}),
    });
  }
  return { entries, diagnostics };
}

export function cylinderSurfaceVolume(cylinder: Cylinder): Liters {
  return liters(cylinder.waterVolumeL * cylinder.currentPressureBar);
}

export function pressureForVolume(volumeL: Liters, cylinder: Cylinder): BarGauge {
  return barGauge(volumeL / cylinder.waterVolumeL);
}
