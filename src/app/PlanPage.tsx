import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type Ref, type SetStateAction } from "react";
import { calculateDivePlan } from "../engine/planner";
import type { Diagnostic, GasRole, PlannerConventionId } from "../domain/types";
import type { SavedPlansStore, TankBankStore, TankRecord } from "../storage";
import {
  CompletionNotice,
  FieldGroup,
  GasChip,
  PageHeader,
  Panel,
  SavePlanDialog,
  SegmentedControl,
  WarningList,
  type WarningItem,
} from "../ui";
import { ActionButton, NumberField, OptionalNumberField, SelectField, TextField, ToggleField } from "./controls";
import {
  capacityLabel,
  capacityInputValue,
  capacityUnit,
  depthInputValue,
  depthToCanonical,
  depthUnit,
  formatDepth,
  formatPressure,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  pressureUnit,
  ratedCapacityFromCanonical,
  surfaceGasInputStep,
  surfaceGasInputToCanonical,
  surfaceGasInputValue,
  surfaceGasRateInputStep,
  surfaceGasRateInputToCanonical,
  surfaceGasRateInputValue,
  surfaceGasRateUnit,
  surfaceGasUnit,
  switchDepthToCanonical,
  waterVolumeFromRatedCapacity,
  type UnitPreferences,
} from "./helpers";
import {
  isGasOnlyPlan,
  resolvePlanInput,
  selectableTanks,
  tankBankSnapshot,
  tankSourceSignature,
  tankSourceUnavailableText,
  withGasPlanning,
  type GasDraft,
  type PlanDraft,
  type ReserveDraft,
  type TankBankSnapshot,
  type UnavailableTankSource,
} from "./planning";
import { PlanResultView } from "./PlanResultView";
import type { PlanWorkspaceSession, PlanWorkspaceView } from "./planWorkspace";
import { invalidateForUnavailableSource, workspaceStatus, type WorkspaceStatus } from "./workspaceStatus";

const diagnosticItems = (diagnostics: readonly Diagnostic[]): readonly WarningItem[] => diagnostics.map((item, index) => ({
  id: `${item.code}-${index}`,
  message: item.field ? `${item.message} (${item.field})` : item.message,
  severity: item.severity,
}));

/** Every stored Tank Bank record, archived included, so an unavailable Plan or Cave source can say why. */
export function readTankBank(store?: TankBankStore): TankBankSnapshot {
  return tankBankSnapshot(store?.list());
}

/**
 * A gas whose selected Tank Bank cylinder cannot be used: why, and exactly the ad hoc values a
 * detach would calculate with. The cylinder fields stay read-only until the diver detaches.
 */
