import { useMemo, useState } from "react";
import { calculateDivePlan } from "../engine/planner";
import type { Diagnostic, DivePlan, GasRole, PlannerConventionId } from "../domain/types";
import type { SavedPlansStore, TankBankStore, TankRecord } from "../storage";
import {
  FieldGroup,
  GasChip,
  PageHeader,
  Panel,
  SavePlanDialog,
  SegmentedControl,
  WarningList,
  type WarningItem,
} from "../ui";
import { ActionButton, NumberField, SelectField, TextField, ToggleField } from "./controls";
import {
  capacityLabel,
  capacityInputValue,
  capacityUnit,
  depthInputValue,
  depthToCanonical,
  depthUnit,
  formatPressure,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  pressureUnit,
  ratedCapacityFromCanonical,
  waterVolumeFromRatedCapacity,
  type UnitPreferences,
} from "./helpers";
import {
  resolvePlanInput,
  type GasDraft,
  type PlanDraft,
  type ReserveDraft,
} from "./planning";
import { PlanResultView } from "./PlanResultView";

const diagnosticItems = (diagnostics: readonly Diagnostic[]): readonly WarningItem[] => diagnostics.map((item, index) => ({
  id: `${item.code}-${index}`,
  message: item.field ? `${item.message} (${item.field})` : item.message,
  severity: item.severity,
}));

function activeTanks(store?: TankBankStore): readonly TankRecord[] {
  const result = store?.list({ archived: false });
  return result?.ok ? result.value : [];
}

function GasEditor({
  value,
  tanks,
  preferences,
  onChange,
  onRemove,
}: {
  readonly value: GasDraft;
  readonly tanks: readonly TankRecord[];
  readonly preferences: UnitPreferences;
  readonly onChange: (next: GasDraft) => void;
  readonly onRemove?: () => void;
}) {
  const selected = tanks.find((tank) => tank.id === value.cylinderId);
  const gas = selected?.gas;
  const change = <K extends keyof GasDraft>(key: K, next: GasDraft[K]) => onChange({ ...value, [key]: next });
  return <article className="bf-gas-editor">
    <header className="bf-row-header">
      <div>
        <p className="bf-eyebrow">{value.role}</p>
        <h3>{gas?.name ?? value.name}</h3>
      </div>
      {onRemove && <ActionButton danger onClick={onRemove} quiet>Remove</ActionButton>}
    </header>
    <div className="bf-form-grid">
      <FieldGroup label="Cylinder source" hint="Tank Bank entries are snapshotted into this calculation.">
        <select
          aria-label={`${value.name} cylinder source`}
          onChange={(event) => change("cylinderId", event.currentTarget.value || undefined)}
          value={value.cylinderId ?? ""}
        >
          <option value="">Ad hoc plan cylinder</option>
          {tanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.name} · {tank.gas.name}</option>)}
        </select>
      </FieldGroup>
      {selected ? <div className="bf-inline-summary">
        <GasChip name={selected.gas.name} oxygen={selected.gas.oxygen * 100} helium={selected.gas.helium * 100} role={selected.role} />
        <span>{ratedCapacityFromCanonical(selected.waterVolumeL, selected.workingPressureBar, preferences.cylinderCapacity).toFixed(1)} {capacityUnit(preferences.cylinderCapacity)} {preferences.cylinderCapacity === "imperial" ? "rated at working pressure" : "water volume"} · {formatPressure(selected.currentPressureBar, preferences.pressure)}</span>
      </div> : <>
        <TextField label="Gas name" onChange={(next) => change("name", next)} value={value.name} />
        <NumberField label="O₂ (%)" max={100} min={0} onChange={(next) => change("oxygenPercent", next)} step={0.1} value={value.oxygenPercent} />
        <NumberField label="He (%)" max={100} min={0} onChange={(next) => change("heliumPercent", next)} step={0.1} value={value.heliumPercent} />
        <NumberField label={capacityLabel(preferences.cylinderCapacity)} hint={preferences.cylinderCapacity === "imperial" ? "Rated surface capacity is converted with the cylinder working pressure." : "Physical internal water volume used by metric cylinder specifications."} min={0.1} onChange={(next) => change("waterVolumeL", waterVolumeFromRatedCapacity(next, value.workingPressureBar, preferences.cylinderCapacity))} step={0.1} value={capacityInputValue(value.waterVolumeL, value.workingPressureBar, preferences.cylinderCapacity)} />
        <NumberField
          label={`Working pressure (${pressureUnit(preferences.pressure)})`}
          min={0}
          onChange={(next) => {
            const capacity = ratedCapacityFromCanonical(value.waterVolumeL, value.workingPressureBar, preferences.cylinderCapacity);
            const workingPressureBar = pressureInputToCanonical(next, preferences.pressure, [value.workingPressureBar, value.currentPressureBar]);
            onChange({
              ...value,
              workingPressureBar,
              waterVolumeL: waterVolumeFromRatedCapacity(capacity, workingPressureBar, preferences.cylinderCapacity),
            });
          }}
          step={pressureInputStep(preferences.pressure)}
          value={pressureInputValue(value.workingPressureBar, preferences.pressure)}
        />
        <NumberField
          label={`Starting pressure (${pressureUnit(preferences.pressure)})`}
          min={0}
          onChange={(next) => change("currentPressureBar", pressureInputToCanonical(next, preferences.pressure, [value.currentPressureBar, value.workingPressureBar]))}
          step={pressureInputStep(preferences.pressure)}
          value={pressureInputValue(value.currentPressureBar, preferences.pressure)}
        />
        <NumberField
          label={`Cylinder minimum (${pressureUnit(preferences.pressure)})`}
          min={0}
          onChange={(next) => change("minimumPressureBar", pressureInputToCanonical(next, preferences.pressure, [value.minimumPressureBar ?? 0, value.currentPressureBar]))}
          step={pressureInputStep(preferences.pressure)}
          value={pressureInputValue(value.minimumPressureBar ?? 0, preferences.pressure)}
        />
        <NumberField label="Cylinder max PPO₂ (bar)" min={0.1} onChange={(next) => change("maximumPPO2Bar", next)} step={0.05} value={value.maximumPPO2Bar} />
      </>}
      {(value.role === "bottom" || value.role === "deco" || value.role === "bailout") && <NumberField
        hint={value.role === "bottom" ? "Travel-to-bottom switch depth; required whenever travel gas is selected." : "Gas is eligible only at or shallower than this depth."}
        label={`Switch depth (${depthUnit(preferences.depth)})`}
        min={0}
        onChange={(next) => change("switchDepthM", depthToCanonical(next, preferences.depth))}
        value={depthInputValue(value.switchDepthM ?? 0, preferences.depth)}
      />}
    </div>
  </article>;
}

function nextGasKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function newGas(role: GasRole): GasDraft {
  return {
    key: nextGasKey(role),
    name: role === "deco" ? "New deco gas" : "New bailout gas",
    oxygenPercent: role === "deco" ? 50 : 21,
    heliumPercent: 0,
    role,
    switchDepthM: role === "deco" ? 21 : undefined,
    waterVolumeL: 11,
    workingPressureBar: 200,
    currentPressureBar: 200,
    minimumPressureBar: 35,
    maximumPPO2Bar: role === "deco" ? 1.6 : 1.4,
  };
}

function ReserveEditor({ value, preferences, onChange }: {
  readonly value: ReserveDraft;
  readonly preferences: UnitPreferences;
  readonly onChange: (next: ReserveDraft) => void;
}) {
  const setKind = (kind: ReserveDraft["kind"]) => {
    switch (kind) {
      case "fixed": onChange({ kind, minimumPressureBar: 35 }); break;
      case "custom": onChange({ kind, reserveVolumeL: 500 }); break;
      case "rock-bottom": onChange({ kind, teamSize: 2, stressedRmvLpm: 40 }); break;
      case "thirds": onChange({ kind }); break;
      case "sixths": onChange({ kind }); break;
    }
  };
  return <div className="bf-form-grid">
    <SelectField
      label="Reserve policy"
      onChange={setKind}
      options={[
        { value: "fixed", label: "Fixed minimum pressure" },
        { value: "rock-bottom", label: "Rock bottom / team reserve" },
        { value: "thirds", label: "Cave thirds" },
        { value: "sixths", label: "Cave sixths" },
        { value: "custom", label: "Custom surface volume" },
      ]}
      value={value.kind}
    />
    {value.kind === "fixed" && <NumberField
      label={`Minimum pressure (${pressureUnit(preferences.pressure)})`}
      min={0}
      onChange={(next) => onChange({ ...value, minimumPressureBar: pressureInputToCanonical(next, preferences.pressure, [value.minimumPressureBar]) })}
      step={pressureInputStep(preferences.pressure)}
      value={pressureInputValue(value.minimumPressureBar, preferences.pressure)}
    />}
    {value.kind === "custom" && <NumberField label="Reserve volume (surface L)" min={0} onChange={(reserveVolumeL) => onChange({ ...value, reserveVolumeL })} value={value.reserveVolumeL} />}
    {value.kind === "rock-bottom" && <>
      <NumberField label="Team size" min={1} onChange={(teamSize) => onChange({ ...value, teamSize })} value={value.teamSize} />
      <NumberField label="Stressed RMV per diver (L/min)" min={1} onChange={(stressedRmvLpm) => onChange({ ...value, stressedRmvLpm })} value={value.stressedRmvLpm} />
    </>}
  </div>;
}

