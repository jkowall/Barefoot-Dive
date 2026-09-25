import { useEffect, useState, type ReactNode } from "react";
import * as calc from "../calculations";
import { DEFAULT_ENVIRONMENT } from "../domain/defaults";
import type { CalculationResult, Diagnostic, Fraction } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, litersPerMinute, meters, seconds } from "../domain/units";
import { PageHeader, Panel, ResultMetric, SegmentedControl, WarningList } from "../ui";
import { ActionButton, DepthField, NumberField, SelectField } from "./controls";
import type { TankRecord } from "../storage/types";
import type { TankBankStore } from "../storage/tankBank";
import {
  capacityInputValue,
  capacityLabel,
  formatDepth,
  formatDepthBound,
  formatDuration,
  formatPressure,
  formatSurfaceGas,
  formatSurfaceGasRate,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  surfaceGasInputStep,
  surfaceGasInputToCanonical,
  surfaceGasInputValue,
  surfaceGasRateInputStep,
  surfaceGasRateInputToCanonical,
  surfaceGasRateInputValue,
  surfaceGasRateUnit,
  surfaceGasUnit,
  waterVolumeFromRatedCapacity,
  type UnitPreferences,
} from "./helpers";
import { EMERGENCY_MODES, TOOL_CATEGORIES, TOOLS, toolById, type ToolId } from "./toolsCatalog";
import { createInitialToolsSessionState, type EmergencyInputSnapshot, type StoredToolResult, type ToolsSessionState } from "./toolsSession";
import type { ToolPlanPatch } from "./toolUse";

export type ToolName = ToolId;
/** Display names for all eleven user-facing capabilities. Emergency Gas is the workspace containing the two modes. */
export const TOOL_NAMES = [...TOOLS.map((tool) => tool.name).filter((name) => name !== "Emergency Gas"), "Rock Bottom / Minimum Gas", "Simplified Bailout"] as const;
export type ToolsPageProps = {
  readonly units: UnitPreferences;
  readonly tanks?: TankBankStore;
  readonly tankRevision?: number;
  readonly planMode?: "oc" | "ccr";
  readonly session?: ToolsSessionState;
  readonly onSessionChange?: (session: ToolsSessionState) => void;
  readonly onError?: (message: string) => void;
  readonly onRequestPlanPatch?: (patch: ToolPlanPatch) => void;
};

type SimpleDraft = {
  depthM: number; endDepthM: number; oxygen: number; helium: number; maximumPPO2: number; maximumENDDepthM: number;
  narcoticGasPolicy: "oxygen-and-nitrogen" | "nitrogen-only"; temperatureC: number;
  sacMode: "surface-volume" | "cylinder-pressure-drop"; gasUsedL: number; durationSeconds: number; startDepthM: number;
  cylinderWaterVolumeL: number; workingPressureBar: number; startingPressureBar: number; endingPressureBar: number;
  reservePressureBar: number; rmvLpm: number; ppo2Bar: number;
  rmvTarget: "bottom" | "deco" | "bailout" | "bailout-deco";
};
type EmergencySegmentDraft = { kind: "ascent" | "stop"; startDepthM: number; endDepthM: number; durationSeconds: number };
type EmergencyDraft = SimpleDraft & {
  emergencyMode: "rock-bottom" | "simplified-bailout"; planningMode: "oc" | "ccr"; teamSize: number; failureDepthM: number;
  stressedRmvLpm: number; segments: EmergencySegmentDraft[]; cylinderMode: "single-cylinder" | "schedule-only"; tankId?: string; tankRevision?: number;
};
type AnyDraft = SimpleDraft & Partial<EmergencyDraft> & { tankId?: string; tankRevision?: number; tankName?: string; tankGasId?: string; tankGasName?: string };

const baseDraft = (): SimpleDraft => ({ depthM: 40, endDepthM: 40, oxygen: .21, helium: .45, maximumPPO2: 1.4, maximumENDDepthM: 30, narcoticGasPolicy: "oxygen-and-nitrogen", temperatureC: 20, sacMode: "surface-volume", gasUsedL: 600, durationSeconds: 600, startDepthM: 20, cylinderWaterVolumeL: 12, workingPressureBar: 232, startingPressureBar: 232, endingPressureBar: 150, reservePressureBar: 35, rmvLpm: 20, ppo2Bar: 1.4, rmvTarget: "bottom" });
const emergencyDraft = (): EmergencyDraft => ({ ...baseDraft(), emergencyMode: "rock-bottom", planningMode: "oc", teamSize: 2, failureDepthM: 30, stressedRmvLpm: 20, cylinderMode: "single-cylinder", segments: [{ kind: "ascent", startDepthM: 30, endDepthM: 6, durationSeconds: 240 }, { kind: "stop", startDepthM: 6, endDepthM: 6, durationSeconds: 180 }, { kind: "ascent", startDepthM: 6, endDepthM: 0, durationSeconds: 60 }] });
const defaults = (id: ToolId): AnyDraft => id === "emergency-gas" ? emergencyDraft() : baseDraft();
const env = { surfacePressureBar: DEFAULT_ENVIRONMENT.surfacePressureBar, metersPerBar: DEFAULT_ENVIRONMENT.metersPerBar };
const isEmergency = (id: ToolId) => id === "emergency-gas";
const EMERGENCY_CALCULATION_DELAY_MS = 250;

