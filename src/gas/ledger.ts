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

function rockBottomReserve(
  input: DivePlanInput,
  records: readonly ConsumptionRecord[],
): number {
  if (input.reservePolicy.kind !== "rock-bottom") return 0;
  const multiplier = input.reservePolicy.teamSize * input.reservePolicy.stressedRmvLpm;
  return records
    .filter((record) =>
      record.phase === "deco" ||
      record.segment.kind === "exit" ||
      record.segment.kind === "bailout" ||
      record.segment.kind === "ascent"
    )
    .reduce((total, record) => {
      const averageDepth = (record.segment.startDepthM + record.segment.endDepthM) / 2;
      const ambient = input.environmentSettings.surfacePressureBar +
        averageDepth / input.environmentSettings.metersPerBar;
      return total + multiplier * ambient * (record.segment.durationSeconds / 60);
    }, 0);
}

/**
 * Gas-only reserve for one gas, the inverse of the cylinder rules: with starting
 * volume S, thirds keeps S/3 so S >= 1.5 x used; sixths keeps 2S/3 so S >= 3 x used.
 * A fixed pressure reserve needs a cylinder size and is rejected by validation.
 */
function gasOnlyReserve(
  input: DivePlanInput,
  usedL: number,
  records: readonly ConsumptionRecord[],
): number | undefined {
  switch (input.reservePolicy.kind) {
    case "thirds":
      return usedL / 2;
    case "sixths":
      return usedL * 2;
    case "custom":
      return input.reservePolicy.reserveVolumeL;
    case "rock-bottom":
      return rockBottomReserve(input, records);
    case "fixed":
      return undefined;
  }
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
    case "rock-bottom":
      reserve = rockBottomReserve(input, records.filter((record) => record.cylinder?.id === cylinder.id));
      break;
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
    /**
     * Dil-out bailout ledger: the diluent cylinder starts bailout with its full volume minus
     * the diver-entered pre-bailout use and any modeled open-circuit diluent breathing before
     * the trigger. Its reserve stays on the full entered volume.
     */
    readonly diluentBailout?: { readonly gasId: string; readonly preBailoutUseL: number };
  },
): GasLedgerResult {
  const gasOnly = input.gasOnly === true;
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

  for (const gasId of gasOnly ? [] : missing) {
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

  if (gasOnly && records.length > 0) {
    diagnostics.push({
      code: "GAS_ONLY_VOLUMES",
      severity: "info",
      message: "Gas-only planning: volumes to carry include the reserve policy. Cylinder capacity, pressures, unusable residual gas, per-cylinder minimum pressure, and reserve crossings are not checked.",
    });
  }
  const preBailoutDeduction = (() => {
    const option = options.diluentBailout;
    if (!option) return undefined;
    const earlierOpenCircuitUse = segments
      .filter((segment) =>
        segment.startRuntimeSeconds < (options.startRuntimeSeconds ?? 0) &&
        segment.gasId === option.gasId &&
        segment.setpointBar === undefined &&
        segment.durationSeconds > 0
      )
      .reduce((total, segment) =>
        total + surfaceGasForSegment(segment, input, false, options.bottomEndRuntimeSeconds), 0);
    return { gasId: option.gasId, volumeL: option.preBailoutUseL + earlierOpenCircuitUse };
  })();

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
    const deduction = cylinder && preBailoutDeduction && group.some((record) => record.gasId === preBailoutDeduction.gasId)
      ? preBailoutDeduction.volumeL
      : undefined;
    const startingVolume = cylinder
      ? cylinder.waterVolumeL * cylinder.currentPressureBar - (deduction ?? 0)
      : undefined;
    const reserve = cylinder
      ? policyReserve(input, cylinder, records)
      : gasOnly
        ? gasOnlyReserve(input, totalUsed, group)
        : undefined;
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
      ...(!cylinder && gasOnly ? {
        gasOnly: true as const,
        ...(reserve !== undefined ? { requiredVolumeL: liters(totalUsed + reserve) } : {}),
      } : {}),
      ...(deduction !== undefined ? { preBailoutDeductionL: liters(deduction) } : {}),
      ...(reserveCrossing ? { reserveCrossing } : {}),
    });
  }
  for (const entry of entries) {
    if (entry.gasOnly && entry.reserveL !== undefined && entry.reserveL <= 0 && entry.totalUsedL > 0) {
      diagnostics.push({
        code: "GAS_ONLY_RESERVE_ZERO",
        severity: "warning",
        message: input.reservePolicy.kind === "rock-bottom"
          ? `${entry.gasName} has no rock-bottom reserve because it is not breathed on an ascent, decompression, exit, or bailout segment, so the volume to carry is only the planned use. Add a margin for it.`
          : `${entry.gasName} has no reserve under this policy, so the volume to carry is only the planned use.`,
        gasId: entry.gasId,
      });
    }
  }
  return { entries, diagnostics };
}

export function cylinderSurfaceVolume(cylinder: Cylinder): Liters {
  return liters(cylinder.waterVolumeL * cylinder.currentPressureBar);
}

export function pressureForVolume(volumeL: Liters, cylinder: Cylinder): BarGauge {
  return barGauge(volumeL / cylinder.waterVolumeL);
}
