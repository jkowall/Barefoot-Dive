import type { ReactNode } from "react";
import type { DivePlan, GasLedgerEntry } from "../domain/types";
import {
  GasLedger,
  Panel,
  ProfileChart,
  ResultMetric,
  RuntimeSchedule,
  WarningList,
  type ChartSegmentInput,
  type GasLedgerRow,
  type ReserveCrossingInput,
  type RuntimeRow,
  type WarningItem,
} from "../ui";
import { ActionButton } from "./controls";
import { groupRuntimeSegments } from "./runtimeRows";
import {
  depthFromCanonical,
  depthUnit,
  formatDepth,
  formatDuration,
  formatPressure,
  formatSurfaceGas,
  ratedCapacityFromCanonical,
  type UnitPreferences,
} from "./helpers";

function warningsFor(plan: DivePlan): readonly WarningItem[] {
  return plan.diagnostics.map((diagnostic, index) => ({
    id: `${diagnostic.code}-${index}`,
    message: diagnostic.message,
    severity: diagnostic.severity,
  }));
}

function profileSegments(plan: DivePlan, preferences: UnitPreferences): readonly ChartSegmentInput[] {
  return plan.segments.map((segment) => ({
    id: segment.id,
    kind: segment.kind,
    startRuntimeSeconds: segment.startRuntimeSeconds,
    endRuntimeSeconds: segment.startRuntimeSeconds + segment.durationSeconds,
    startDepth: depthFromCanonical(segment.startDepthM, preferences.depth),
    endDepth: depthFromCanonical(segment.endDepthM, preferences.depth),
    endpointCeiling: depthFromCanonical(segment.ceilingDepthM, preferences.depth),
    breathingLabel: segment.gasName,
    planMode: plan.mode === "oc" ? "Open circuit" : "CCR",
    ...(segment.setpointBar === undefined ? {} : { setpoint: segment.setpointBar }),
  }));
}

function profileReserveCrossings(plan: DivePlan, preferences: UnitPreferences): readonly ReserveCrossingInput[] {
  return plan.gasLedger.flatMap((entry, index) => {
    if (!entry.reserveCrossing) return [];
    const crossing = entry.reserveCrossing;
    return [{
      id: `reserve-${entry.cylinderId ?? entry.gasId}-${index}`,
      runtimeSeconds: crossing.runtimeSeconds,
      depth: depthFromCanonical(crossing.depthM, preferences.depth),
      label: `${entry.cylinderName ?? entry.gasName} reserve crossing`,
      detail: `Expected ${formatPressure(crossing.expectedPressureBar, preferences.pressure)} · required ${formatPressure(crossing.requiredPressureBar, preferences.pressure)}`,
      tone: entry.sufficient ? "warning" as const : "danger" as const,
    }];
  });
}

function runtimeRows(plan: DivePlan, preferences: UnitPreferences): readonly RuntimeRow[] {
  return groupRuntimeSegments(plan.segments).map((segment) => ({
    runtime: String(Math.round(segment.startRuntimeSeconds / 60)),
    depth: formatDepth(segment.endDepthM, preferences.depth),
    duration: formatDuration(segment.durationSeconds),
    gas: segment.gasName,
    event: segment.kind.replaceAll("-", " "),
  }));
}

function ledgerRow(entry: GasLedgerEntry, preferences: UnitPreferences): GasLedgerRow {
  const capacity = preferences.cylinderCapacity;
  const volume = (litersValue: number) => formatSurfaceGas(litersValue, capacity);
  if (entry.gasOnly) {
    return {
      gas: entry.gasName,
      used: volume(entry.totalUsedL),
      reserve: entry.reserveL === undefined ? undefined : volume(entry.reserveL),
      required: entry.requiredVolumeL === undefined ? undefined : volume(entry.requiredVolumeL),
      status: "unchecked",
    };
  }
  const context = entry.cylinderWaterVolumeL === undefined
    ? undefined
    : capacity === "imperial" && entry.workingPressureBar !== undefined
      ? `${ratedCapacityFromCanonical(entry.cylinderWaterVolumeL, entry.workingPressureBar, capacity).toFixed(1)} ft³ cylinder`
      : `${entry.cylinderWaterVolumeL.toFixed(1)} L cylinder`;
  const remaining = entry.remainingVolumeL === undefined
    ? undefined
    : entry.remainingPressureBar === undefined || !context
      ? volume(entry.remainingVolumeL)
      : `${volume(entry.remainingVolumeL)} · ${formatPressure(entry.remainingPressureBar, preferences.pressure)} in ${context}`;
  const reserve = entry.reserveL === undefined
    ? undefined
    : `${volume(entry.reserveL)}${entry.cylinderWaterVolumeL === undefined ? "" : ` · ${context}`}`;
  const dilOut = entry.preBailoutDeductionL === undefined
    ? ""
    : ` · diluent, bailout use only after ${volume(entry.preBailoutDeductionL)} used before bailout`;
  return {
    gas: `${entry.cylinderName ?? entry.gasName}${context ? ` · ${context}` : ""}${dilOut}`,
    used: volume(entry.totalUsedL),
    reserve,
    remaining,
    status: entry.sufficient ? "ok" : entry.reserveCrossing ? "short" : "warning",
  };
}