function calculateEmergencySnapshot(snapshot: EmergencyInputSnapshot, inputHash: string): StoredToolResult {
  const input = {
    mode: snapshot.mode,
    failureDepthM: meters(snapshot.failureDepthM),
    teamSize: snapshot.teamSize,
    segments: snapshot.segments.map((segment) => ({
      kind: segment.kind,
      startDepthM: meters(segment.startDepthM),
      endDepthM: meters(segment.endDepthM),
      durationSeconds: seconds(segment.durationSeconds),
      rmvLpm: litersPerMinute(segment.rmvLpm),
    })),
    environment: {
      surfacePressureBar: barAbsolute(snapshot.environment.surfacePressureBar),
      metersPerBar: meters(snapshot.environment.metersPerBar),
    },
    ...(snapshot.cylinder ? {
      cylinder: {
        waterVolumeL: liters(snapshot.cylinder.waterVolumeL),
        startingPressureBar: barGauge(snapshot.cylinder.startingPressureBar),
        reservePressureBar: barGauge(snapshot.cylinder.reservePressureBar),
      },
    } : {}),
  } as Parameters<typeof calc.calculateEmergencyGas>[0];
  const calculated = calc.calculateEmergencyGas(input);
  const signature = {
    inputHash,
    tankId: snapshot.tank?.id,
    tankRevision: snapshot.tank?.revision,
    calculatedAt: 0,
  };
  const emergencyInputSnapshot = structuredClone(snapshot);
  return calculated.ok
    ? { value: calculated.value, warnings: calculated.warnings, errors: calculated.errors, signature, emergencyInputSnapshot }
    : { value: undefined, warnings: calculated.warnings, errors: calculated.errors, signature, emergencyInputSnapshot };
}

function diagnostics(items: readonly Diagnostic[] = []) { return items.map((item, index) => ({ id: `${item.code}-${index}`, message: item.field ? `${item.message} [${item.field}]` : item.message, severity: item.severity })); }
function displayGas(value: number, units: UnitPreferences) { return formatSurfaceGas(value, units.cylinderCapacity); }
function displayRmv(value: number, units: UnitPreferences) { return formatSurfaceGasRate(value, units.cylinderCapacity); }
function displayCylinderCapacity(waterVolumeL: number, workingPressureBar: number, units: UnitPreferences) {
  const value = capacityInputValue(waterVolumeL, workingPressureBar, units.cylinderCapacity).toFixed(1);
  return units.cylinderCapacity === "imperial" ? `${value} ft³ @ working pressure` : `${value} L water volume`;
}
function percent(value: number) { return `${(value * 100).toFixed(1)}%`; }
function bindingConstraintLabel(value: Record<string, unknown>) {
  const labels: Record<string, string> = { ppo2: "PPO₂ ceiling", end: "END ceiling", "oxygen-fraction": "oxygen fraction" };
  if (Array.isArray(value.activeConstraints) && value.activeConstraints.length > 0) return (value.activeConstraints as string[]).map((constraint) => labels[constraint] ?? constraint).join(", ");
  return ({ ppo2: "PPO₂ ceiling", end: "END ceiling", "oxygen-fraction": "oxygen fraction", combined: "PPO₂ and END" } as Record<string, string>)[String(value.bindingConstraint)] ?? String(value.bindingConstraint);
}

