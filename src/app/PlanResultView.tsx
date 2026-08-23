import type { ReactNode } from "react";
import type { DivePlan, GasLedgerEntry } from "../domain/types";
import {
  GasLedger,
  Panel,
  ProfileChart,
  ResultMetric,
  RuntimeSchedule,
  WarningList,
  type GasLedgerRow,
  type ProfilePoint,
  type RuntimeRow,
  type WarningItem,
} from "../ui";
import { ActionButton } from "./controls";
import {
  depthFromCanonical,
  depthUnit,
  formatDepth,
  formatDuration,
  formatPressure,
  type UnitPreferences,
} from "./helpers";

function warningsFor(plan: DivePlan): readonly WarningItem[] {
  return plan.diagnostics.map((diagnostic, index) => ({
    id: `${diagnostic.code}-${index}`,
    message: diagnostic.message,
    severity: diagnostic.severity,
  }));
}

function profilePoints(plan: DivePlan, preferences: UnitPreferences): readonly ProfilePoint[] {
  return plan.segments.map((segment) => ({
    runtime: formatDuration(segment.startRuntimeSeconds),
    depth: Number(depthFromCanonical(segment.endDepthM, preferences.depth).toFixed(1)),
    ceiling: Number(depthFromCanonical(segment.ceilingDepthM, preferences.depth).toFixed(1)),
    label: segment.kind,
  }));
}

function runtimeRows(plan: DivePlan, preferences: UnitPreferences): readonly RuntimeRow[] {
  return plan.segments.map((segment) => ({
    runtime: formatDuration(segment.startRuntimeSeconds),
    depth: formatDepth(segment.endDepthM, preferences.depth),
    duration: formatDuration(segment.durationSeconds),
    gas: segment.gasName,
    event: segment.kind.replaceAll("-", " "),
  }));
}

function ledgerRow(entry: GasLedgerEntry, preferences: UnitPreferences): GasLedgerRow {
  const context = entry.cylinderWaterVolumeL === undefined
    ? undefined
    : `${entry.cylinderWaterVolumeL.toFixed(1)} L cylinder`;
  const remaining = entry.remainingVolumeL === undefined
    ? undefined
    : entry.remainingPressureBar === undefined || !context
      ? `${Math.round(entry.remainingVolumeL)} L`
      : `${Math.round(entry.remainingVolumeL)} L · ${formatPressure(entry.remainingPressureBar, preferences.pressure)} in ${context}`;
  const reserve = entry.reserveL === undefined
    ? undefined
    : `${Math.round(entry.reserveL)} L${entry.cylinderWaterVolumeL === undefined ? "" : ` · ${context}`}`;
  return {
    gas: `${entry.cylinderName ?? entry.gasName}${context ? ` · ${context}` : ""}`,
    used: `${Math.round(entry.totalUsedL)} L`,
    reserve,
    remaining,
    status: entry.sufficient ? "ok" : entry.reserveCrossing ? "short" : "warning",
  };
}

function ScheduleAndLedger({ plan, preferences, title }: {
  readonly plan: DivePlan;
  readonly preferences: UnitPreferences;
  readonly title: string;
}) {
  return <>
    <Panel title={`${title} profile`}>
      <ProfileChart
        points={profilePoints(plan, preferences)}
        title={`${title} profile`}
        unit={depthUnit(preferences.depth)}
      />
    </Panel>
    <Panel title={`${title} runtime`}>
      <RuntimeSchedule rows={runtimeRows(plan, preferences)} />
    </Panel>
    <Panel title={`${title} gas ledger`}>
      <GasLedger rows={plan.gasLedger.map((entry) => ledgerRow(entry, preferences))} />
    </Panel>
  </>;
}

export function PlanResultView({
  plan,
  preferences,
  stale = false,
  onSave,
  title = "Calculated plan",
  completion,
}: {
  readonly plan: DivePlan;
  readonly preferences: UnitPreferences;
  readonly stale?: boolean;
  readonly onSave?: () => void;
  readonly title?: string;
  readonly completion?: ReactNode;
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
          label="Safety status"
          tone={plan.safetyStatus === "unsafe" ? "danger" : "safe"}
          value={plan.safetyStatus === "unsafe" ? "Unsafe" : "Calculated"}
        />
      </div>
    </Panel>
    <WarningList items={warningsFor(plan)} title="Plan diagnostics" />
    <ScheduleAndLedger plan={plan} preferences={preferences} title="Primary" />
    {plan.bailoutPlan && <>
      <Panel eyebrow="Exact trigger tissue state" title="CCR bailout plan">
        <div className="bf-metric-grid">
          <ResultMetric label="Bailout runtime" value={formatDuration(plan.bailoutPlan.summary.runtimeSeconds)} />
          <ResultMetric label="Bailout TTS" value={formatDuration(plan.bailoutPlan.summary.ttsSeconds)} />
          <ResultMetric
            label="Bailout status"
            tone={plan.bailoutPlan.safetyStatus === "unsafe" ? "danger" : "safe"}
            value={plan.bailoutPlan.safetyStatus}
          />
        </div>
      </Panel>
      <WarningList items={warningsFor(plan.bailoutPlan)} title="Bailout diagnostics" />
      <ScheduleAndLedger plan={plan.bailoutPlan} preferences={preferences} title="Bailout" />
    </>}
  </section>;
}