function UnavailableSourceNotice({ source, preferences, reserveKind, onDetach }: {
  readonly source: UnavailableTankSource;
  readonly preferences: UnitPreferences;
  readonly reserveKind?: ReserveDraft["kind"];
  readonly onDetach: () => void;
}) {
  const { gas, cylinder } = source.adHoc;
  const policyFraction = reserveKind === "thirds" ? 1 / 3 : reserveKind === "sixths" ? 2 / 3 : undefined;
  const enteredMinimumBar = cylinder.minimumPressureBar ?? 0;
  const minimumBar = policyFraction === undefined ? enteredMinimumBar : Math.max(cylinder.currentPressureBar * policyFraction, enteredMinimumBar);
  const values: readonly (readonly [string, string])[] = [
    ["Gas", gas.name],
    ["O₂", `${+(gas.oxygen * 100).toFixed(1)}%`],
    ["He", `${+(gas.helium * 100).toFixed(1)}%`],
    ["Capacity", `${capacityInputValue(cylinder.waterVolumeL, cylinder.workingPressureBar, preferences.cylinderCapacity).toFixed(1)} ${capacityUnit(preferences.cylinderCapacity)} ${preferences.cylinderCapacity === "imperial" ? "rated" : "water volume"}`],
    ["Working pressure", formatPressure(cylinder.workingPressureBar, preferences.pressure)],
    ["Starting pressure", formatPressure(cylinder.currentPressureBar, preferences.pressure)],
    [policyFraction === undefined ? "Cylinder minimum" : "Cylinder minimum (reserve policy)", formatPressure(minimumBar, preferences.pressure)],
    ["Cylinder max PPO₂", `${cylinder.maximumPPO2.toFixed(2)} bar`],
  ];
  return <div className="bf-source-unavailable" role="alert">
    <p><strong>Tank Bank source unavailable.</strong> {tankSourceUnavailableText(source)} This gas is not calculated until you choose another cylinder or detach it to these ad hoc values:</p>
    <dl className="bf-source-unavailable__values">
      {values.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
    <ActionButton onClick={onDetach} quiet small>Detach to ad hoc values</ActionButton>
  </div>;
}

function GasEditor({
  containerRef,
  value,
  tanks,
  unavailable,
  preferences,
  onChange,
  onRemove,
  reserveKind,
  showSwitchDepth = true,
  switchable = false,
  gasOnly = false,
}: {
  readonly containerRef?: Ref<HTMLElement>;
  readonly value: GasDraft;
  /** Cylinders the gas can be sourced from (loaded, not archived). */
  readonly tanks: readonly TankRecord[];
  /** Set when the selected Tank Bank cylinder cannot be used; the gas is then held out of every calculation. */
  readonly unavailable?: UnavailableTankSource;
  readonly preferences: UnitPreferences;
  readonly onChange: (next: GasDraft) => void;
  readonly onRemove?: () => void;
  /** Active reserve policy; cave thirds/sixths lock the cylinder minimum to the policy fraction. */
  readonly reserveKind?: ReserveDraft["kind"];
  /** Bottom gas only needs a switch depth when a travel gas is in use. */
  readonly showSwitchDepth?: boolean;
  /** Deco and bailout gases can be switched off to see the plan without them. */
  readonly switchable?: boolean;
  /** Gas-only planning: mix, PPO₂ ceiling, and switch depth only; no cylinder or Tank Bank source. */
  readonly gasOnly?: boolean;
}) {
  const sourceRef = useRef<HTMLSelectElement>(null);
  const selected = gasOnly ? undefined : tanks.find((tank) => tank.id === value.cylinderId);
  const gas = selected?.gas;
  const change = <K extends keyof GasDraft>(key: K, next: GasDraft[K]) => onChange({ ...value, [key]: next });
  const included = value.enabled !== false;
  const policyFraction = reserveKind === "thirds" ? 1 / 3 : reserveKind === "sixths" ? 2 / 3 : undefined;
  const policyMinimumBar = policyFraction === undefined ? undefined : value.currentPressureBar * policyFraction;
  const enteredMinimumBar = value.minimumPressureBar ?? 0;
  const lockedMinimumBar = policyMinimumBar === undefined ? undefined : Math.max(policyMinimumBar, enteredMinimumBar);
  const lockHint = policyMinimumBar === undefined
    ? undefined
    : enteredMinimumBar > policyMinimumBar
      ? `Locked by the ${reserveKind === "thirds" ? "cave thirds" : "cave sixths"} policy; the entered cylinder minimum is higher than ${reserveKind === "thirds" ? "one third" : "two thirds"} of the starting pressure, so it governs.`
      : `Locked by the ${reserveKind === "thirds" ? "cave thirds" : "cave sixths"} policy: ${reserveKind === "thirds" ? "one third" : "two thirds"} of the starting pressure.`;
  return <article className="bf-gas-editor" data-excluded={included ? undefined : ""} ref={containerRef}>
    <header className="bf-row-header">
      <div>
        <p className="bf-eyebrow">{value.role}</p>
        <h3>{gas?.name ?? value.name}</h3>
        {selected && <div className="bf-row-header__meta">
          <GasChip name={selected.gas.name} oxygen={selected.gas.oxygen * 100} helium={selected.gas.helium * 100} role={selected.role} />
          <span className="bf-inline-summary">{ratedCapacityFromCanonical(selected.waterVolumeL, selected.workingPressureBar, preferences.cylinderCapacity).toFixed(1)} {capacityUnit(preferences.cylinderCapacity)} {preferences.cylinderCapacity === "imperial" ? "rated at working pressure" : "water volume"} · {formatPressure(selected.currentPressureBar, preferences.pressure)}</span>
        </div>}
      </div>
      <div className="bf-row-header__actions">
        {switchable && <label className="bf-check bf-gas-editor__switch">
          <input aria-label={`Include ${gas?.name ?? value.name} in plan`} checked={included} onChange={(event) => change("enabled", event.currentTarget.checked)} type="checkbox" />
          <span>Include in plan</span>
        </label>}
        {onRemove && <ActionButton danger onClick={onRemove} quiet small>Remove</ActionButton>}
      </div>
    </header>
    {!included && <p className="bf-panel__note">Excluded from this calculation. The entered values are kept; switch it back on to plan with this gas.</p>}
    {included && !gasOnly && unavailable && <UnavailableSourceNotice
      onDetach={() => {
        change("cylinderId", undefined);
        // The detach button leaves with the notice; keep keyboard focus on this gas's source control.
        sourceRef.current?.focus();
      }}
      preferences={preferences}
      reserveKind={reserveKind}
      source={unavailable}
    />}
    {included && gasOnly && <div className="bf-form-grid bf-form-grid--gas">
      <TextField label="Gas name" onChange={(next) => change("name", next)} value={value.name} />
      <NumberField label="O₂ (%)" max={100} min={0} onChange={(next) => change("oxygenPercent", next)} step={0.1} value={value.oxygenPercent} />
      <NumberField label="He (%)" max={100} min={0} onChange={(next) => change("heliumPercent", next)} step={0.1} value={value.heliumPercent} />
      <NumberField label="Max PPO₂ (bar)" min={0.1} onChange={(next) => change("maximumPPO2Bar", next)} step={0.05} value={value.maximumPPO2Bar} />
      {showSwitchDepth && (value.role === "bottom" || value.role === "deco" || value.role === "bailout") && <NumberField
        hint={value.role === "bottom" ? "Travel-to-bottom switch depth; required whenever travel gas is selected." : undefined}
        label={`Switch depth (${depthUnit(preferences.depth)})`}
        min={0}
        onChange={(next) => change("switchDepthM", depthToCanonical(next, preferences.depth))}
        value={depthInputValue(value.switchDepthM ?? 0, preferences.depth)}
      />}
    </div>}
    {included && !gasOnly && <div className="bf-form-grid bf-form-grid--gas">
      <FieldGroup label="Cylinder source">
        <select
          aria-label={`${value.name} cylinder source`}
          onChange={(event) => change("cylinderId", event.currentTarget.value || undefined)}
          ref={sourceRef}
          value={value.cylinderId ?? ""}
        >
          {unavailable && <option disabled value={unavailable.cylinderId}>Unavailable · {unavailable.cylinderName ?? "selected cylinder"}</option>}
          <option value="">Ad hoc plan cylinder</option>
          {tanks.map((tank) => <option key={tank.id} value={tank.id}>{tank.name} · {tank.gas.name}</option>)}
        </select>
      </FieldGroup>
      {selected || unavailable ? null : <>
        <TextField label="Gas name" onChange={(next) => change("name", next)} value={value.name} />
        <NumberField label="O₂ (%)" max={100} min={0} onChange={(next) => change("oxygenPercent", next)} step={0.1} value={value.oxygenPercent} />
        <NumberField label="He (%)" max={100} min={0} onChange={(next) => change("heliumPercent", next)} step={0.1} value={value.heliumPercent} />
        <NumberField label={capacityLabel(preferences.cylinderCapacity)} min={0.1} onChange={(next) => change("waterVolumeL", waterVolumeFromRatedCapacity(next, value.workingPressureBar, preferences.cylinderCapacity))} step={0.1} value={capacityInputValue(value.waterVolumeL, value.workingPressureBar, preferences.cylinderCapacity)} />
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
          disabled={lockedMinimumBar !== undefined}
          hint={lockHint}
          label={`Cylinder minimum (${pressureUnit(preferences.pressure)})`}
          min={0}
          onChange={(next) => change("minimumPressureBar", pressureInputToCanonical(next, preferences.pressure, [value.minimumPressureBar ?? 0, value.currentPressureBar]))}
          step={pressureInputStep(preferences.pressure)}
          value={pressureInputValue(lockedMinimumBar ?? enteredMinimumBar, preferences.pressure)}
        />
        <NumberField label="Cylinder max PPO₂ (bar)" min={0.1} onChange={(next) => change("maximumPPO2Bar", next)} step={0.05} value={value.maximumPPO2Bar} />
      </>}
      {showSwitchDepth && (value.role === "bottom" || value.role === "deco" || value.role === "bailout") && <NumberField
        hint={value.role === "bottom" ? "Travel-to-bottom switch depth; required whenever travel gas is selected." : undefined}
        label={`Switch depth (${depthUnit(preferences.depth)})`}
        min={0}
        onChange={(next) => change("switchDepthM", depthToCanonical(next, preferences.depth))}
        value={depthInputValue(value.switchDepthM ?? 0, preferences.depth)}
      />}
    </div>}
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

function ReserveEditor({ value, preferences, onChange, gasOnly = false }: {
  readonly value: ReserveDraft;
  readonly preferences: UnitPreferences;
  readonly onChange: (next: ReserveDraft) => void;
  readonly gasOnly?: boolean;
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
    {value.kind === "fixed" && gasOnly && <div className="bf-inline-fix" role="alert">
      <p>A fixed minimum pressure needs cylinder sizes. Gas-only planning needs a volume-based reserve.</p>
      <ActionButton onClick={() => onChange({ kind: "thirds" })} quiet small>Use thirds</ActionButton>
    </div>}
    {value.kind === "fixed" && !gasOnly && <NumberField
      label={`Minimum pressure (${pressureUnit(preferences.pressure)})`}
      min={0}
      onChange={(next) => onChange({ ...value, minimumPressureBar: pressureInputToCanonical(next, preferences.pressure, [value.minimumPressureBar]) })}
      step={pressureInputStep(preferences.pressure)}
      value={pressureInputValue(value.minimumPressureBar, preferences.pressure)}
    />}
    {value.kind === "custom" && <NumberField
      label={`Reserve volume (surface ${surfaceGasUnit(preferences.cylinderCapacity)})`}
      min={0}
      onChange={(next) => onChange({ ...value, reserveVolumeL: surfaceGasInputToCanonical(next, preferences.cylinderCapacity, [value.reserveVolumeL]) })}
      step={surfaceGasInputStep(preferences.cylinderCapacity)}
      value={surfaceGasInputValue(value.reserveVolumeL, preferences.cylinderCapacity)}
    />}
    {value.kind === "rock-bottom" && <>
      <NumberField label="Team size" min={1} onChange={(teamSize) => onChange({ ...value, teamSize })} value={value.teamSize} />
      <NumberField label={`Stressed SAC/RMV per diver (${surfaceGasRateUnit(preferences.cylinderCapacity)})`} min={0.1} onChange={(next) => onChange({ ...value, stressedRmvLpm: surfaceGasRateInputToCanonical(next, preferences.cylinderCapacity, [value.stressedRmvLpm]) })} step={surfaceGasRateInputStep()} value={surfaceGasRateInputValue(value.stressedRmvLpm, preferences.cylinderCapacity)} />
    </>}
  </div>;
}

export function PlannerEditor({
  draft,
  onChange,
  tankBank,
  unavailableSources,
  preferences,
  environment = "open-water",
  showBottomTime = true,
}: {
  readonly draft: PlanDraft;
  readonly onChange: (next: PlanDraft) => void;
  readonly tankBank: TankBankSnapshot;
  /** Active gases whose selected Tank Bank cylinder cannot be used, from `resolvePlanInput`. */
  readonly unavailableSources: readonly UnavailableTankSource[];
  readonly preferences: UnitPreferences;
  readonly environment?: "open-water" | "cave";
  readonly showBottomTime?: boolean;
}) {
  const [pendingGasKey, setPendingGasKey] = useState<string>();
  const pendingGasRef = useRef<HTMLElement>(null);
  const set = <K extends keyof PlanDraft>(key: K, value: PlanDraft[K]) => onChange({ ...draft, [key]: value });
  const gasOnly = isGasOnlyPlan(draft, environment);
  const tanks = selectableTanks(tankBank);
  const unavailableByGas = new Map(unavailableSources.map((source) => [source.gasKey, source]));
  const gasNote = gasOnly
    ? "Gas-only planning: enter mixes only. Results give the minimum surface volume to carry for each gas, including the reserve policy. Cylinder capacity, pressures, and unusable residual gas are not checked. Deco and bailout gases are eligible only at or shallower than their switch depth."
    : `Tank Bank cylinders are copied into this calculation as snapshots. ${preferences.cylinderCapacity === "imperial" ? "Rated capacity is converted with the cylinder working pressure." : "Capacity is the physical internal water volume."} Deco and bailout gases are eligible only at or shallower than their switch depth.`;
  const rateUnit = surfaceGasRateUnit(preferences.cylinderCapacity);
  const rateField = (label: string, key: "bottomRmvLpm" | "decoRmvLpm" | "bailoutRmvLpm" | "bailoutDecoRmvLpm") => <NumberField
    key={key}
    label={`${label} (${rateUnit})`}
    min={0.1}
    onChange={(next) => set(key, surfaceGasRateInputToCanonical(next, preferences.cylinderCapacity, [draft[key]]))}
    step={surfaceGasRateInputStep()}
    value={surfaceGasRateInputValue(draft[key], preferences.cylinderCapacity)}
  />;
  const updateArray = (key: "decoGases" | "bailoutGases", index: number, value: GasDraft) => {
    const next = [...draft[key]];
    next[index] = value;
    set(key, next);
  };
  const addGas = (key: "decoGases" | "bailoutGases", role: "deco" | "bailout") => {
    const gas = newGas(role);
    setPendingGasKey(gas.key);
    set(key, [...draft[key], gas]);
  };

  useEffect(() => {
    const target = pendingGasRef.current;
    if (!pendingGasKey || !target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      setPendingGasKey((current) => current === pendingGasKey ? undefined : current);
    });
    return () => cancelAnimationFrame(frame);
  }, [draft.bailoutGases, draft.decoGases, pendingGasKey]);

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

    <Panel title="Decompression and gas policies">
      <div className="bf-form-grid">
        {environment !== "cave" && <SegmentedControl
          label="Gas planning"
          onChange={(gasPlanning) => onChange(withGasPlanning(draft, gasPlanning, tanks))}
          options={[
            { value: "cylinders", label: "Cylinders" },
            { value: "gas-only", label: "Gas only", disabled: unavailableSources.length > 0 },
          ]}
          value={draft.gasPlanning}
        />}
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
        {rateField("Bottom SAC/RMV", "bottomRmvLpm")}
        {rateField("Deco SAC/RMV", "decoRmvLpm")}
        {rateField("Bailout SAC/RMV", "bailoutRmvLpm")}
        {rateField("Bailout deco SAC/RMV", "bailoutDecoRmvLpm")}
      </div>
      {environment !== "cave" && unavailableSources.length > 0 && <p className="bf-panel__note">Gas only is off while a Tank Bank source is unavailable: that cylinder's mix cannot be carried into a gas-only plan. Choose another cylinder or detach the gas first.</p>}
      {draft.mode === "oc" && environment !== "cave" && <ToggleField
        checked={draft.bottomRmvUntilFirstStop}
        hint="On: the climb to the first stop, or a whole no-stop ascent, uses the bottom RMV. Off: the deco RMV starts at the end of bottom time, the rule before 0.5.0. Decompression and cylinder reserves are the same either way; gas-only minimums include the extra use."
        label="Bottom RMV until first stop"
        onChange={(bottomRmvUntilFirstStop) => set("bottomRmvUntilFirstStop", bottomRmvUntilFirstStop)}
      />}
      <ReserveEditor gasOnly={gasOnly} onChange={(reserve) => set("reserve", reserve)} preferences={preferences} value={draft.reserve} />
    </Panel>

    {draft.mode === "oc" ? <Panel
      actions={<ActionButton onClick={() => addGas("decoGases", "deco")} quiet>Add deco gas</ActionButton>}
      title="Open-circuit gases"
    >
      <p className="bf-panel__note">{gasNote}</p>
      <GasEditor gasOnly={gasOnly} onChange={(bottomGas) => set("bottomGas", bottomGas)} preferences={preferences} reserveKind={draft.reserve.kind} showSwitchDepth={draft.travelGasEnabled} tanks={tanks} unavailable={unavailableByGas.get(draft.bottomGas.key)} value={draft.bottomGas} />
      <ToggleField checked={draft.travelGasEnabled} hint="Required for a hypoxic bottom mix; set the bottom-gas switch depth before calculating." label="Use travel gas" onChange={(travelGasEnabled) => set("travelGasEnabled", travelGasEnabled)} />
      {draft.travelGasEnabled && <GasEditor gasOnly={gasOnly} onChange={(travelGas) => set("travelGas", travelGas)} preferences={preferences} reserveKind={draft.reserve.kind} tanks={tanks} unavailable={unavailableByGas.get(draft.travelGas.key)} value={draft.travelGas} />}
      {draft.decoGases.map((gas, index) => <GasEditor
        gasOnly={gasOnly}
        containerRef={gas.key === pendingGasKey ? pendingGasRef : undefined}
        key={gas.key}
        onChange={(next) => updateArray("decoGases", index, next)}
        onRemove={() => set("decoGases", draft.decoGases.filter((_, gasIndex) => gasIndex !== index))}
        preferences={preferences}
        reserveKind={draft.reserve.kind}
        switchable
        tanks={tanks}
        unavailable={unavailableByGas.get(gas.key)}
        value={gas}
      />)}
    </Panel> : <>
      <Panel title="CCR loop">
        <p className="bf-panel__note">{gasNote}</p>
        <div className="bf-form-grid bf-form-grid--gas">
          <NumberField label="Low setpoint (bar)" max={1.6} min={0.5} onChange={(lowSetpointBar) => set("lowSetpointBar", lowSetpointBar)} step={0.05} value={draft.lowSetpointBar} />
          <NumberField label="High setpoint (bar)" max={1.6} min={0.5} onChange={(setpointBar) => set("setpointBar", setpointBar)} step={0.05} value={draft.setpointBar} />
          <NumberField
            label={`Switch up to high setpoint (${depthUnit(preferences.depth)})`}
            min={0}
            onChange={(next) => set("setpointActivationDepthM", switchDepthToCanonical(next, preferences.depth))}
            value={depthInputValue(draft.setpointActivationDepthM, preferences.depth)}
          />
          <NumberField
            hint="Applied when leaving this depth on ascent, after any stop there. The plan never holds the high setpoint shallower than the loop can reach it."
            label={`Switch down to low setpoint (${depthUnit(preferences.depth)})`}
            min={0}
            onChange={(next) => set("setpointDeactivationDepthM", switchDepthToCanonical(next, preferences.depth))}
            value={depthInputValue(draft.setpointDeactivationDepthM, preferences.depth)}
          />
        </div>
        <ToggleField
          checked={draft.bailoutTriggerMinutes !== undefined}
          hint="Calculate bailout from the exact at-depth tissue state."
          label="Model explicit bailout trigger"
          onChange={(enabled) => set("bailoutTriggerMinutes", enabled ? Math.min(10, draft.bottomTimeMinutes) : undefined)}
        />
        {draft.bailoutTriggerMinutes !== undefined && <div className="bf-form-grid bf-form-grid--gas">
          <NumberField label="Bailout trigger at depth (min)" min={0} max={draft.bottomTimeMinutes} onChange={(bailoutTriggerMinutes) => set("bailoutTriggerMinutes", bailoutTriggerMinutes)} value={draft.bailoutTriggerMinutes} />
        </div>}
        <ToggleField
          checked={draft.diluentBailout}
          hint="The diluent is used when it is the richest breathable gas or the only one eligible; a dedicated bailout with the same mix is used first."
          label="Use diluent as bailout (dil-out)"
          onChange={(diluentBailout) => set("diluentBailout", diluentBailout)}
        />
        {draft.diluentBailout && <div className="bf-form-grid bf-form-grid--gas">
          <OptionalNumberField
            hint="Loop make-up, ADV, flushes, wing, and suit use before bailout. Required; enter 0 only if you mean it."
            label={`Diluent used before bailout (${surfaceGasUnit(preferences.cylinderCapacity)})`}
            min={0}
            onChange={(next) => set("diluentPreBailoutUseL", next === undefined ? undefined : surfaceGasInputToCanonical(next, preferences.cylinderCapacity, draft.diluentPreBailoutUseL === undefined ? [] : [draft.diluentPreBailoutUseL]))}
            step={surfaceGasInputStep(preferences.cylinderCapacity)}
            value={draft.diluentPreBailoutUseL === undefined ? undefined : surfaceGasInputValue(draft.diluentPreBailoutUseL, preferences.cylinderCapacity)}
          />
        </div>}
        <GasEditor gasOnly={gasOnly} onChange={(diluent) => set("diluent", diluent)} preferences={preferences} reserveKind={draft.reserve.kind} tanks={tanks} unavailable={unavailableByGas.get(draft.diluent.key)} value={draft.diluent} />
      </Panel>
      <Panel
        actions={<ActionButton onClick={() => addGas("bailoutGases", "bailout")} quiet>Add bailout gas</ActionButton>}
        title="Bailout gases"
      >
        {draft.bailoutGases.map((gas, index) => <GasEditor
          gasOnly={gasOnly}
          containerRef={gas.key === pendingGasKey ? pendingGasRef : undefined}
          key={gas.key}
          onChange={(next) => updateArray("bailoutGases", index, next)}
          onRemove={() => set("bailoutGases", draft.bailoutGases.filter((_, gasIndex) => gasIndex !== index))}
          preferences={preferences}
          reserveKind={draft.reserve.kind}
          switchable
          tanks={tanks}
          unavailable={unavailableByGas.get(gas.key)}
          value={gas}
        />)}
      </Panel>
    </>}
  </>;
}

type CompletionEvent = {
  readonly revision: number;
  readonly label: string;
  readonly description: string;
};

const AUTO_RECALCULATE_MS = 400;

const statusLabel: Record<WorkspaceStatus, string> = {
  draft: "Draft",
  updating: "Updating",
  current: "Current",
  "needs-attention": "Needs attention",
  "source-changed": "Source changed",
  "source-unavailable": "Source unavailable",
};

const statusDescription: Record<WorkspaceStatus, string> = {
  draft: "No calculation yet. Review the setup, then calculate once.",
  updating: "Inputs changed. Recalculating automatically; previous results are hidden.",
  current: "The calculated result matches every current input.",
  "needs-attention": "Current inputs could not produce a plan. Fix the diagnostics in Setup.",
  "source-changed": "A Tank Bank source or revision changed. Update explicitly before reviewing the plan.",
  "source-unavailable": "A selected Tank Bank cylinder cannot be used. Choose another cylinder or detach the gas in Setup; nothing is calculated until then.",
};

export default function PlanPage({
  draft,
  onDraftChange,
  preferences,
  tanks,
  plans,
  session,
  tankRevision,
  onSessionChange,
  onStorageChange,
}: {
  readonly draft: PlanDraft;
  readonly onDraftChange: (next: PlanDraft) => void;
  readonly preferences: UnitPreferences;
  readonly tanks?: TankBankStore;
  readonly plans?: SavedPlansStore;
  readonly session: PlanWorkspaceSession;
  readonly tankRevision: number;
  readonly onSessionChange: Dispatch<SetStateAction<PlanWorkspaceSession>>;
  readonly onStorageChange?: () => void;
}) {
  const [completion, setCompletion] = useState<CompletionEvent>();
  const [saveOpen, setSaveOpen] = useState(false);
  const completionRef = useRef<HTMLDivElement>(null);
  const tankBank = useMemo(() => {
    void tankRevision;
    return readTankBank(tanks);
  }, [tanks, tankRevision]);
  const resolved = useMemo(() => resolvePlanInput(draft, tankBank), [draft, tankBank]);
  // No input exists while a selected Tank Bank source is unavailable, so nothing can be calculated or match.
  const input = resolved.input;
  const inputSignature = input === undefined ? undefined : JSON.stringify(input);
  const sourceSignature = tankSourceSignature(draft, tankBank);
  const status = workspaceStatus({
    inputSignature,
    sourceSignature,
    calculated: session.calculated,
    attemptedInputSignature: session.attemptedInputSignature,
  });
  const calculatedIsCurrent = status === "current";
  const reviewAvailable = status === "current";
  const showCompletion = useCallback((label: string, description: string) => setCompletion((current) => ({
    revision: (current?.revision ?? 0) + 1,
    label,
    description,
  })), []);

  useEffect(() => {
    if (!completion || session.view !== "review") return;
    const frame = requestAnimationFrame(() => completionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }));
    return () => cancelAnimationFrame(frame);
  }, [completion, session.view]);

  const run = useCallback((switchToReview: boolean, announce: boolean) => {
    if (input === undefined || inputSignature === undefined) return;
    const result = calculateDivePlan(input);
    const diagnostics = result.ok
      ? [...result.warnings, ...(result.errors ?? [])]
      : [...result.warnings, ...result.errors];
    onSessionChange((current) => ({
      ...current,
      diagnostics,
      attemptedInputSignature: inputSignature,
      ...(result.ok ? {
        calculated: {
          input,
          plan: result.value,
          inputSignature,
          sourceSignature,
        },
        ...(switchToReview ? { view: "review" as const } : {}),
      } : {}),
    }));
    if (result.ok) {
      if (announce) showCompletion("Plan calculation complete", "Current inputs match the displayed result; review all diagnostics before saving.");
    }
  }, [input, inputSignature, onSessionChange, showCompletion, sourceSignature]);

  // A source that becomes unavailable supersedes the earlier result, even if it later returns unchanged.
  useEffect(() => {
    if (!resolved.ok) onSessionChange(invalidateForUnavailableSource);
  }, [onSessionChange, resolved.ok]);

  useEffect(() => {
    if (status !== "updating") return;
    const timer = window.setTimeout(() => run(false, false), AUTO_RECALCULATE_MS);
    return () => window.clearTimeout(timer);
  }, [run, status]);

  useEffect(() => {
    if (session.view !== "review" || reviewAvailable) return;
    onSessionChange((current) => current.view === "review" ? { ...current, view: "setup" } : current);
  }, [onSessionChange, reviewAvailable, session.view]);

  const selectView = (view: PlanWorkspaceView) => {
    if (view === "review" && !reviewAvailable) return;
    if (view === "setup") setCompletion(undefined);
    onSessionChange((current) => ({ ...current, view }));
  };

  const save = (title: string) => {
    if (!plans || !session.calculated || !calculatedIsCurrent) return;
    const result = plans.create({
      title,
      normalizedInputSnapshot: session.calculated.input,
      calculatedPlan: session.calculated.plan,
      warnings: session.calculated.plan.diagnostics,
    });
    if (!result.ok) onSessionChange((current) => ({
      ...current,
      diagnostics: [{ code: result.error.code, severity: "error", message: result.error.message }],
    }));
    else {
      setSaveOpen(false);
      showCompletion("Snapshot saved locally", `${title} is now available in Saved plans.`);
      onStorageChange?.();
    }
  };

  const setupAction = status === "draft" || (status === "needs-attention" && !session.calculated)
    ? <ActionButton onClick={() => run(true, true)}>Calculate plan</ActionButton>
    : status === "current"
      ? <ActionButton onClick={() => selectView("review")}>Review plan</ActionButton>
      : status === "source-changed"
        ? <ActionButton onClick={() => run(true, true)}>Update plan</ActionButton>
        : status === "updating"
          ? <ActionButton disabled>Updating plan…</ActionButton>
          : status === "source-unavailable"
            ? <ActionButton disabled>Resolve Tank Bank source</ActionButton>
            : <ActionButton disabled>Fix inputs</ActionButton>;
  const action = session.view === "review" && reviewAvailable
    ? <ActionButton onClick={() => selectView("setup")} quiet>Edit inputs</ActionButton>
    : setupAction;
  const summaryGas = resolved.gases[0]?.name ?? (draft.mode === "oc" ? draft.bottomGas.name : draft.diluent.name);
  const summary = `${draft.mode.toUpperCase()} · ${formatDepth(draft.depthM, preferences.depth)} · ${draft.bottomTimeMinutes} min · ${summaryGas} · GF ${draft.gfLowPercent}/${draft.gfHighPercent}`;

  return <>
    <PageHeader
      description="Build a deterministic square-profile OC or CCR plan (low and high setpoint) with explicit gas, equipment, consumption, and reserve assumptions."
      title="Plan"
    />
    <section aria-label="Current plan" className="bf-plan-context">
      <SegmentedControl
        label="Plan workspace"
        onChange={selectView}
        options={[
          { value: "setup", label: "Setup" },
          { value: "review", label: "Review", disabled: !reviewAvailable },
        ]}
        value={session.view}
      />
      <div className="bf-plan-context__summary">
        <span>Current plan</span>
        <strong>{summary}</strong>
        <small>{statusDescription[status]}</small>
      </div>
      <div className="bf-plan-context__actions">
        <span aria-atomic="true" aria-live="polite" className="bf-plan-status" data-state={status} role="status">
          <span aria-hidden="true" className="bf-plan-status__dot" />
          {statusLabel[status]}
        </span>
        {action}
      </div>
    </section>
    {session.view === "setup" ? <div className="bf-plan-setup">
      {status === "needs-attention" && <WarningList items={diagnosticItems(session.diagnostics)} title="Calculation diagnostics" />}
      <WarningList items={diagnosticItems(resolved.diagnostics)} title="Tank Bank sources unavailable" />
      <PlannerEditor draft={draft} onChange={onDraftChange} preferences={preferences} tankBank={tankBank} unavailableSources={resolved.unavailableSources} />
    </div> : calculatedIsCurrent && session.calculated ? <PlanResultView
      completion={completion ? <CompletionNotice containerRef={completionRef} description={completion.description} key={completion.revision} label={completion.label} /> : undefined}
      onSave={() => setSaveOpen(true)}
      plan={session.calculated.plan}
      preferences={preferences}
    /> : <Panel eyebrow={statusLabel[status]} title="Plan review unavailable">
      <p>{statusDescription[status]}</p>
    </Panel>}
    <SavePlanDialog
      defaultName={`${draft.mode.toUpperCase()} · ${Math.round(draft.depthM)} m · ${draft.bottomTimeMinutes} min`}
      onCancel={() => setSaveOpen(false)}
      onSave={save}
      open={saveOpen}
    />
  </>;
}
