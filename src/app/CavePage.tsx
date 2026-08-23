import { useEffect, useMemo, useRef, useState } from "react";
import {
  calculateCavePlan,
  type CavePlanInput,
  type CavePlanResult,
  type CaveScenarioKind,
  type CaveScenarioRequest,
  type Propulsion,
  type RouteLeg,
  type StageAction,
} from "../cave";
import type { Diagnostic } from "../domain/types";
import { barGauge, meters, seconds } from "../domain/units";
import type { SavedPlansStore, TankBankStore, TankRecord } from "../storage";
import {
  CompletionNotice,
  FieldGroup,
  PageHeader,
  Panel,
  ResultMetric,
  SavePlanDialog,
  SegmentedControl,
  WarningList,
  type WarningItem,
} from "../ui";
import { ActionButton, NumberField, SelectField } from "./controls";
import { collectCaveDiagnostics } from "./caveDiagnostics";
import {
  capacityInputValue,
  capacityUnit,
  depthFromCanonical,
  depthInputValue,
  depthToCanonical,
  depthUnit,
  formatDuration,
  formatPressure,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  pressureUnit,
  type UnitPreferences,
} from "./helpers";
import { PlannerEditor } from "./PlanPage";
import { PlanResultView } from "./PlanResultView";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput, type PlanDraft } from "./planning";

type RouteDraft = {
  readonly id: string;
  readonly startDepthM: number;
  readonly endDepthM: number;
  readonly durationMinutes: number;
  readonly distanceM: number;
  readonly propulsion: Propulsion;
  readonly accessibleCylinderIds?: readonly string[];
  readonly stageAction: StageAction;
  readonly stageCylinderId?: string;
};

type CaveLimitsDraft = {
  readonly turnPressureBar?: number;
  readonly turnTimeMinutes?: number;
  readonly maximumDistanceM?: number;
  readonly maximumTimeMinutes?: number;
  readonly scenarioTargetDistanceM?: number;
};

type CalculatedCave = {
  readonly input: CavePlanInput;
  readonly result: CavePlanResult;
  /** Includes cave-layer warnings/errors returned outside the base decompression plan. */
  readonly diagnostics: readonly Diagnostic[];
  readonly signature: string;
};

type CompletionEvent = {
  readonly revision: number;
  readonly label: string;
  readonly description: string;
};

const initialRoute: readonly RouteDraft[] = [{
  id: "route-1",
  startDepthM: 0,
  endDepthM: 18,
  durationMinutes: 5,
  distanceM: 60,
  propulsion: "fins",
  stageAction: "none",
}];

const scenarioKinds = (mode: PlanDraft["mode"]): readonly CaveScenarioKind[] => mode === "oc"
  ? ["oc-lost-gas", "lost-buddy", "scooter-failure", "stage-failure"]
  : ["ccr-loop-failure"];

const diagnosticsToItems = (items: readonly Diagnostic[]): readonly WarningItem[] => items.map((item, index) => ({
  id: `${item.code}-${index}`,
  message: item.field ? `${item.message} (${item.field})` : item.message,
  severity: item.severity,
}));

function listTanks(store?: TankBankStore): readonly TankRecord[] {
  const result = store?.list({ archived: false });
  return result?.ok ? result.value : [];
}