function ResultDetails({ id, result, units, emergencySnapshot, pending = false }: { id: ToolId; result?: StoredToolResult; units: UnitPreferences; emergencySnapshot?: EmergencyInputSnapshot; pending?: boolean }) {
  if (pending) return <div className="bf-tool-updating" role="status"><span aria-hidden="true" className="bf-tool-status__dot" />Updating for the current inputs…</div>;
  if (!result) return <p className="bf-tool-result__empty">Enter complete inputs to see the result.</p>;
  const value = result.value as Record<string, unknown> | undefined;
  const emergencySegments = value && id === "emergency-gas" ? value.segments as readonly { readonly gasUsedL: number; readonly averageAmbientPressureBar: number }[] : [];
  return <>
    {!value && result.errors?.length && <p className="bf-tool-invalid" role="status">Fix the highlighted inputs to restore the live result.</p>}
    {value && id === "mod" && <div className="bf-metric-grid"><ResultMetric label="Maximum operating depth" value={formatDepthBound(value.depthM as number, units.depth, "upper")} tone="safe" /><ResultMetric label="Ambient pressure" value={`${(value.ambientPressureBar as number).toFixed(2)} bar absolute`} /><ResultMetric label="Gas oxygen" value={percent(value.oxygen as number)} /></div>}
    {value && id === "best-mix" && <div className="bf-metric-grid"><ResultMetric label="Recommended trimix" value={`Tx${Math.round((value.oxygen as number) * 100)}/${Math.round((value.helium as number) * 100)}`} tone="safe" /><ResultMetric label="Actual PPO₂" value={`${(value.actualPPO2Bar as number).toFixed(2)} bar`} /><ResultMetric label="Achieved END" value={formatDepthBound(value.achievedENDDepthM as number, units.depth, "lower")} /><ResultMetric kind="text" label="Binding constraint" value={bindingConstraintLabel(value)} /></div>}
    {value && id === "ppo2" && <div className="bf-metric-grid"><ResultMetric label="Oxygen partial pressure" value={`${(value.ppo2Bar as number).toFixed(2)} bar`} tone="safe" /><ResultMetric label="Ambient pressure" value={`${(value.ambientPressureBar as number).toFixed(2)} bar absolute`} /></div>}
    {value && id === "end" && <div className="bf-metric-grid"><ResultMetric label="Equivalent narcotic depth" value={formatDepthBound(value.endDepthM as number, units.depth, "lower")} tone="safe" /><ResultMetric label="Narcotic fraction" value={percent(value.narcoticFraction as number)} /><ResultMetric label="Nitrogen" value={percent(value.nitrogen as number)} /></div>}
    {value && id === "gas-density" && <div className="bf-metric-grid"><ResultMetric label="Gas density" value={`${(value.densityKgM3 as number).toFixed(2)} g/L`} tone="safe" /><ResultMetric label="Molar mass" value={`${(value.molarMassGmol as number).toFixed(2)} g/mol`} /></div>}
    {value && id === "sac-rmv" && <div className="bf-metric-grid"><ResultMetric label="SAC / RMV" value={displayRmv(value.sacLpm as number, units)} tone="safe" /><ResultMetric label="Gas used" value={displayGas(value.gasUsedL as number, units)} /><ResultMetric label="Average ambient pressure" value={`${(value.averageAmbientPressureBar as number).toFixed(2)} bar absolute`} /></div>}
    {value && id === "gas-duration" && <div className="bf-metric-grid"><ResultMetric label="Usable duration" value={formatDuration(value.durationSeconds as number)} tone="safe" /><ResultMetric label="Usable gas" value={displayGas(value.usableGasL as number, units)} /></div>}
    {value && id === "cylinder-gas" && <div className="bf-metric-grid"><ResultMetric label="Total gas" value={displayGas(value.totalGasL as number, units)} tone="safe" /><ResultMetric label="Usable gas" value={displayGas(value.usableGasL as number, units)} /><ResultMetric label="Reserve gas" value={displayGas(value.reserveGasL as number, units)} /></div>}
    {value && id === "cns" && <div className="bf-metric-grid"><ResultMetric label="CNS exposure" value={`${(value.percent as number).toFixed(1)}%`} tone={(value.percent as number) >= 100 ? "warning" : "safe"} /><ResultMetric label="Table limit" value={formatDuration(value.limitSeconds as number)} /></div>}
    {value && id === "emergency-gas" && <>
      <div className="bf-metric-grid">
        <ResultMetric label="Required gas" value={displayGas(value.requiredGasL as number, units)} tone="safe" />
        <ResultMetric label="Team multiplier" value={`${value.teamMultiplier}×`} />
        {value.pressureDropBar !== undefined && emergencySnapshot?.cylinder && <>
          <ResultMetric kind="text" label="Cylinder capacity" value={displayCylinderCapacity(emergencySnapshot.cylinder.waterVolumeL, emergencySnapshot.cylinder.workingPressureBar, units)} />
          <ResultMetric label="Starting pressure" value={formatPressure(emergencySnapshot.cylinder.startingPressureBar, units.pressure)} />
          <ResultMetric label="Reserve pressure" value={formatPressure(emergencySnapshot.cylinder.reservePressureBar, units.pressure)} />
          <ResultMetric label="Pressure drop" value={formatPressure(value.pressureDropBar as number, units.pressure)} />
        </>}
        {value.requiredStartingPressureBar !== undefined && <ResultMetric label="Required start" value={formatPressure(value.requiredStartingPressureBar as number, units.pressure)} />}
        {value.remainingPressureBar !== undefined && <ResultMetric label="Remaining" value={formatPressure(value.remainingPressureBar as number, units.pressure)} />}
        {value.marginPressureBar !== undefined && <ResultMetric label="Margin" value={formatPressure(value.marginPressureBar as number, units.pressure)} tone={(value.sufficient as boolean) ? "safe" : "danger"} />}
        <ResultMetric kind="text" label="Cylinder check" value={value.sufficient === undefined ? "Schedule only" : value.sufficient ? "Sufficient" : "Insufficient"} tone={value.sufficient === undefined ? "default" : value.sufficient ? "safe" : "danger"} />
      </div>
      {emergencySnapshot && <details className="bf-tool-details bf-tool-details--nested">
        <summary>Calculated assumptions</summary>
        <p>{emergencySnapshot.emergencyMode === "rock-bottom" ? "Rock Bottom / Minimum Gas" : "Simplified Bailout"} · {emergencySnapshot.mode === "oc" ? "Open circuit" : "CCR"} · Cylinder context: {emergencySnapshot.cylinder ? "single-cylinder" : "schedule-only"}. Failure depth: {formatDepth(emergencySnapshot.failureDepthM, units.depth)}. Stressed SAC/RMV: {displayRmv(emergencySnapshot.stressedRmvLpm, units)}. Team size: {emergencySnapshot.teamSize}. Calculated multiplier: {String(value.teamMultiplier)}×.</p>
        <div className="bf-emergency-assumptions">{emergencySnapshot.segments.map((segment, index) => {
          const calculatedSegment = emergencySegments[index];
          return <article className="bf-emergency-assumption" key={`${index}-${segment.kind}`}><strong>Segment {index + 1}: {segment.kind === "ascent" ? "Ascent" : "Stop"}</strong><span>{formatDepth(segment.startDepthM, units.depth)} → {formatDepth(segment.endDepthM, units.depth)} · {formatDuration(segment.durationSeconds)} · SAC/RMV {displayRmv(segment.rmvLpm, units)}</span>{calculatedSegment && <span>Consumption {displayGas(calculatedSegment.gasUsedL, units)} · average ambient {calculatedSegment.averageAmbientPressureBar.toFixed(2)} bar absolute</span>}</article>;
        })}</div>
        {emergencySnapshot.cylinder && <p>Cylinder: {displayCylinderCapacity(emergencySnapshot.cylinder.waterVolumeL, emergencySnapshot.cylinder.workingPressureBar, units)} · working {formatPressure(emergencySnapshot.cylinder.workingPressureBar, units.pressure)} · start {formatPressure(emergencySnapshot.cylinder.startingPressureBar, units.pressure)} · reserve {formatPressure(emergencySnapshot.cylinder.reservePressureBar, units.pressure)}.</p>}
        {emergencySnapshot.tank && <p>Tank Bank snapshot: {emergencySnapshot.tank.name} · {emergencySnapshot.tank.gas.name} · revision {emergencySnapshot.tank.revision}.</p>}
      </details>}
    </>}
    {result.errors && <WarningList items={diagnostics(result.errors)} title="Input diagnostics" />}
    {result.warnings.length > 0 && <WarningList items={diagnostics(result.warnings)} title="Planning notes" />}
  </>;
}