function ScheduleAndLedger({ plan, preferences, title, compact = false }: {
  readonly plan: DivePlan;
  readonly preferences: UnitPreferences;
  readonly title: string;
  readonly compact?: boolean;
}) {
  const rows = runtimeRows(plan, preferences);
  const ledger = plan.gasLedger.map((entry) => ledgerRow(entry, preferences));
  const gasOnly = plan.gasLedger.some((entry) => entry.gasOnly);
  // Plans on the first-stop boundary carry an info diagnostic; say so for the older rule too.
  const decoRmvFromBottomEnd = plan.mode === "oc" &&
    plan.environment === "open-water" &&
    !plan.diagnostics.some((item) => item.code === "DECO_RMV_FROM_FIRST_STOP");
  const ledgerView = ledger.length === 0
    ? <p className="bf-panel__note">No open-circuit gas is breathed on this plan. Loop oxygen and diluent use are not modeled{plan.mode === "ccr" ? "; bailout gas is accounted for in the CCR bailout plan" : ""}.</p>
    : <>
      <GasLedger rows={ledger} />
      {gasOnly && <p className="bf-panel__note">Minimum to carry is the surface volume for expected use plus the reserve policy. It excludes unusable residual gas and any per-cylinder minimum pressure.</p>}
      {decoRmvFromBottomEnd && <p className="bf-panel__note">Gas use charges the deco RMV from the end of bottom time, including the climb to the first stop (the rule before 0.5.0).</p>}
    </>;
  return <>
    <Panel title={`${title} profile`}>
      <ProfileChart
        key={`${plan.id}-${preferences.depth}`}
        reserveCrossings={profileReserveCrossings(plan, preferences)}
        segments={profileSegments(plan, preferences)}
        title={`${title} profile timeline`}
        unit={depthUnit(preferences.depth)}
      />
    </Panel>
    {compact ? <Panel title={`${title} tables`}>
      <details className="bf-disclosure">
        <summary>Runtime schedule <span>{rows.length} rows</span></summary>
        <RuntimeSchedule rows={rows} />
      </details>
      <details className="bf-disclosure">
        <summary>Gas ledger <span>{ledger.length} {gasOnly ? "gases" : "cylinders"}</span></summary>
        {ledgerView}
      </details>
    </Panel> : <>
      <Panel title={`${title} runtime`}>
        <RuntimeSchedule rows={rows} />
      </Panel>
      <Panel title={`${title} gas ledger`}>
        {ledgerView}
      </Panel>
    </>}
  </>;
}

export function PlanResultView({
  plan,
  preferences,
  stale = false,
  onSave,
  title = "Calculated plan",
  completion,
  compact = false,
}: {
  readonly plan: DivePlan;
  readonly preferences: UnitPreferences;
  readonly stale?: boolean;
  readonly onSave?: () => void;
  readonly title?: string;
  readonly completion?: ReactNode;
  /** Fold the runtime and ledger tables behind disclosures; used for nested cave scenario output. */
  readonly compact?: boolean;
}) {
  return <section className="bf-results" aria-label={title}>
    {completion}
    <Panel
      actions={onSave ? <ActionButton disabled={stale} onClick={onSave}>Save snapshot</ActionButton> : undefined}
      eyebrow={stale ? "Inputs changed · recalculate before saving" : plan.metadata.validationStatus}
      title={title}
    >
      <div className="bf-metric-grid">
        <ResultMetric label="Runtime" value={formatDuration(plan.summary.runtimeSeconds)} />
        <ResultMetric label="TTS" value={formatDuration(plan.summary.ttsSeconds)} />
        <ResultMetric label="Deco" value={formatDuration(plan.summary.decompressionSeconds)} />
        <ResultMetric label="Maximum depth" value={formatDepth(plan.summary.maximumDepthM, preferences.depth)} />
        <ResultMetric
          detail={`${plan.metadata.conventionId} · ${plan.metadata.engineVersion}`}
          kind="text"
          label="Safety status"
          tone={plan.safetyStatus === "unsafe" ? "danger" : "safe"}
          value={plan.safetyStatus === "unsafe" ? "Unsafe" : "Calculated"}
        />
      </div>
    </Panel>
    <WarningList items={warningsFor(plan)} title="Plan diagnostics" />
    <ScheduleAndLedger compact={compact} plan={plan} preferences={preferences} title="Primary" />
    {plan.bailoutPlan && <>
      <Panel eyebrow="Exact trigger tissue state" title="CCR bailout plan">
        <div className="bf-metric-grid">
          <ResultMetric label="Bailout runtime" value={formatDuration(plan.bailoutPlan.summary.runtimeSeconds)} />
          <ResultMetric label="Bailout TTS" value={formatDuration(plan.bailoutPlan.summary.ttsSeconds)} />
          <ResultMetric
            kind="text"
            label="Bailout status"
            tone={plan.bailoutPlan.safetyStatus === "unsafe" ? "danger" : "safe"}
            value={plan.bailoutPlan.safetyStatus}
          />
        </div>
      </Panel>
      <WarningList items={warningsFor(plan.bailoutPlan)} title="Bailout diagnostics" />
      <ScheduleAndLedger compact={compact} plan={plan.bailoutPlan} preferences={preferences} title="Bailout" />
    </>}
  </section>;
}
