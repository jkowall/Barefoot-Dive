import type { ReactNode } from "react";
import type { DivePlan, EnvironmentSettings, GasLedgerEntry } from "../domain/types";
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
import { formatDiagnostic } from "./diagnosticText";
import { loopPPO2AtRuntime } from "./loopPPO2";
import { runtimeScheduleRows, type GroupedRuntimeSegment } from "./runtimeRows";
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

/** One deco or bailout gas listed in Plan Review with an Include-in-plan switch. */
export type ReviewGasSwitch = {
  readonly key: string;
  readonly name: string;
  readonly included: boolean;
  readonly role: "deco" | "bailout";
};

function warningsFor(plan: DivePlan, preferences: UnitPreferences): readonly WarningItem[] {
  return plan.diagnostics.map((diagnostic, index) => ({
    id: `${diagnostic.code}-${index}`,
    message: formatDiagnostic(diagnostic, preferences.depth),
    severity: diagnostic.severity,
  }));
}

function profileSegments(
  plan: DivePlan,
  preferences: UnitPreferences,
  environment: EnvironmentSettings | undefined,
): readonly ChartSegmentInput[] {
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
    ...(environment === undefined || segment.heldSetpointBar === undefined ? {} : {
      loopPPO2At: (runtimeSeconds: number) => loopPPO2AtRuntime(segment, runtimeSeconds, environment),
    }),
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

function rowInstruction(row: GroupedRuntimeSegment): string {
  if (row.includedTravelSeconds === undefined) return row.kind.replaceAll("-", " ");
  const arrival = row.arrivalSwitch ? `, ${row.arrivalSwitch.replaceAll("-", " ")} on arrival` : "";
  return `stop (incl. ${formatDuration(row.includedTravelSeconds)} ascent${arrival})`;
}

/**
 * A folded row starts when the diver leaves the previous stop, so a gas switched on arrival is shown
 * after the travel gas ("EAN50 → Oxygen"); the row's start runtime is never paired with the new gas alone.
 */
function rowGas(row: GroupedRuntimeSegment): string {
  return row.travelGasName === undefined ? row.gasName : `${row.travelGasName} → ${row.gasName}`;
}

function runtimeRows(plan: DivePlan, preferences: UnitPreferences): readonly RuntimeRow[] {
  return runtimeScheduleRows(plan.segments).map((segment) => ({
    runtime: String(Math.round(segment.startRuntimeSeconds / 60)),
    depth: formatDepth(segment.endDepthM, preferences.depth),
    duration: formatDuration(segment.durationSeconds),
    gas: rowGas(segment),
    event: rowInstruction(segment),
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

function ReviewGasIncludes({
  gases,
  onToggle,
}: {
  readonly gases: readonly ReviewGasSwitch[];
  readonly onToggle: (key: string, included: boolean) => void;
}) {
  if (gases.length === 0) return null;
  return <ul className="bf-review-gas-includes">
    {gases.map((gas) => <li key={gas.key}>
      <label className="bf-check bf-gas-editor__switch">
        <input
          aria-label={`Include ${gas.name} in plan`}
          checked={gas.included}
          onChange={(event) => onToggle(gas.key, event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Include in plan</span>
      </label>
      <span className="bf-review-gas-includes__name">{gas.name}</span>
      {!gas.included && <span className="bf-review-gas-includes__excluded">Not in plan</span>}
    </li>)}
  </ul>;
}

function ScheduleAndLedger({ plan, preferences, environment, title, compact = false }: {
  readonly plan: DivePlan;
  readonly preferences: UnitPreferences;
  readonly environment: EnvironmentSettings | undefined;
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
        segments={profileSegments(plan, preferences, environment)}
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
  environmentSettings,
  preferences,
  stale = false,
  onSave,
  title = "Calculated plan",
  completion,
  compact = false,
  reviewGasSwitches,
  onToggleReviewGas,
  statusNotice,
  attentionDiagnostics,
}: {
  readonly plan?: DivePlan;
  /** The environment the plan was calculated with; the profile needs it for the CCR loop PPO₂. */
  readonly environmentSettings: EnvironmentSettings | undefined;
  readonly preferences: UnitPreferences;
  readonly stale?: boolean;
  readonly onSave?: () => void;
  readonly title?: string;
  readonly completion?: ReactNode;
  /** Fold the runtime and ledger tables behind disclosures; used for nested cave scenario output. */
  readonly compact?: boolean;
  /**
   * Plan Review only: deco (OC) or bailout (CCR) gases with Include-in-plan switches. Cave Review,
   * Saved Plan reopen, and compact nested output omit this prop.
   */
  readonly reviewGasSwitches?: readonly ReviewGasSwitch[];
  readonly onToggleReviewGas?: (key: string, included: boolean) => void;
  /** Shown instead of the previous result while Review recalculates after an include toggle. */
  readonly statusNotice?: string;
  /** Calculation diagnostics while Review is open in needs-attention. */
  readonly attentionDiagnostics?: readonly WarningItem[];
}) {
  const showResult = plan !== undefined && !stale && statusNotice === undefined && attentionDiagnostics === undefined;
  // One stable "Gases in this plan" panel keeps the same checkbox DOM across updating / current /
  // needs-attention so keyboard focus survives recalculation (ledger placement remounted them).
  const reviewIncludes = reviewGasSwitches && onToggleReviewGas && reviewGasSwitches.length > 0
    ? <Panel title="Gases in this plan">
      <ReviewGasIncludes gases={reviewGasSwitches} onToggle={onToggleReviewGas} />
    </Panel>
    : null;

  return <section className="bf-results" aria-label={title}>
    {completion}
    {/* Fixed slot so include checkboxes are not remounted when status/result siblings appear or leave. */}
    {reviewIncludes}
    {statusNotice && <Panel eyebrow="Updating" title={title}>
      <p>{statusNotice}</p>
    </Panel>}
    {attentionDiagnostics && <Panel eyebrow="Needs attention" title={title}>
      <WarningList items={attentionDiagnostics} title="Calculation diagnostics" />
    </Panel>}
    {showResult && plan && <>
      <Panel
        actions={onSave ? <ActionButton disabled={stale} onClick={onSave}>Save snapshot</ActionButton> : undefined}
        eyebrow={stale ? "Inputs changed · recalculate before saving" : plan.metadata.validationStatus}
        title={title}
      >
        <div className="bf-metric-grid">
          <ResultMetric label="Runtime" value={formatDuration(plan.summary.runtimeSeconds)} />
          <ResultMetric label="TTS" value={formatDuration(plan.summary.ttsSeconds)} />
          <ResultMetric detail="Time at stops" label="Deco" value={formatDuration(plan.summary.decompressionSeconds)} />
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
      <WarningList items={warningsFor(plan, preferences)} title="Plan diagnostics" />
      <ScheduleAndLedger compact={compact} environment={environmentSettings} plan={plan} preferences={preferences} title="Primary" />
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
        <WarningList items={warningsFor(plan.bailoutPlan, preferences)} title="Bailout diagnostics" />
        <ScheduleAndLedger compact={compact} environment={environmentSettings} plan={plan.bailoutPlan} preferences={preferences} title="Bailout" />
      </>}
    </>}
  </section>;
}
