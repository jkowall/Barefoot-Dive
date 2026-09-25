import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type Ref,
  type SetStateAction,
} from "react";
import {
  calculateCavePlan,
  type CavePlanInput,
  type CaveScenarioKind,
  type CaveScenarioRequest,
  type Propulsion,
  type RouteLeg,
  type StageAction,
} from "../cave";
import type { Diagnostic } from "../domain/types";
import { barGauge, meters, seconds } from "../domain/units";
import type { SavedPlansStore, TankBankStore } from "../storage";
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
  caveScenarioKinds,
  type CaveLimitsDraft,
  type CaveWorkspaceSession,
  type CaveWorkspaceView,
  type RouteDraft,
} from "./caveWorkspace";
import {
  capacityInputValue,
  capacityUnit,
  depthFromCanonical,
  depthInputValue,
  depthToCanonical,
  depthUnit,
  formatDuration,
  formatPressure,
  formatSurfaceGas,
  pressureInputStep,
  pressureInputToCanonical,
  pressureInputValue,
  pressureUnit,
  type UnitPreferences,
} from "./helpers";
import { PlannerEditor, readTankBank } from "./PlanPage";
import { PlanResultView } from "./PlanResultView";
import { resolvePlanInput, tankSourceSignature, type PlanDraft } from "./planning";

type CompletionEvent = {
  readonly revision: number;
  readonly label: string;
  readonly description: string;
};

const diagnosticsToItems = (items: readonly Diagnostic[]): readonly WarningItem[] => items.map((item, index) => ({
  id: `${item.code}-${index}`,
  message: item.field ? `${item.message} (${item.field})` : item.message,
  severity: item.severity,
}));