function RouteEditor({
  route,
  cylinders,
  preferences,
  onChange,
  onRemove,
}: {
  readonly route: RouteDraft;
  readonly cylinders: readonly { readonly id: string; readonly name: string }[];
  readonly preferences: UnitPreferences;
  readonly onChange: (next: RouteDraft) => void;
  readonly onRemove?: () => void;
}) {
  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) => onChange({ ...route, [key]: value });
  const accessible = route.accessibleCylinderIds ?? cylinders.map((cylinder) => cylinder.id);
  const toggleCylinder = (id: string, checked: boolean) => set(
    "accessibleCylinderIds",
    checked ? [...new Set([...accessible, id])] : accessible.filter((candidate) => candidate !== id),
  );
  return <article className="bf-route-editor">
    <header className="bf-row-header">
      <div><p className="bf-eyebrow">PENETRATION LEG</p><h3>{route.id}</h3></div>
      {onRemove && <ActionButton danger onClick={onRemove} quiet>Remove</ActionButton>}
    </header>
    <div className="bf-form-grid">
      <FieldGroup label="Leg label"><input aria-label="Leg label" onChange={(event) => set("id", event.currentTarget.value)} value={route.id} /></FieldGroup>
      <NumberField label={`Start depth (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("startDepthM", depthToCanonical(value, preferences.depth))} value={depthInputValue(route.startDepthM, preferences.depth)} />
      <NumberField label={`End depth (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("endDepthM", depthToCanonical(value, preferences.depth))} value={depthInputValue(route.endDepthM, preferences.depth)} />
      <NumberField label="Duration (min)" min={0.1} onChange={(durationMinutes) => set("durationMinutes", durationMinutes)} step={0.5} value={route.durationMinutes} />
      <NumberField label={`Distance (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("distanceM", depthToCanonical(value, preferences.depth))} value={depthInputValue(route.distanceM, preferences.depth)} />
      <SelectField<Propulsion>
        label="Propulsion"
        onChange={(propulsion) => set("propulsion", propulsion)}
        options={[{ value: "fins", label: "Fins" }, { value: "scooter", label: "Scooter" }, { value: "tow", label: "Tow" }]}
        value={route.propulsion}
      />
      <SelectField<StageAction>
        label="Stage action"
        onChange={(stageAction) => set("stageAction", stageAction)}
        options={[{ value: "none", label: "None" }, { value: "drop", label: "Drop" }, { value: "recover", label: "Recover" }]}
        value={route.stageAction}
      />
      {route.stageAction !== "none" && <FieldGroup label="Stage cylinder">
        <select aria-label="Stage cylinder" onChange={(event) => set("stageCylinderId", event.currentTarget.value || undefined)} value={route.stageCylinderId ?? ""}>
          <option value="">Select cylinder</option>
          {cylinders.map((cylinder) => <option key={cylinder.id} value={cylinder.id}>{cylinder.name}</option>)}
        </select>
      </FieldGroup>}
    </div>
    <FieldGroup label="Cylinders accessible on this leg" hint="A dropped stage must be absent after its drop point until a recovery leg.">
      <div className="bf-check-grid">
        {cylinders.map((cylinder) => <label className="bf-check" key={cylinder.id}>
          <input checked={accessible.includes(cylinder.id)} onChange={(event) => toggleCylinder(cylinder.id, event.currentTarget.checked)} type="checkbox" />
          <span>{cylinder.name}</span>
        </label>)}
      </div>
    </FieldGroup>
  </article>;
}

function scenarioLabel(kind: CaveScenarioKind): string {
  return {
    "oc-lost-gas": "Lost back gas",
    "lost-buddy": "Lost buddy",
    "scooter-failure": "Scooter failure",
    "stage-failure": "Stage failure",
    "ccr-loop-failure": "CCR loop failure",
  }[kind];
}

export default function CavePage({
  preferences,
  tanks,
  plans,
  onStorageChange,
}: {
  readonly preferences: UnitPreferences;
  readonly tanks?: TankBankStore;
  readonly plans?: SavedPlansStore;
  readonly onStorageChange?: () => void;
}) {
  const [draft, setDraft] = useState<PlanDraft>(() => {
    const initial = structuredClone(DEFAULT_PLAN_DRAFT);
    return {
      ...initial,
      depthM: 18,
      bottomTimeMinutes: 1,
      decoGases: initial.decoGases.map((gas) => ({
        ...gas,
        switchDepthM: Math.min(gas.switchDepthM ?? 18, 18),
      })),
    };
  });
  const [route, setRoute] = useState<readonly RouteDraft[]>(() => structuredClone(initialRoute));
  const [limits, setLimits] = useState<CaveLimitsDraft>({});
  const [enabledScenarios, setEnabledScenarios] = useState<readonly CaveScenarioKind[]>(scenarioKinds("oc"));
  const [targetLegId, setTargetLegId] = useState("route-1");
  const [calculated, setCalculated] = useState<CalculatedCave>();
  const [completion, setCompletion] = useState<CompletionEvent>();
  const [diagnostics, setDiagnostics] = useState<readonly Diagnostic[]>([]);
  const [selectedScenario, setSelectedScenario] = useState(0);
  const [saveOpen, setSaveOpen] = useState(false);
  const completionRef = useRef<HTMLDivElement>(null);
  const tankRecords = useMemo(() => listTanks(tanks), [tanks]);
  const resolved = useMemo(() => resolvePlanInput(draft, tankRecords, "cave"), [draft, tankRecords]);
  const cylinders = resolved.cylinders.map((cylinder) => ({ id: cylinder.id, name: cylinder.name }));

  const normalizedRoute: readonly RouteLeg[] = route.map((leg) => ({
    id: leg.id,
    startDepthM: meters(leg.startDepthM),
    endDepthM: meters(leg.endDepthM),
    durationSeconds: seconds(leg.durationMinutes * 60),
    distanceM: meters(leg.distanceM),
    propulsion: leg.propulsion,
    accessibleCylinderIds: leg.accessibleCylinderIds ?? cylinders.map((cylinder) => cylinder.id),
    ...(leg.stageAction === "none" ? {} : { stageAction: leg.stageAction }),
    ...(leg.stageAction !== "none" && leg.stageCylinderId ? { stageCylinderId: leg.stageCylinderId } : {}),
  }));
  const scenarios: readonly CaveScenarioRequest[] = enabledScenarios.map((kind) => ({
    kind,
    targetLegId: targetLegId || route.at(-1)?.id,
    ...(limits.scenarioTargetDistanceM === undefined ? {} : { targetDistanceM: meters(limits.scenarioTargetDistanceM) }),
  }));
  const input: CavePlanInput = {
    mode: draft.mode,
    dive: resolved.input,
    route: normalizedRoute,
    reserve: resolved.input.reservePolicy,
    scenarios,
    ...(limits.turnPressureBar === undefined ? {} : { turnPressureBar: barGauge(limits.turnPressureBar) }),
    ...(limits.turnTimeMinutes === undefined ? {} : { turnTimeSeconds: seconds(limits.turnTimeMinutes * 60) }),
    ...(limits.maximumDistanceM === undefined ? {} : { maximumPenetrationDistanceM: meters(limits.maximumDistanceM) }),
    ...(limits.maximumTimeMinutes === undefined ? {} : { maximumPenetrationTimeSeconds: seconds(limits.maximumTimeMinutes * 60) }),
  };
  const signature = JSON.stringify(input);
  const stale = Boolean(calculated && calculated.signature !== signature);
  const showCompletion = (label: string, description: string) => setCompletion((current) => ({
    revision: (current?.revision ?? 0) + 1,
    label,
    description,
  }));

  useEffect(() => {
    if (!calculated || !completion) return;
    const frame = requestAnimationFrame(() => completionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }));
    return () => cancelAnimationFrame(frame);
  }, [calculated, completion]);

  const updateRoute = (index: number, next: RouteDraft) => {
    const updated = [...route];
    updated[index] = next;
    setRoute(updated);
  };
  const addLeg = () => {
    const previous = route.at(-1);
    const id = `route-${route.length + 1}`;
    setRoute([...route, {
      id,
      startDepthM: previous?.endDepthM ?? 0,
      endDepthM: previous?.endDepthM ?? draft.depthM,
      durationMinutes: 5,
      distanceM: 75,
      propulsion: "fins",
      stageAction: "none",
    }]);
    setTargetLegId(id);
  };
  const changeMode = (next: PlanDraft) => {
    if (next.mode !== draft.mode) {
      setEnabledScenarios(scenarioKinds(next.mode));
      setSelectedScenario(0);
    }
    setDraft(next);
  };
  const run = () => {
    const result = calculateCavePlan(input);
    const calculationDiagnostics = result.ok
      ? [...result.warnings, ...(result.errors ?? [])]
      : [...result.warnings, ...result.errors];
    setDiagnostics(calculationDiagnostics);
    if (result.ok) {
      setCalculated({
        input,
        result: result.value,
        diagnostics: collectCaveDiagnostics(calculationDiagnostics, result.value),
        signature,
      });
      showCompletion("Cave calculation complete", "Current route and scenarios match the displayed result; review all safety diagnostics.");
    } else setCalculated(undefined);
  };
  const save = (title: string) => {
    if (!plans || !calculated || stale) return;
    const saved = plans.create({
      title,
      normalizedInputSnapshot: calculated.input.dive,
      calculatedPlan: calculated.result.base,
      caveInputSnapshot: calculated.input,
      caveResultSnapshot: calculated.result,
      // Cave safety diagnostics are intentionally outside the base decompression
      // plan, so snapshot them explicitly with the immutable cave result.
      warnings: calculated.diagnostics,
    });
    if (!saved.ok) setDiagnostics([{ code: saved.error.code, severity: "error", message: saved.error.message }]);
    else {
      setSaveOpen(false);
      showCompletion("Cave snapshot saved locally", `${title} is now available in Saved plans.`);
      onStorageChange?.();
    }
  };

  const scenarioResult = calculated?.result.scenarios[selectedScenario];
  const turnCylinder = calculated?.input.dive.cylinders.find(
    (cylinder) => cylinder.id === calculated.result.turnCylinderId,
  );
  const limitingCylinder = calculated?.input.dive.cylinders.find(
    (cylinder) => cylinder.id === calculated.result.limitingCylinderId,
  );
  const cylinderContext = (cylinder: typeof turnCylinder): string | undefined => cylinder
    ? `${cylinder.name} · ${capacityInputValue(
        cylinder.waterVolumeL,
        cylinder.workingPressureBar,
        preferences.cylinderCapacity,
      )} ${capacityUnit(preferences.cylinderCapacity)}`
    : undefined;
  const turnCylinderContext = cylinderContext(turnCylinder);
  const limitingCylinderContext = cylinderContext(limitingCylinder);
  return <>
    <PageHeader
      actions={<ActionButton onClick={run}>{stale ? "Update cave plan" : calculated ? "Recalculate cave plan" : "Calculate cave plan"}</ActionButton>}
      description="Build a real penetration and reverse-exit timeline, then test accessible-gas, propulsion, team, stage, and CCR loop failures."
      eyebrow="EXPERIMENTAL · QUALIFIED REVIEW REQUIRED"
      title="Cave"
    />
    <WarningList items={[{
      id: "cave-experimental",
      message: "Cave results remain experimental until reserve semantics and committed vectors receive qualified cave-diver review.",
      severity: "warning",
    }]} title="Cave planning status" />
    <PlannerEditor draft={draft} environment="cave" onChange={changeMode} preferences={preferences} showBottomTime={false} tanks={tankRecords} />
    <Panel actions={<ActionButton onClick={addLeg} quiet>Add route leg</ActionButton>} title="Penetration route">
      {route.map((leg, index) => <RouteEditor
        cylinders={cylinders}
        key={index}
        onChange={(next) => updateRoute(index, next)}
        onRemove={route.length > 1 ? () => setRoute(route.filter((_, routeIndex) => routeIndex !== index)) : undefined}
        preferences={preferences}
        route={leg}
      />)}
    </Panel>
    <Panel title="Turn limits and failure scenarios">
      <div className="bf-form-grid">
        <NumberField
          hint="Leave at 0 to use the gas-derived minimum."
          label={`Entered turn pressure (${pressureUnit(preferences.pressure)})`}
          min={0}
          onChange={(value) => setLimits({ ...limits, turnPressureBar: value > 0 ? pressureInputToCanonical(value, preferences.pressure, limits.turnPressureBar === undefined ? [] : [limits.turnPressureBar]) : undefined })}
          step={pressureInputStep(preferences.pressure)}
          value={limits.turnPressureBar === undefined ? 0 : pressureInputValue(limits.turnPressureBar, preferences.pressure)}
        />
        <NumberField label="Entered turn time (min; 0 = calculated)" min={0} onChange={(value) => setLimits({ ...limits, turnTimeMinutes: value > 0 ? value : undefined })} value={limits.turnTimeMinutes ?? 0} />
        <NumberField label={`Maximum penetration distance (${depthUnit(preferences.depth)}; 0 = gas-derived)`} min={0} onChange={(value) => setLimits({ ...limits, maximumDistanceM: value > 0 ? depthToCanonical(value, preferences.depth) : undefined })} value={limits.maximumDistanceM === undefined ? 0 : depthInputValue(limits.maximumDistanceM, preferences.depth)} />
        <NumberField label="Maximum penetration time (min; 0 = gas-derived)" min={0} onChange={(value) => setLimits({ ...limits, maximumTimeMinutes: value > 0 ? value : undefined })} value={limits.maximumTimeMinutes ?? 0} />
        <FieldGroup label="Scenario trigger leg">
          <select aria-label="Scenario trigger leg" onChange={(event) => setTargetLegId(event.currentTarget.value)} value={targetLegId}>
            {route.map((leg) => <option key={leg.id} value={leg.id}>{leg.id}</option>)}
          </select>
        </FieldGroup>
        <NumberField label={`Scenario trigger distance (${depthUnit(preferences.depth)}; 0 = end of leg)`} min={0} onChange={(value) => setLimits({ ...limits, scenarioTargetDistanceM: value > 0 ? depthToCanonical(value, preferences.depth) : undefined })} value={limits.scenarioTargetDistanceM === undefined ? 0 : depthInputValue(limits.scenarioTargetDistanceM, preferences.depth)} />
      </div>
      <FieldGroup label="Scenarios to calculate">
        <div className="bf-check-grid">
          {scenarioKinds(draft.mode).map((kind) => <label className="bf-check" key={kind}>
            <input
              checked={enabledScenarios.includes(kind)}
              onChange={(event) => setEnabledScenarios(event.currentTarget.checked ? [...enabledScenarios, kind] : enabledScenarios.filter((candidate) => candidate !== kind))}
              type="checkbox"
            />
            <span>{scenarioLabel(kind)}</span>
          </label>)}
        </div>
      </FieldGroup>
    </Panel>
    {!stale && <WarningList items={diagnosticsToItems(diagnostics)} title="Cave calculation diagnostics" />}
    {stale && <Panel
      actions={<ActionButton onClick={run}>Update now</ActionButton>}
      eyebrow="Inputs changed"
      title="Previous cave results hidden"
    >
      <p>The route, scenario, or planning inputs no longer match the previous calculation. Update explicitly to review or save current cave results.</p>
    </Panel>}
    {calculated && !stale && <>
      {completion && <CompletionNotice containerRef={completionRef} description={completion.description} key={completion.revision} label={completion.label} />}
      <Panel
        actions={<ActionButton onClick={() => setSaveOpen(true)}>Save cave snapshot</ActionButton>}
        eyebrow="Calculated route and scenarios"
        title="Cave summary"
      >
        <div className="bf-metric-grid">
          <ResultMetric label="Penetration distance" value={`${depthFromCanonical(calculated.result.route.penetrationDistanceM, preferences.depth).toFixed(0)} ${depthUnit(preferences.depth)}`} />
          <ResultMetric label="Penetration time" value={formatDuration(calculated.result.route.penetrationTimeSeconds)} />
          <ResultMetric label="Total runtime" value={formatDuration(calculated.result.route.runtimeSeconds)} />
          <ResultMetric detail={limitingCylinderContext} label="Limiting resource" tone={calculated.result.limitingResource === "none" ? "safe" : "warning"} value={calculated.result.limitingResource} />
          <ResultMetric detail={limitingCylinderContext} label="Reserve margin" tone={calculated.result.reserveMarginL >= 0 ? "safe" : "danger"} value={`${Math.round(calculated.result.reserveMarginL)} L`} />
          {calculated.result.turnPressureBar !== undefined && <ResultMetric
            detail={turnCylinderContext ?? "No unique cylinder assignment; pressure hidden."}
            label="Operational turn pressure"
            tone={turnCylinder ? "default" : "warning"}
            value={turnCylinder
              ? formatPressure(calculated.result.turnPressureBar, preferences.pressure)
              : "Unavailable"}
          />}
          {calculated.result.minimumRequiredAtTurnPressureBar !== undefined && <ResultMetric
            detail={turnCylinderContext ?? "No unique cylinder assignment; pressure hidden."}
            label="Minimum required at planned turn"
            tone={turnCylinder ? "default" : "warning"}
            value={turnCylinder
              ? formatPressure(calculated.result.minimumRequiredAtTurnPressureBar, preferences.pressure)
              : "Unavailable"}
          />}
          {calculated.result.turnTimeSeconds !== undefined && <ResultMetric label="Maximum turn time" value={formatDuration(calculated.result.turnTimeSeconds)} />}
          {calculated.result.maximumPermittedPenetrationDistanceM !== undefined && <ResultMetric
            label="Maximum penetration distance"
            value={`${depthFromCanonical(calculated.result.maximumPermittedPenetrationDistanceM, preferences.depth).toFixed(0)} ${depthUnit(preferences.depth)}`}
          />}
        </div>
      </Panel>
      <Panel title="Failure scenarios">
        <SegmentedControl
          label="Scenario result"
          onChange={(value) => setSelectedScenario(Number(value))}
          options={calculated.result.scenarios.map((scenario, index) => ({ value: String(index), label: scenarioLabel(scenario.kind) }))}
          value={String(Math.min(selectedScenario, Math.max(0, calculated.result.scenarios.length - 1)))}
        />
        {scenarioResult ? <div className="bf-scenario-summary">
          <ResultMetric label="Scenario status" tone={scenarioResult.safe ? "safe" : "danger"} value={scenarioResult.safe ? "Calculated sufficient" : "Unsafe or unavailable"} />
          <WarningList items={diagnosticsToItems(scenarioResult.diagnostics)} title={`${scenarioLabel(scenarioResult.kind)} diagnostics`} />
        </div> : <p>No failure scenarios selected.</p>}
      </Panel>
      <PlanResultView plan={calculated.result.base} preferences={preferences} title="Base cave plan" />
      {scenarioResult?.plan && <PlanResultView plan={scenarioResult.plan} preferences={preferences} title={`${scenarioLabel(scenarioResult.kind)} plan`} />}
    </>}
    <SavePlanDialog defaultName={`${draft.mode.toUpperCase()} cave · ${route.length} leg${route.length === 1 ? "" : "s"}`} onCancel={() => setSaveOpen(false)} onSave={save} open={saveOpen} />
  </>;
}