export function PlannerEditor({
  draft,
  onChange,
  tanks,
  preferences,
  environment = "open-water",
  showBottomTime = true,
}: {
  readonly draft: PlanDraft;
  readonly onChange: (next: PlanDraft) => void;
  readonly tanks: readonly TankRecord[];
  readonly preferences: UnitPreferences;
  readonly environment?: "open-water" | "cave";
  readonly showBottomTime?: boolean;
}) {
  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => onChange({ ...draft, [key]: value });
  const updateArray = (key: "decoGases" | "bailoutGases", index: number, value: GasDraft) => {
    const next = [...draft[key]];
    next[index] = value;
    set(key, next);
  };
  return <>
    <Panel eyebrow={environment === "cave" ? "Overhead environment" : "Square profile"} title="Profile and breathing mode">
      <div className="bf-form-grid">
        <SegmentedControl
          label="Mode"
          onChange={(mode) => set("mode", mode)}
          options={[{ value: "oc", label: "Open circuit" }, { value: "ccr", label: "CCR" }]}
          value={draft.mode}
        />
        <NumberField
          label={`Maximum depth (${depthUnit(preferences.depth)})`}
          min={1}
          onChange={(next) => set("depthM", depthToCanonical(next, preferences.depth))}
          value={depthInputValue(draft.depthM, preferences.depth)}
        />
        {showBottomTime && <NumberField label="Time at target depth (min)" min={0.1} onChange={(bottomTimeMinutes) => set("bottomTimeMinutes", bottomTimeMinutes)} step={0.5} value={draft.bottomTimeMinutes} />}
      </div>
    </Panel>

    {draft.mode === "oc" ? <Panel
      actions={<ActionButton onClick={() => set("decoGases", [...draft.decoGases, newGas("deco")])} quiet>Add deco gas</ActionButton>}
      title="Open-circuit gases"
    >
      <GasEditor onChange={(bottomGas) => set("bottomGas", bottomGas)} preferences={preferences} tanks={tanks} value={draft.bottomGas} />
      <ToggleField checked={draft.travelGasEnabled} hint="Required for a hypoxic bottom mix; set the bottom-gas switch depth before calculating." label="Use travel gas" onChange={(travelGasEnabled) => set("travelGasEnabled", travelGasEnabled)} />
      {draft.travelGasEnabled && <GasEditor onChange={(travelGas) => set("travelGas", travelGas)} preferences={preferences} tanks={tanks} value={draft.travelGas} />}
      {draft.decoGases.map((gas, index) => <GasEditor
        key={gas.key}
        onChange={(next) => updateArray("decoGases", index, next)}
        onRemove={() => set("decoGases", draft.decoGases.filter((_, gasIndex) => gasIndex !== index))}
        preferences={preferences}
        tanks={tanks}
        value={gas}
      />)}
    </Panel> : <>
      <Panel title="CCR loop">
        <div className="bf-form-grid">
          <NumberField label="Constant setpoint (bar)" max={1.6} min={0.5} onChange={(setpointBar) => set("setpointBar", setpointBar)} step={0.05} value={draft.setpointBar} />
          <NumberField
            label={`Setpoint activation (${depthUnit(preferences.depth)})`}
            min={0}
            onChange={(next) => set("setpointActivationDepthM", depthToCanonical(next, preferences.depth))}
            value={depthInputValue(draft.setpointActivationDepthM, preferences.depth)}
          />
          <ToggleField
            checked={draft.bailoutTriggerMinutes !== undefined}
            hint="Calculate bailout from the exact at-depth tissue state."
            label="Model explicit bailout trigger"
            onChange={(enabled) => set("bailoutTriggerMinutes", enabled ? Math.min(10, draft.bottomTimeMinutes) : undefined)}
          />
          {draft.bailoutTriggerMinutes !== undefined && <NumberField label="Bailout trigger at depth (min)" min={0} max={draft.bottomTimeMinutes} onChange={(bailoutTriggerMinutes) => set("bailoutTriggerMinutes", bailoutTriggerMinutes)} value={draft.bailoutTriggerMinutes} />}
        </div>
        <GasEditor onChange={(diluent) => set("diluent", diluent)} preferences={preferences} tanks={tanks} value={draft.diluent} />
      </Panel>
      <Panel
        actions={<ActionButton onClick={() => set("bailoutGases", [...draft.bailoutGases, newGas("bailout")])} quiet>Add bailout gas</ActionButton>}
        title="Bailout gases"
      >
        {draft.bailoutGases.map((gas, index) => <GasEditor
          key={gas.key}
          onChange={(next) => updateArray("bailoutGases", index, next)}
          onRemove={() => set("bailoutGases", draft.bailoutGases.filter((_, gasIndex) => gasIndex !== index))}
          preferences={preferences}
          tanks={tanks}
          value={gas}
        />)}
      </Panel>
    </>}

    <Panel title="Decompression and gas policies">
      <div className="bf-form-grid">
        <SelectField<PlannerConventionId>
          hint="All compatibility presets remain explicitly experimental until their validation suites are complete."
          label="Convention preset"
          onChange={(conventionId) => set("conventionId", conventionId)}
          options={[
            { value: "barefoot-zhl16c-v1", label: "Barefoot ZHL-16C preset" },
            { value: "shearwater-petrel3-v103-compatible-v1", label: "Shearwater Petrel 3 documented preset" },
            { value: "multideco-zhlc-compatible-v1", label: "MultiDeco ZHL-C preset" },
          ]}
          value={draft.conventionId}
        />
        <NumberField label="GF Low (%)" max={100} min={1} onChange={(gfLowPercent) => set("gfLowPercent", gfLowPercent)} value={draft.gfLowPercent} />
        <NumberField label="GF High (%)" max={100} min={1} onChange={(gfHighPercent) => set("gfHighPercent", gfHighPercent)} value={draft.gfHighPercent} />
        <NumberField label="Bottom RMV (L/min)" min={1} onChange={(bottomRmvLpm) => set("bottomRmvLpm", bottomRmvLpm)} value={draft.bottomRmvLpm} />
        <NumberField label="Deco RMV (L/min)" min={1} onChange={(decoRmvLpm) => set("decoRmvLpm", decoRmvLpm)} value={draft.decoRmvLpm} />
        <NumberField label="Bailout RMV (L/min)" min={1} onChange={(bailoutRmvLpm) => set("bailoutRmvLpm", bailoutRmvLpm)} value={draft.bailoutRmvLpm} />
        <NumberField label="Bailout deco RMV (L/min)" min={1} onChange={(bailoutDecoRmvLpm) => set("bailoutDecoRmvLpm", bailoutDecoRmvLpm)} value={draft.bailoutDecoRmvLpm} />
      </div>
      <ReserveEditor onChange={(reserve) => set("reserve", reserve)} preferences={preferences} value={draft.reserve} />
    </Panel>
  </>;
}