function EmergencyInputs({ draft, units, fieldError, setField, patchDraft, pressureField }: { draft: EmergencyDraft; units: UnitPreferences; fieldError: (field: string) => string | undefined; setField: (key: string, value: number | string) => void; patchDraft: (change: Partial<AnyDraft>) => void; pressureField: (key: string, label: string, canonical: number, onChange: (value: number) => void) => ReactNode }) {
  const depthLabel = units.depth === "imperial" ? "ft" : "m";
  const capacity = <NumberField error={fieldError("cylinderWaterVolumeL")} label={capacityLabel(units.cylinderCapacity)} min={0} onChange={(value) => setField("cylinderWaterVolumeL", waterVolumeFromRatedCapacity(value, draft.workingPressureBar, units.cylinderCapacity))} value={capacityInputValue(draft.cylinderWaterVolumeL, draft.workingPressureBar, units.cylinderCapacity)} />;
  const working = pressureField("workingPressureBar", "Working pressure", draft.workingPressureBar, (value) => setField("workingPressureBar", value));
  const stressedRmv = <NumberField error={fieldError("stressedRmvLpm")} label={`Stressed SAC/RMV (${surfaceGasRateUnit(units.cylinderCapacity)})`} min={0} onChange={(value) => setField("stressedRmvLpm", surfaceGasRateInputToCanonical(value, units.cylinderCapacity, [draft.stressedRmvLpm]))} step={surfaceGasRateInputStep(units.cylinderCapacity)} value={surfaceGasRateInputValue(draft.stressedRmvLpm, units.cylinderCapacity)} />;
  const updateSegment = (index: number, change: Partial<EmergencySegmentDraft>) => patchDraft({ segments: draft.segments.map((segment, current) => current === index ? { ...segment, ...change } : segment) });
  const showCylinder = draft.planningMode === "ccr" || draft.cylinderMode === "single-cylinder";
  return <><SegmentedControl label="Emergency mode" onChange={(value) => setField("emergencyMode", value)} options={EMERGENCY_MODES.map((label) => ({ value: label === EMERGENCY_MODES[0] ? "rock-bottom" : "simplified-bailout", label }))} value={draft.emergencyMode} /><p className="bf-tool-note"><strong>Planning context: {draft.planningMode === "oc" ? "Open circuit" : "CCR"}.</strong> Rock Bottom / Minimum Gas is an OC team check. Simplified Bailout is a CCR single-cylinder schedule check.</p><div className="bf-form-grid">{stressedRmv}<NumberField error={fieldError("teamSize")} disabled={draft.planningMode === "ccr"} label="OC team size" min={1} onChange={(value) => setField("teamSize", value)} value={draft.teamSize} /><DepthField error={fieldError("failureDepthM")} label={`Failure depth (${depthLabel})`} min={0} onChange={(value) => setField("failureDepthM", value)} units={units.depth} valueM={draft.failureDepthM} /></div><div className="bf-segment-editor"><div className="bf-row-header"><h3>Entered emergency schedule</h3><ActionButton onClick={() => patchDraft({ segments: [...draft.segments, { kind: "stop", startDepthM: 6, endDepthM: 6, durationSeconds: 60 }] })} quiet>Add segment</ActionButton></div>{draft.segments.map((segment, index) => <div className="bf-segment-row" key={index}><SelectField label={`Segment ${index + 1} kind`} options={[{ value: "ascent", label: "Ascent" }, { value: "stop", label: "Stop" }]} onChange={(value) => updateSegment(index, { kind: value as "ascent" | "stop" })} value={segment.kind} /><DepthField error={fieldError(`segments.${index}.startDepthM`)} label={`Start depth (${depthLabel})`} min={0} onChange={(value) => updateSegment(index, { startDepthM: value })} units={units.depth} valueM={segment.startDepthM} /><DepthField error={fieldError(`segments.${index}.endDepthM`)} label={`End depth (${depthLabel})`} min={0} onChange={(value) => updateSegment(index, { endDepthM: value })} units={units.depth} valueM={segment.endDepthM} /><NumberField error={fieldError(`segments.${index}.durationSeconds`)} label="Duration (min)" min={0} onChange={(value) => updateSegment(index, { durationSeconds: value * 60 })} value={segment.durationSeconds / 60} /><ActionButton disabled={draft.segments.length <= 1} onClick={() => patchDraft({ segments: draft.segments.filter((_, current) => current !== index) })} quiet>Remove</ActionButton></div>)}</div>{showCylinder && <div className="bf-form-grid">{capacity}{working}{pressureField("startingPressureBar", "Starting pressure", draft.startingPressureBar, (value) => setField("startingPressureBar", value))}{pressureField("reservePressureBar", "Reserve pressure", draft.reservePressureBar, (value) => setField("reservePressureBar", value))}</div>}</>;
}