function RouteEditor({
  containerRef,
  route,
  cylinders,
  preferences,
  onChange,
  onRemove,
}: {
  readonly containerRef?: Ref<HTMLElement>;
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
  return <article className="bf-route-editor" ref={containerRef}>
    <header className="bf-row-header">
      <div><p className="bf-eyebrow">PENETRATION LEG</p><h3>{route.id}</h3></div>
      {onRemove && <ActionButton danger onClick={onRemove} quiet small>Remove</ActionButton>}
    </header>
    <div className="bf-form-grid bf-form-grid--route">
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

type CaveWorkspaceStatus = "draft" | "updating" | "current" | "needs-attention" | "source-changed" | "source-unavailable";

const AUTO_RECALCULATE_MS = 400;

const statusLabel: Record<CaveWorkspaceStatus, string> = {
  draft: "Draft",
  updating: "Updating",
  current: "Current",
  "needs-attention": "Needs attention",
  "source-changed": "Source changed",
  "source-unavailable": "Source unavailable",
};

const statusDescription: Record<CaveWorkspaceStatus, string> = {
  draft: "No cave calculation yet. Review route, gas access, and scenarios, then calculate once.",
  updating: "Inputs changed. Recalculating automatically; previous cave results are hidden.",
  current: "The result matches every current route, scenario, gas, and limit input.",
  "needs-attention": "Current cave inputs could not produce a result. Fix the diagnostics in Setup.",
  "source-changed": "A Tank Bank source or revision changed. Update explicitly before reviewing the cave plan.",
  "source-unavailable": "A selected Tank Bank cylinder cannot be used. Choose another cylinder or detach the gas in Setup; the cave plan is not calculated until then.",
};

export default function CavePage({
  preferences,
  tanks,
  plans,
  session,
  tankRevision,
  onSessionChange,
  onStorageChange,
}: {
  readonly preferences: UnitPreferences;
  readonly tanks?: TankBankStore;
  readonly plans?: SavedPlansStore;
  readonly session: CaveWorkspaceSession;
  readonly tankRevision: number;
  readonly onSessionChange: Dispatch<SetStateAction<CaveWorkspaceSession>>;
  readonly onStorageChange?: () => void;
}) {
  const {
    draft,
    route,
    limits,
    enabledScenarios,
    targetLegId,
    calculated,
    diagnostics,
    selectedScenario,
    pendingRouteId,
  } = session;
  const [completion, setCompletion] = useState<CompletionEvent>();
  const [saveOpen, setSaveOpen] = useState(false);
  const completionRef = useRef<HTMLDivElement>(null);
  const pendingRouteRef = useRef<HTMLElement>(null);
  const tankBank = useMemo(() => {
    void tankRevision;
    return readTankBank(tanks);
  }, [tanks, tankRevision]);
  const resolved = useMemo(() => resolvePlanInput(draft, tankBank, "cave"), [draft, tankBank]);
  const cylinders = useMemo(
    () => resolved.cylinders.map((cylinder) => ({ id: cylinder.id, name: cylinder.name })),
    [resolved.cylinders],
  );
  const normalizedRoute = useMemo<readonly RouteLeg[]>(() => route.map((leg) => ({
    id: leg.id,
    startDepthM: meters(leg.startDepthM),
    endDepthM: meters(leg.endDepthM),
    durationSeconds: seconds(leg.durationMinutes * 60),
    distanceM: meters(leg.distanceM),
    propulsion: leg.propulsion,
    accessibleCylinderIds: leg.accessibleCylinderIds ?? cylinders.map((cylinder) => cylinder.id),
    ...(leg.stageAction === "none" ? {} : { stageAction: leg.stageAction }),
    ...(leg.stageAction !== "none" && leg.stageCylinderId ? { stageCylinderId: leg.stageCylinderId } : {}),
  })), [cylinders, route]);
  const scenarios = useMemo<readonly CaveScenarioRequest[]>(() => enabledScenarios.map((kind) => ({
    kind,
    targetLegId: targetLegId || route.at(-1)?.id,
    ...(limits.scenarioTargetDistanceM === undefined ? {} : { targetDistanceM: meters(limits.scenarioTargetDistanceM) }),
  })), [enabledScenarios, limits.scenarioTargetDistanceM, route, targetLegId]);
  // No dive input exists while a selected Tank Bank source is unavailable, so there is no cave input to calculate or match.
  const dive = resolved.input;
  const input = useMemo<CavePlanInput | undefined>(() => dive && {
    mode: draft.mode,
    dive,
    route: normalizedRoute,
    reserve: dive.reservePolicy,
    scenarios,
    ...(limits.turnPressureBar === undefined ? {} : { turnPressureBar: barGauge(limits.turnPressureBar) }),
    ...(limits.turnTimeMinutes === undefined ? {} : { turnTimeSeconds: seconds(limits.turnTimeMinutes * 60) }),
    ...(limits.maximumDistanceM === undefined ? {} : { maximumPenetrationDistanceM: meters(limits.maximumDistanceM) }),
    ...(limits.maximumTimeMinutes === undefined ? {} : { maximumPenetrationTimeSeconds: seconds(limits.maximumTimeMinutes * 60) }),
  }, [dive, draft.mode, limits, normalizedRoute, scenarios]);
  const inputSignature = input === undefined ? undefined : JSON.stringify(input);
  const sourceSignature = tankSourceSignature(draft, tankBank, "cave");
  const calculatedIsCurrent = inputSignature !== undefined && calculated?.inputSignature === inputSignature;
  const attemptedCurrentInput = inputSignature !== undefined && session.attemptedInputSignature === inputSignature;
  const sourceChanged = Boolean(
    calculated
    && calculated.sourceSignature !== sourceSignature
    && !calculatedIsCurrent,
  );
  const status: CaveWorkspaceStatus = !resolved.ok
    ? "source-unavailable"
    : calculatedIsCurrent
      ? "current"
      : attemptedCurrentInput
        ? "needs-attention"
        : sourceChanged
          ? "source-changed"
          : calculated
            ? "updating"
            : "draft";
  const reviewAvailable = status === "current";
  const showCompletion = useCallback((label: string, description: string) => setCompletion((current) => ({
    revision: (current?.revision ?? 0) + 1,
    label,
    description,
  })), []);

  const run = useCallback((switchToReview: boolean, announce: boolean) => {
    if (input === undefined || inputSignature === undefined) return;
    const result = calculateCavePlan(input);
    const calculationDiagnostics = result.ok
      ? [...result.warnings, ...(result.errors ?? [])]
      : [...result.warnings, ...result.errors];
    const aggregateDiagnostics = result.ok
      ? collectCaveDiagnostics(calculationDiagnostics, result.value)
      : calculationDiagnostics;
    onSessionChange((current) => ({
      ...current,
      diagnostics: calculationDiagnostics,
      attemptedInputSignature: inputSignature,
      ...(result.ok ? {
        calculated: {
          input,
          result: result.value,
          diagnostics: aggregateDiagnostics,
          inputSignature,
          sourceSignature,
        },
        ...(switchToReview ? { view: "review" as const } : {}),
      } : {}),
    }));
    if (result.ok && announce) {
      const containsSafetyErrors = result.value.base.safetyStatus === "unsafe"
        || result.value.scenarios.some((scenario) => !scenario.safe)
        || aggregateDiagnostics.some((item) => item.severity === "error");
      showCompletion(
        containsSafetyErrors ? "Cave calculation contains safety errors" : "Cave calculation complete",
        containsSafetyErrors
          ? "One or more enabled results is unsafe or unavailable. Review the aggregate diagnostics before saving or using this snapshot."
          : "Current route and scenarios match the displayed result; review all safety diagnostics.",
      );
    }
  }, [input, inputSignature, onSessionChange, showCompletion, sourceSignature]);

  useEffect(() => {
    if (!calculated || !completion || session.view !== "review") return;
    const frame = requestAnimationFrame(() => completionRef.current?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    }));
    return () => cancelAnimationFrame(frame);
  }, [calculated, completion, session.view]);

  useEffect(() => {
    if (!pendingRouteId) return;
    if (!route.some((leg) => leg.id === pendingRouteId)) {
      onSessionChange((current) => current.pendingRouteId === pendingRouteId
        ? { ...current, pendingRouteId: undefined }
        : current);
      return;
    }
    const target = pendingRouteRef.current;
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        block: "start",
      });
      onSessionChange((current) => current.pendingRouteId === pendingRouteId
        ? { ...current, pendingRouteId: undefined }
        : current);
    });
    return () => cancelAnimationFrame(frame);
  }, [onSessionChange, pendingRouteId, route]);

  useEffect(() => {
    if (status !== "updating") return;
    const timer = window.setTimeout(() => run(false, false), AUTO_RECALCULATE_MS);
    return () => window.clearTimeout(timer);
  }, [run, status]);

  useEffect(() => {
    if (session.view !== "review" || reviewAvailable) return;
    onSessionChange((current) => current.view === "review" ? { ...current, view: "setup" } : current);
  }, [onSessionChange, reviewAvailable, session.view]);

  const updateRoute = (index: number, next: RouteDraft) => {
    onSessionChange((current) => {
      const updated = [...current.route];
      const previousId = updated[index]?.id;
      updated[index] = next;
      return {
        ...current,
        route: updated,
        targetLegId: current.targetLegId === previousId ? next.id : current.targetLegId,
        pendingRouteId: current.pendingRouteId === previousId ? next.id : current.pendingRouteId,
      };
    });
  };
  const removeRoute = (index: number) => {
    onSessionChange((current) => {
      const removedId = current.route[index]?.id;
      const updated = current.route.filter((_, routeIndex) => routeIndex !== index);
      return {
        ...current,
        route: updated,
        targetLegId: current.targetLegId === removedId ? updated.at(-1)?.id ?? "" : current.targetLegId,
        pendingRouteId: current.pendingRouteId === removedId ? undefined : current.pendingRouteId,
      };
    });
  };
  const addLeg = () => {
    onSessionChange((current) => {
      const existingIds = new Set(current.route.map((leg) => leg.id));
      let nextNumber = current.route.length + 1;
      while (existingIds.has(`route-${nextNumber}`)) nextNumber += 1;
      const previous = current.route.at(-1);
      const id = `route-${nextNumber}`;
      return {
        ...current,
        route: [...current.route, {
          id,
          startDepthM: previous?.endDepthM ?? 0,
          endDepthM: previous?.endDepthM ?? current.draft.depthM,
          durationMinutes: 5,
          distanceM: 75,
          propulsion: "fins",
          stageAction: "none",
        }],
        targetLegId: id,
        pendingRouteId: id,
      };
    });
  };
  const changeMode = (next: PlanDraft) => {
    onSessionChange((current) => next.mode === current.draft.mode
      ? { ...current, draft: next }
      : {
          ...current,
          draft: next,
          enabledScenarios: caveScenarioKinds(next.mode),
          selectedScenario: 0,
        });
  };
  const changeLimits = (next: CaveLimitsDraft) => {
    onSessionChange((current) => ({ ...current, limits: next }));
  };
  const changeTargetLeg = (target: string) => {
    onSessionChange((current) => ({ ...current, targetLegId: target }));
  };
  const changeScenarios = (next: readonly CaveScenarioKind[]) => {
    onSessionChange((current) => ({ ...current, enabledScenarios: next }));
  };
  const selectScenario = (index: number) => {
    onSessionChange((current) => ({ ...current, selectedScenario: index }));
  };
  const selectView = (view: CaveWorkspaceView) => {
    if (view === "review" && !reviewAvailable) return;
    if (view === "setup") setCompletion(undefined);
    onSessionChange((current) => ({ ...current, view }));
  };
  const save = (title: string) => {
    if (!plans || !calculated || !calculatedIsCurrent) return;
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
    if (!saved.ok) onSessionChange((current) => ({
      ...current,
      diagnostics: [{ code: saved.error.code, severity: "error", message: saved.error.message }],
    }));
    else {
      setSaveOpen(false);
      showCompletion("Cave snapshot saved locally", `${title} is now available in Saved plans.`);
      onStorageChange?.();
    }
  };

  const selectedScenarioIndex = Math.min(selectedScenario, Math.max(0, (calculated?.result.scenarios.length ?? 0) - 1));
  const scenarioResult = calculated?.result.scenarios[selectedScenarioIndex];
  const aggregateCaveDiagnostics = calculated?.diagnostics ?? diagnostics;
  const aggregateCaveUnsafe = Boolean(calculated && (
    calculated.result.base.safetyStatus === "unsafe"
    || calculated.result.scenarios.some((scenario) => !scenario.safe)
    || aggregateCaveDiagnostics.some((item) => item.severity === "error")
  ));
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
  const routeDistance = route.reduce((total, leg) => total + leg.distanceM, 0);
  const routeMinutes = route.reduce((total, leg) => total + leg.durationMinutes, 0);
  const summary = `${draft.mode.toUpperCase()} · ${route.length} leg${route.length === 1 ? "" : "s"} · ${Math.round(depthFromCanonical(routeDistance, preferences.depth))} ${depthUnit(preferences.depth)} · ${routeMinutes} min · ${enabledScenarios.length} scenario${enabledScenarios.length === 1 ? "" : "s"} · GF ${draft.gfLowPercent}/${draft.gfHighPercent}`;
  const setupAction = status === "draft" || (status === "needs-attention" && !calculated)
    ? <ActionButton onClick={() => run(true, true)}>Calculate cave plan</ActionButton>
    : status === "current"
      ? <ActionButton onClick={() => selectView("review")}>Review cave plan</ActionButton>
      : status === "source-changed"
        ? <ActionButton onClick={() => run(true, true)}>Update cave plan</ActionButton>
        : status === "updating"
          ? <ActionButton disabled>Updating cave plan…</ActionButton>
          : status === "source-unavailable"
            ? <ActionButton disabled>Resolve Tank Bank source</ActionButton>
            : <ActionButton disabled>Fix inputs</ActionButton>;
  const action = session.view === "review" && reviewAvailable
    ? <ActionButton onClick={() => selectView("setup")} quiet>Edit inputs</ActionButton>
    : setupAction;
  const caveStatusWarning = <WarningList items={[{
    id: "cave-experimental",
    message: "Cave results remain experimental until reserve semantics and committed vectors receive qualified cave-diver review.",
    severity: "warning",
  }]} title="Cave planning status" />;
  return <>
    <PageHeader
      description="Build a real penetration and reverse-exit timeline, then test accessible-gas, propulsion, team, stage, and CCR loop failures."
      eyebrow="EXPERIMENTAL · QUALIFIED REVIEW REQUIRED"
      title="Cave"
      tone="warning"
    />
    <section aria-label="Current experimental cave plan" className="bf-plan-context">
      <SegmentedControl
        label="Cave workspace"
        onChange={selectView}
        options={[
          { value: "setup", label: "Setup" },
          { value: "review", label: "Review", disabled: !reviewAvailable },
        ]}
        value={session.view}
      />
      <div className="bf-plan-context__summary">
        <span>Experimental cave plan</span>
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
      {caveStatusWarning}
      {status === "needs-attention" && <WarningList items={diagnosticsToItems(diagnostics)} title="Cave calculation diagnostics" />}
      <WarningList items={diagnosticsToItems(resolved.diagnostics)} title="Tank Bank sources unavailable" />
      <PlannerEditor draft={draft} environment="cave" onChange={changeMode} preferences={preferences} showBottomTime={false} tankBank={tankBank} unavailableSources={resolved.unavailableSources} />
      <Panel actions={<ActionButton onClick={addLeg} quiet>Add route leg</ActionButton>} title="Penetration route">
        {route.map((leg, index) => <RouteEditor
          containerRef={leg.id === pendingRouteId ? pendingRouteRef : undefined}
          cylinders={cylinders}
          key={leg.id}
          onChange={(next) => updateRoute(index, next)}
          onRemove={route.length > 1 ? () => removeRoute(index) : undefined}
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
            onChange={(value) => changeLimits({ ...limits, turnPressureBar: value > 0 ? pressureInputToCanonical(value, preferences.pressure, limits.turnPressureBar === undefined ? [] : [limits.turnPressureBar]) : undefined })}
            step={pressureInputStep(preferences.pressure)}
            value={limits.turnPressureBar === undefined ? 0 : pressureInputValue(limits.turnPressureBar, preferences.pressure)}
          />
          <NumberField label="Entered turn time (min; 0 = calculated)" min={0} onChange={(value) => changeLimits({ ...limits, turnTimeMinutes: value > 0 ? value : undefined })} value={limits.turnTimeMinutes ?? 0} />
          <NumberField label={`Maximum penetration distance (${depthUnit(preferences.depth)}; 0 = gas-derived)`} min={0} onChange={(value) => changeLimits({ ...limits, maximumDistanceM: value > 0 ? depthToCanonical(value, preferences.depth) : undefined })} value={limits.maximumDistanceM === undefined ? 0 : depthInputValue(limits.maximumDistanceM, preferences.depth)} />
          <NumberField label="Maximum penetration time (min; 0 = gas-derived)" min={0} onChange={(value) => changeLimits({ ...limits, maximumTimeMinutes: value > 0 ? value : undefined })} value={limits.maximumTimeMinutes ?? 0} />
          <FieldGroup label="Scenario trigger leg">
            <select aria-label="Scenario trigger leg" onChange={(event) => changeTargetLeg(event.currentTarget.value)} value={targetLegId}>
              {route.map((leg) => <option key={leg.id} value={leg.id}>{leg.id}</option>)}
            </select>
          </FieldGroup>
          <NumberField label={`Scenario trigger distance (${depthUnit(preferences.depth)}; 0 = end of leg)`} min={0} onChange={(value) => changeLimits({ ...limits, scenarioTargetDistanceM: value > 0 ? depthToCanonical(value, preferences.depth) : undefined })} value={limits.scenarioTargetDistanceM === undefined ? 0 : depthInputValue(limits.scenarioTargetDistanceM, preferences.depth)} />
        </div>
        <FieldGroup label="Scenarios to calculate">
          <div className="bf-check-grid">
            {caveScenarioKinds(draft.mode).map((kind) => <label className="bf-check" key={kind}>
              <input
                checked={enabledScenarios.includes(kind)}
                onChange={(event) => changeScenarios(event.currentTarget.checked ? [...enabledScenarios, kind] : enabledScenarios.filter((candidate) => candidate !== kind))}
                type="checkbox"
              />
              <span>{scenarioLabel(kind)}</span>
            </label>)}
          </div>
        </FieldGroup>
      </Panel>
    </div> : calculatedIsCurrent && calculated ? <section aria-label="Calculated cave plan" className="bf-results">
      {completion && <CompletionNotice containerRef={completionRef} description={completion.description} key={completion.revision} label={completion.label} />}
      <Panel
        actions={<ActionButton onClick={() => setSaveOpen(true)}>Save cave snapshot</ActionButton>}
        eyebrow={`Experimental · ${aggregateCaveUnsafe ? "safety errors present" : "calculated route and scenarios"}`}
        title="Cave summary"
      >
        <div className="bf-metric-grid">
          <ResultMetric
            detail={aggregateCaveUnsafe
              ? "At least one enabled result has a safety error; review the aggregate diagnostics."
              : "Calculation status only; not a safety or field-validation claim."}
            kind="text"
            label="Aggregate cave status"
            tone={aggregateCaveUnsafe ? "danger" : "safe"}
            value={aggregateCaveUnsafe ? "Unsafe or unavailable" : "No calculation errors"}
          />
          <ResultMetric label="Penetration distance" value={`${depthFromCanonical(calculated.result.route.penetrationDistanceM, preferences.depth).toFixed(0)} ${depthUnit(preferences.depth)}`} />
          <ResultMetric label="Penetration time" value={formatDuration(calculated.result.route.penetrationTimeSeconds)} />
          <ResultMetric label="Total runtime" value={formatDuration(calculated.result.route.runtimeSeconds)} />
          <ResultMetric detail={limitingCylinderContext} kind="text" label="Limiting resource" tone={calculated.result.limitingResource === "none" ? "safe" : "warning"} value={calculated.result.limitingResource} />
          <ResultMetric detail={limitingCylinderContext} label="Reserve margin" tone={calculated.result.reserveMarginL >= 0 ? "safe" : "danger"} value={formatSurfaceGas(calculated.result.reserveMarginL, preferences.cylinderCapacity)} />
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
      <WarningList items={diagnosticsToItems(aggregateCaveDiagnostics)} title="Aggregate cave diagnostics" />
      <Panel title="Failure scenarios">
        <SegmentedControl
          label="Scenario result"
          onChange={(value) => selectScenario(Number(value))}
          options={calculated.result.scenarios.map((scenario, index) => ({ value: String(index), label: scenarioLabel(scenario.kind) }))}
          value={String(selectedScenarioIndex)}
        />
        {scenarioResult ? <div className="bf-scenario-summary">
          <ResultMetric kind="text" label="Scenario status" tone={scenarioResult.safe ? "safe" : "danger"} value={scenarioResult.safe ? "Calculated sufficient" : "Unsafe or unavailable"} />
          <WarningList items={diagnosticsToItems(scenarioResult.diagnostics)} title={`${scenarioLabel(scenarioResult.kind)} diagnostics`} />
        </div> : <p>No failure scenarios selected.</p>}
      </Panel>
      <PlanResultView compact plan={calculated.result.base} preferences={preferences} title="Base cave plan" />
      {scenarioResult?.plan && <PlanResultView compact plan={scenarioResult.plan} preferences={preferences} title={`${scenarioLabel(scenarioResult.kind)} plan`} />}
    </section> : <Panel eyebrow={statusLabel[status]} title="Cave review unavailable">
      <p>{statusDescription[status]}</p>
    </Panel>}
    <SavePlanDialog defaultName={`${draft.mode.toUpperCase()} cave · ${route.length} leg${route.length === 1 ? "" : "s"}`} onCancel={() => setSaveOpen(false)} onSave={save} open={saveOpen} />
  </>;
}