type CalculatedState = {
  readonly input: ReturnType<typeof resolvePlanInput>["input"];
  readonly plan: DivePlan;
  readonly signature: string;
};

export default function PlanPage({
  draft,
  onDraftChange,
  preferences,
  tanks,
  plans,
  onStorageChange,
}: {
  readonly draft: PlanDraft;
  readonly onDraftChange: (next: PlanDraft) => void;
  readonly preferences: UnitPreferences;
  readonly tanks?: TankBankStore;
  readonly plans?: SavedPlansStore;
  readonly onStorageChange?: () => void;
}) {
  const [calculated, setCalculated] = useState<CalculatedState>();
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const tankRecords = useMemo(() => activeTanks(tanks), [tanks]);
  const resolved = useMemo(() => resolvePlanInput(draft, tankRecords), [draft, tankRecords]);
  const signature = JSON.stringify(resolved.input);
  const stale = Boolean(calculated && calculated.signature !== signature);

  const run = () => {
    const result = calculateDivePlan(resolved.input);
    setDiagnostics(result.ok ? [...result.warnings, ...(result.errors ?? [])] : [...result.warnings, ...result.errors]);
    if (result.ok) setCalculated({ input: resolved.input, plan: result.value, signature });
  };
  const save = (title: string) => {
    if (!plans || !calculated || stale) return;
    const result = plans.create({
      title,
      normalizedInputSnapshot: calculated.input,
      calculatedPlan: calculated.plan,
      warnings: calculated.plan.diagnostics,
    });
    if (!result.ok) setDiagnostics([{ code: result.error.code, severity: "error", message: result.error.message }]);
    else {
      setSaveOpen(false);
      onStorageChange?.();
    }
  };

  return <>
    <PageHeader
      actions={<ActionButton onClick={run}>Calculate plan</ActionButton>}
      description="Build a deterministic square-profile OC or constant-setpoint CCR plan with explicit gas, equipment, consumption, and reserve assumptions."
      eyebrow="OFFLINE · UNIT-SAFE"
      title="Plan"
    />
    <PlannerEditor draft={draft} onChange={onDraftChange} preferences={preferences} tanks={tankRecords} />
    <WarningList items={diagnosticItems(diagnostics)} title="Calculation diagnostics" />
    {calculated && <PlanResultView
      onSave={() => setSaveOpen(true)}
      plan={calculated.plan}
      preferences={preferences}
      stale={stale}
    />}
    <SavePlanDialog
      defaultName={`${draft.mode.toUpperCase()} · ${Math.round(draft.depthM)} m · ${draft.bottomTimeMinutes} min`}
      onCancel={() => setSaveOpen(false)}
      onSave={save}
      open={saveOpen}
    />
  </>;
}