export default function ToolsPage({ units, tanks, tankRevision, planMode = "oc", session: controlledSession, onSessionChange, onRequestPlanPatch }: ToolsPageProps) {
  void tankRevision;
  const [uncontrolledSession, setUncontrolledSession] = useState<ToolsSessionState>(createInitialToolsSessionState);
  const session = controlledSession ?? uncontrolledSession;
  const updateSession = (change: Partial<ToolsSessionState>) => { const next = { ...session, ...change }; if (!controlledSession) setUncontrolledSession(next); onSessionChange?.(next); };
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const listedTanks = tanks?.list({ archived: false });
  const cylinders: readonly TankRecord[] = listedTanks?.ok ? listedTanks.value : [];
  const activeTool = toolById(session.activeTool);
  const draft = (session.drafts[session.activeTool] ?? defaults(session.activeTool)) as AnyDraft;
  const selectedTankId = typeof draft.tankId === "string" ? draft.tankId : "";
  const selectedTank = cylinders.find((tank) => tank.id === selectedTankId);
  const tankDisplayName = draft.tankName ?? selectedTank?.name;
  const tankDisplayGas = draft.tankGasName ?? selectedTank?.gas.name;
  const result = session.results[session.activeTool];
  const emergencyHasCylinder = isEmergency(session.activeTool) && ((draft as EmergencyDraft).planningMode === "ccr" || (draft as EmergencyDraft).cylinderMode === "single-cylinder");
  const currentEmergencySnapshot: EmergencyInputSnapshot | undefined = isEmergency(session.activeTool) ? {
    mode: (draft as EmergencyDraft).planningMode,
    emergencyMode: (draft as EmergencyDraft).emergencyMode,
    failureDepthM: (draft as EmergencyDraft).failureDepthM,
    teamSize: (draft as EmergencyDraft).planningMode === "ccr" ? 1 : (draft as EmergencyDraft).teamSize,
    stressedRmvLpm: (draft as EmergencyDraft).stressedRmvLpm,
    segments: (draft as EmergencyDraft).segments.map((segment) => ({ ...segment, rmvLpm: (draft as EmergencyDraft).stressedRmvLpm })),
    environment: { surfacePressureBar: env.surfacePressureBar, metersPerBar: env.metersPerBar },
    ...(emergencyHasCylinder ? { cylinder: { waterVolumeL: draft.cylinderWaterVolumeL, workingPressureBar: draft.workingPressureBar, startingPressureBar: draft.startingPressureBar, reservePressureBar: draft.reservePressureBar } } : {}),
    ...(emergencyHasCylinder && draft.tankId && draft.tankRevision !== undefined && draft.tankName && draft.tankGasName ? { tank: { id: draft.tankId, revision: draft.tankRevision, name: draft.tankName, gas: { id: draft.tankGasId ?? draft.tankGasName, name: draft.tankGasName, oxygen: draft.oxygen, helium: draft.helium } } } : {}),
  } : undefined;
  const emergencyInputSignature = currentEmergencySnapshot ? JSON.stringify(currentEmergencySnapshot) : "";
  const emergencyPending = isEmergency(session.activeTool) && result?.signature?.inputHash !== emergencyInputSignature;

  useEffect(() => {
    if (session.view !== "tool" || session.activeTool !== "emergency-gas" || !emergencyInputSignature || !emergencyPending) return;
    const timeout = window.setTimeout(() => {
      const snapshot = JSON.parse(emergencyInputSignature) as EmergencyInputSnapshot;
      const stored = calculateEmergencySnapshot(snapshot, emergencyInputSignature);
      const next = {
        ...session,
        results: { ...session.results, "emergency-gas": stored },
        emergencyResultSignature: stored.signature,
      };
      if (controlledSession === undefined) setUncontrolledSession(next);
      onSessionChange?.(next);
    }, EMERGENCY_CALCULATION_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [controlledSession, emergencyInputSignature, emergencyPending, onSessionChange, session]);

  const patchDraft = (change: Partial<AnyDraft>, sourceSelection = false) => {
    const nextDraft = { ...draft, ...change };
    const sourcedKeys = ["oxygen", "helium", "cylinderWaterVolumeL", "workingPressureBar", "startingPressureBar", "reservePressureBar"];
    if (!sourceSelection && selectedTankId && Object.keys(change).some((key) => sourcedKeys.includes(key))) { (nextDraft as Record<string, unknown>).tankId = ""; (nextDraft as Record<string, unknown>).tankRevision = undefined; (nextDraft as Record<string, unknown>).tankName = undefined; (nextDraft as Record<string, unknown>).tankGasId = undefined; (nextDraft as Record<string, unknown>).tankGasName = undefined; }
    updateSession({ drafts: { ...session.drafts, [session.activeTool]: nextDraft } });
  };
  const setField = (key: string, value: number | string) => {
    if (session.activeTool === "emergency-gas" && key === "planningMode") return;
    if (session.activeTool === "emergency-gas" && key === "emergencyMode") {
      patchDraft({ emergencyMode: value as EmergencyDraft["emergencyMode"], planningMode: value === "rock-bottom" ? "oc" : "ccr", ...(value === "simplified-bailout" ? { cylinderMode: "single-cylinder" } : {}) });
      return;
    }
    patchDraft({ [key]: value });
  };
  const fieldError = (field: string) => { if (!touched[`${session.activeTool}.${field}`] && !touched[session.activeTool]) return undefined; const diagnosticsForTool = isEmergency(session.activeTool) ? (emergencyPending ? undefined : result?.errors) : calculateSimple().errors; return [...(diagnosticsForTool ?? [])].find((item) => item.field === field || item.field?.endsWith(`.${field}`))?.message; };
  const selectTank = (id: string) => {
    const tank = cylinders.find((item) => item.id === id);
    if (!tank) { patchDraft({ tankId: "", tankRevision: undefined, tankName: undefined, tankGasId: undefined, tankGasName: undefined }, true); return; }
    patchDraft({ tankId: tank.id, tankRevision: tank.revision, tankName: tank.name, tankGasId: tank.gas.id, tankGasName: tank.gas.name, oxygen: tank.gas.oxygen, helium: tank.gas.helium, cylinderWaterVolumeL: tank.waterVolumeL, workingPressureBar: tank.workingPressureBar, startingPressureBar: tank.currentPressureBar, reservePressureBar: tank.minimumPressureBar ?? 0 }, true);
  };
  const calculateSimple = (): StoredToolResult => {
    const d = draft;
    const ambientPressureBar = barAbsolute(DEFAULT_ENVIRONMENT.surfacePressureBar + d.depthM / DEFAULT_ENVIRONMENT.metersPerBar);
    let calculated: CalculationResult<unknown>;
    switch (session.activeTool) {
      case "mod": calculated = calc.calculateMOD({ oxygen: fraction(d.oxygen), maximumPPO2: barAbsolute(d.maximumPPO2), ...env }); break;
      case "best-mix": calculated = calc.calculateBestMix({ depthM: meters(d.depthM), maximumPPO2: barAbsolute(d.maximumPPO2), maximumENDDepthM: meters(d.maximumENDDepthM), environment: env, narcoticGasPolicy: d.narcoticGasPolicy }); break;
      case "ppo2": calculated = calc.calculatePPO2({ oxygen: fraction(d.oxygen), ambientPressureBar }); break;
      case "end": calculated = calc.calculateEND({ depthM: meters(d.depthM), oxygen: fraction(d.oxygen), helium: fraction(d.helium), environment: env, narcoticGasPolicy: d.narcoticGasPolicy }); break;
      case "gas-density": calculated = calc.calculateGasDensity({ oxygen: fraction(d.oxygen), helium: fraction(d.helium), ambientPressureBar, temperatureC: d.temperatureC }); break;
      case "sac-rmv": calculated = d.sacMode === "surface-volume" ? calc.calculateSAC({ kind: "surface-volume", gasUsedL: liters(d.gasUsedL), durationSeconds: seconds(d.durationSeconds), startDepthM: meters(d.startDepthM), endDepthM: meters(d.endDepthM), environment: env }) : calc.calculateSAC({ kind: "cylinder-pressure-drop", cylinderWaterVolumeL: liters(d.cylinderWaterVolumeL), startingPressureBar: barGauge(d.startingPressureBar), endingPressureBar: barGauge(d.endingPressureBar), durationSeconds: seconds(d.durationSeconds), startDepthM: meters(d.startDepthM), endDepthM: meters(d.endDepthM), environment: env }); break;
      case "gas-duration": calculated = calc.calculateGasDuration({ cylinderWaterVolumeL: liters(d.cylinderWaterVolumeL), startingPressureBar: barGauge(d.startingPressureBar), reservePressureBar: barGauge(d.reservePressureBar), rmvLpm: litersPerMinute(d.rmvLpm), ambientPressureBar }); break;
      case "cylinder-gas": calculated = calc.calculateCylinderGas({ waterVolumeL: liters(d.cylinderWaterVolumeL), pressureBar: barGauge(d.startingPressureBar), reservePressureBar: barGauge(d.reservePressureBar) }); break;
      case "cns": calculated = calc.calculateCNS({ ppo2Bar: barAbsolute(d.ppo2Bar), durationSeconds: seconds(d.durationSeconds) }); break;
      case "emergency-gas": return { value: undefined, warnings: [], errors: [] };
    }
    return calculated.ok ? { value: calculated.value, warnings: calculated.warnings, errors: calculated.errors } : { value: undefined, warnings: calculated.warnings, errors: calculated.errors };
  };
  const liveResult = isEmergency(session.activeTool) ? (emergencyPending ? undefined : result) : calculateSimple();
  const useResult = () => {
    if (!liveResult?.value || emergencyPending) return;
    if (session.activeTool === "best-mix" && planMode === "oc") {
      const value = liveResult.value as { oxygen: Fraction; helium: Fraction };
      onRequestPlanPatch?.({ kind: "best-mix", name: `Tx${Math.round(value.oxygen * 100)}/${Math.round(value.helium * 100)}`, oxygenPercent: value.oxygen * 100, heliumPercent: value.helium * 100 });
    } else if (session.activeTool === "sac-rmv") {
      const effectiveTarget = planMode === "oc" ? (draft.rmvTarget === "bailout" || draft.rmvTarget === "bailout-deco" ? "bottom" : draft.rmvTarget) : (draft.rmvTarget === "bottom" || draft.rmvTarget === "deco" ? "bailout" : draft.rmvTarget);
      const target = effectiveTarget === "deco" ? "decoRmvLpm" : effectiveTarget === "bailout" ? "bailoutRmvLpm" : effectiveTarget === "bailout-deco" ? "bailoutDecoRmvLpm" : "bottomRmvLpm";
      onRequestPlanPatch?.({ kind: "rmv", target, valueLpm: (liveResult.value as { sacLpm: number }).sacLpm });
    } else if (session.activeTool === "emergency-gas" && (draft as EmergencyDraft).planningMode === "oc") {
      const d = draft as EmergencyDraft;
      onRequestPlanPatch?.({ kind: "rock-bottom", teamSize: d.teamSize, stressedRmvLpm: d.stressedRmvLpm });
    }
  };
  const chooseTool = (id: ToolId) => updateSession({ view: "tool", activeTool: id, lastTool: id });
  const backToLibrary = () => updateSession({ view: "library", lastTool: session.activeTool });
  const pressureField = (key: string, label: string, canonical: number, onChange: (value: number) => void) => <NumberField error={fieldError(key)} key={key} label={`${label} (${units.pressure})`} min={0} onBlur={() => setTouched((current) => ({ ...current, [`${session.activeTool}.${key}`]: true }))} onChange={(value) => onChange(pressureInputToCanonical(value, units.pressure, [canonical]))} step={pressureInputStep(units.pressure)} value={pressureInputValue(canonical, units.pressure)} />;

  if (session.view === "library") return <><PageHeader title="Tools" description="Choose one focused task. Inputs stay in this session only; results are local checks for qualified review." /><div aria-label="Tools library" className="bf-tool-library">{TOOL_CATEGORIES.map((category) => <section className="bf-tool-category" key={category}><p className="bf-eyebrow">{category}</p><div className="bf-tool-list">{TOOLS.filter((tool) => tool.category === category).map((tool) => <button className="bf-tool-card" key={tool.id} onClick={() => chooseTool(tool.id)} type="button"><strong>{tool.name}</strong><span>{tool.purpose}</span>{tool.modes && <span className="bf-tool-card__modes">{tool.modes.map((mode) => <span key={mode}>{mode}</span>)}</span>}</button>)}</div></section>)}</div></>;

  const d = draft;
  const currentResult = liveResult;
  const actionAllowed = Boolean(currentResult?.value) && !emergencyPending;
  const effectiveRmvTarget = planMode === "oc" ? (d.rmvTarget === "bailout" || d.rmvTarget === "bailout-deco" ? "bottom" : d.rmvTarget) : (d.rmvTarget === "bottom" || d.rmvTarget === "deco" ? "bailout" : d.rmvTarget);
  const planActionLabel = session.activeTool === "best-mix" ? "Copy mix to Plan" : session.activeTool === "sac-rmv" ? `Apply ${effectiveRmvTarget === "bailout-deco" ? "CCR bailout deco" : effectiveRmvTarget === "bailout" ? "CCR bailout" : effectiveRmvTarget === "deco" ? "OC deco" : "OC bottom"} SAC/RMV` : "Apply reserve assumptions";
  const hasPlanAction = (session.activeTool === "best-mix" && planMode === "oc") || session.activeTool === "sac-rmv" || (session.activeTool === "emergency-gas" && (d as EmergencyDraft).planningMode === "oc" && planMode === "oc");
  const resultState = emergencyPending ? "updating" : currentResult?.value ? "ready" : "invalid";
  const resultStatus = resultState === "updating" ? "Updating" : resultState === "ready" ? "Live result" : "Check inputs";
  const showTankBankSource = activeTool.tankBank && !(session.activeTool === "sac-rmv" && d.sacMode === "surface-volume") && !(session.activeTool === "emergency-gas" && !emergencyHasCylinder);
  const tankOptions = cylinders.map((tank) => {
    const snapshotIsOlder = tank.id === selectedTankId && draft.tankRevision !== undefined && draft.tankRevision !== tank.revision;
    return {
      value: tank.id,
      label: snapshotIsOlder
        ? `${draft.tankName ?? tank.name} · ${draft.tankGasName ?? tank.gas.name} · snapshot rev ${draft.tankRevision} (bank rev ${tank.revision})`
        : `${tank.name} · ${tank.gas.name} · rev ${tank.revision}`,
    };
  });
  return <>
    <PageHeader eyebrow={activeTool.category} title={activeTool.name} description={activeTool.purpose} actions={<ActionButton onClick={backToLibrary} quiet>All tools</ActionButton>} />
    <div className="bf-tool-workspace">
      <Panel title="Inputs" className="bf-tool-input-panel">
        <div onBlurCapture={(event) => { if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) setTouched((current) => ({ ...current, [session.activeTool]: true })); }}>
          <p className="bf-tool-purpose">Complete the fields below. {session.activeTool === "emergency-gas" ? "The result updates automatically after a short pause." : "The result updates as you edit."} Depth, cylinder pressure, surface gas, and SAC/RMV follow your display settings; PPO₂ and ambient pressure remain bar absolute.</p>
          {showTankBankSource && <SelectField label="Tank Bank source" options={[{ value: "", label: "Manual inputs" }, ...tankOptions]} onChange={selectTank} value={selectedTankId} />}
          {showTankBankSource && tankDisplayName && <p className="bf-source-note" role="status">Snapshot from Tank Bank: {tankDisplayName}{tankDisplayGas ? ` · ${tankDisplayGas}` : ""}, revision {draft.tankRevision}. Editing sourced fields detaches to Manual.{selectedTank && draft.tankRevision !== selectedTank.revision ? ` Tank Bank now rev ${selectedTank.revision}; reselect to refresh.` : ""}</p>}
          {session.activeTool === "emergency-gas" && <SegmentedControl label="Cylinder context" onChange={(value) => setField("cylinderMode", value)} options={(d as EmergencyDraft).planningMode === "ccr" ? [{ value: "single-cylinder", label: "Required cylinder" }] : [{ value: "single-cylinder", label: "Check cylinder" }, { value: "schedule-only", label: "Schedule only" }]} value={(d as EmergencyDraft).cylinderMode} />}
          <ToolInputs draft={d} id={session.activeTool} planMode={planMode} units={units} fieldError={fieldError} setField={setField} patchDraft={patchDraft} pressureField={pressureField} />
        </div>
      </Panel>
      <Panel
        title="Result"
        className={`bf-tool-result-panel bf-tool-result-panel--${resultState}`}
        actions={<div className="bf-tool-result-actions"><span className="bf-tool-status" data-state={resultState} role="status"><span aria-hidden="true" className="bf-tool-status__dot" />{resultStatus}</span>{hasPlanAction && <ActionButton disabled={!actionAllowed} onClick={useResult} quiet>{planActionLabel}</ActionButton>}</div>}
      >
        <div aria-atomic="true" aria-busy={emergencyPending} aria-live="polite" className={`bf-tool-result ${isEmergency(session.activeTool) ? "bf-tool-result--debounced" : ""}`.trim()} data-state={resultState}>
          <ResultDetails id={session.activeTool} emergencySnapshot={currentResult?.emergencyInputSnapshot} pending={emergencyPending} result={currentResult} units={units} />
        </div>
        <details className="bf-tool-details"><summary>Method and assumptions</summary><p>Method ID: {String((currentResult?.value as { methodId?: unknown } | undefined)?.methodId ?? "local deterministic calculation")}. {(session.activeTool === "best-mix" || session.activeTool === "end") && (d as AnyDraft).narcoticGasPolicy ? `Narcotic policy: ${(d as AnyDraft).narcoticGasPolicy}. ` : ""}Canonical calculations use the configured surface pressure, 10 m/bar, gauge bar for cylinders, absolute bar for PPO₂ and ambient pressure, surface liters, and L/min. Display conversions do not rewrite those values. Final analyzer readings remain authoritative.</p>{session.activeTool === "emergency-gas" && <p>Simplified bailout is a bounded entered-schedule, single-cylinder check. It is not a bailout or decompression plan.</p>}</details>
      </Panel>
    </div>
  </>;
}

function ToolInputs({ id, draft, planMode, units, fieldError, setField, patchDraft, pressureField }: { id: ToolId; draft: AnyDraft; planMode: "oc" | "ccr"; units: UnitPreferences; fieldError: (field: string) => string | undefined; setField: (key: string, value: number | string) => void; patchDraft: (change: Partial<AnyDraft>) => void; pressureField: (key: string, label: string, canonical: number, onChange: (value: number) => void) => ReactNode }) {
  const depthLabel = units.depth === "imperial" ? "ft" : "m";
  const depth = (key: "depthM" | "endDepthM" | "startDepthM" | "maximumENDDepthM", label: string) => <DepthField error={fieldError(key)} label={`${label} (${depthLabel})`} min={0} onChange={(value) => setField(key, value)} units={units.depth} valueM={draft[key]} />;
  const capacity = <NumberField error={fieldError("cylinderWaterVolumeL")} label={capacityLabel(units.cylinderCapacity)} min={0} onChange={(value) => setField("cylinderWaterVolumeL", waterVolumeFromRatedCapacity(value, draft.workingPressureBar, units.cylinderCapacity))} value={capacityInputValue(draft.cylinderWaterVolumeL, draft.workingPressureBar, units.cylinderCapacity)} />;
  const working = pressureField("workingPressureBar", "Working pressure", draft.workingPressureBar, (value) => setField("workingPressureBar", value));
  const rmv = <NumberField error={fieldError("rmvLpm")} label={`SAC/RMV (${surfaceGasRateUnit(units.cylinderCapacity)})`} min={0} onChange={(value) => setField("rmvLpm", surfaceGasRateInputToCanonical(value, units.cylinderCapacity, [draft.rmvLpm]))} step={surfaceGasRateInputStep(units.cylinderCapacity)} value={surfaceGasRateInputValue(draft.rmvLpm, units.cylinderCapacity)} />;
  if (id === "mod") return <div className="bf-form-grid"><NumberField error={fieldError("oxygen")} label="O₂ fraction (%)" min={0} onChange={(value) => setField("oxygen", value / 100)} step={1} value={draft.oxygen * 100} /><NumberField error={fieldError("maximumPPO2")} label="Maximum PPO₂ (bar absolute)" min={.1} onChange={(value) => setField("maximumPPO2", value)} step={.05} value={draft.maximumPPO2} /></div>;
  if (id === "best-mix") return <div className="bf-form-grid">{depth("depthM", "Target depth")}<NumberField error={fieldError("maximumPPO2")} label="Maximum PPO₂ (bar absolute)" min={.1} onChange={(value) => setField("maximumPPO2", value)} step={.05} value={draft.maximumPPO2} />{depth("maximumENDDepthM", "Maximum END")}<SegmentedControl label="Narcotic policy" onChange={(value) => setField("narcoticGasPolicy", value)} options={[{ value: "oxygen-and-nitrogen", label: "O₂ + N₂" }, { value: "nitrogen-only", label: "N₂ only" }]} value={draft.narcoticGasPolicy} /></div>;
  if (id === "ppo2") return <div className="bf-form-grid"><NumberField error={fieldError("oxygen")} label="O₂ fraction (%)" min={0} onChange={(value) => setField("oxygen", value / 100)} step={1} value={draft.oxygen * 100} />{depth("depthM", "Depth")}</div>;
  if (id === "end") return <div className="bf-form-grid">{depth("depthM", "Depth")}<NumberField error={fieldError("oxygen")} label="O₂ fraction (%)" min={0} onChange={(value) => setField("oxygen", value / 100)} step={1} value={draft.oxygen * 100} /><NumberField error={fieldError("helium")} label="He fraction (%)" min={0} onChange={(value) => setField("helium", value / 100)} step={1} value={draft.helium * 100} /><SegmentedControl label="Narcotic policy" onChange={(value) => setField("narcoticGasPolicy", value)} options={[{ value: "oxygen-and-nitrogen", label: "O₂ + N₂" }, { value: "nitrogen-only", label: "N₂ only" }]} value={draft.narcoticGasPolicy} /></div>;
  if (id === "gas-density") return <div className="bf-form-grid"><NumberField error={fieldError("oxygen")} label="O₂ fraction (%)" min={0} onChange={(value) => setField("oxygen", value / 100)} step={1} value={draft.oxygen * 100} /><NumberField error={fieldError("helium")} label="He fraction (%)" min={0} onChange={(value) => setField("helium", value / 100)} step={1} value={draft.helium * 100} />{depth("depthM", "Depth")}<NumberField error={fieldError("temperatureC")} label="Temperature (°C)" onChange={(value) => setField("temperatureC", value)} step={1} value={draft.temperatureC} /></div>;
  if (id === "sac-rmv") { const effectiveTarget = planMode === "oc" ? (draft.rmvTarget === "bailout" || draft.rmvTarget === "bailout-deco" ? "bottom" : draft.rmvTarget) : (draft.rmvTarget === "bottom" || draft.rmvTarget === "deco" ? "bailout" : draft.rmvTarget); return <><SegmentedControl label="Measurement mode" onChange={(value) => setField("sacMode", value)} options={[{ value: "surface-volume", label: "Surface gas used" }, { value: "cylinder-pressure-drop", label: "Cylinder pressure drop" }]} value={draft.sacMode} /><SegmentedControl label="Plan target" onChange={(value) => setField("rmvTarget", value)} options={planMode === "oc" ? [{ value: "bottom", label: "OC bottom SAC/RMV" }, { value: "deco", label: "OC deco SAC/RMV" }] : [{ value: "bailout", label: "CCR bailout SAC/RMV" }, { value: "bailout-deco", label: "CCR bailout deco SAC/RMV" }]} value={effectiveTarget} /><div className="bf-form-grid">{depth("startDepthM", "Start depth")}{depth("endDepthM", "End depth")}<NumberField error={fieldError("durationSeconds")} label="Elapsed time (min)" min={.1} onChange={(value) => setField("durationSeconds", value * 60)} step={1} value={draft.durationSeconds / 60} />{draft.sacMode === "surface-volume" ? <NumberField error={fieldError("gasUsedL")} label={`Gas used (${surfaceGasUnit(units.cylinderCapacity)})`} min={0} onChange={(value) => setField("gasUsedL", surfaceGasInputToCanonical(value, units.cylinderCapacity, [draft.gasUsedL]))} step={surfaceGasInputStep(units.cylinderCapacity)} value={surfaceGasInputValue(draft.gasUsedL, units.cylinderCapacity)} /> : <>{capacity}{working}{pressureField("startingPressureBar", "Starting pressure", draft.startingPressureBar, (value) => setField("startingPressureBar", value))}{pressureField("endingPressureBar", "Ending pressure", draft.endingPressureBar, (value) => setField("endingPressureBar", value))}</>}</div></>; }
  if (id === "gas-duration" || id === "cylinder-gas") return <div className="bf-form-grid">{capacity}{working}{pressureField("startingPressureBar", "Starting pressure", draft.startingPressureBar, (value) => setField("startingPressureBar", value))}{pressureField("reservePressureBar", "Reserve pressure", draft.reservePressureBar, (value) => setField("reservePressureBar", value))}{id === "gas-duration" && <>{rmv}{depth("depthM", "Average depth")}</>}</div>;
  if (id === "cns") return <div className="bf-form-grid"><NumberField error={fieldError("ppo2Bar")} label="PPO₂ (bar absolute)" min={.1} onChange={(value) => setField("ppo2Bar", value)} step={.05} value={draft.ppo2Bar} /><NumberField error={fieldError("durationSeconds")} label="Exposure (min)" min={0} onChange={(value) => setField("durationSeconds", value * 60)} value={draft.durationSeconds / 60} /></div>;
  if (id === "emergency-gas") return <EmergencyInputs draft={draft as EmergencyDraft} units={units} fieldError={fieldError} setField={setField} patchDraft={patchDraft} pressureField={pressureField} />;
}
