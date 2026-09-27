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
import { ActionButton, DepthField, NumberField, SelectField } from "./controls";
import { CaveAccessTable } from "./CaveAccessTable";
import { CaveRouteTimeline } from "./CaveRouteTimeline";
import { collectCaveDiagnostics, formatCaveCeilingViolation } from "./caveDiagnostics";
import { buildCaveTimeline } from "./caveTimeline";
import { formatDiagnostic } from "./diagnosticText";
import {
  normalizeCaveRoute,
  routeCylinderAccess,
  routeCylinders,
  routeStageCylinder,
  unsetGasNotices,
  unsetRouteCylinders,
  withCylinderAccess,
  withStageCylinder,
  withUnsetGasesKept,
  type RouteCylinder,
} from "./caveRoute";
import {
  caveScenarioKinds,
  type CaveLimitsDraft,
  type CaveWorkspaceSession,
  type CaveWorkspaceView,
  type RouteDraft,
} from "./caveWorkspace";
import {
  buildScenarioRequests,
  initialScenarioTriggers,
  isScenarioDistanceValid,
  repairScenarioTriggers,
  scenarioApplicability,
  scenarioLabel,
  scenarioModelLine,
  scenarioTriggerPoint,
  type CaveScenarioTrigger,
} from "./caveScenarios";
import {
  capacityInputValue,
  capacityUnit,
  depthFromCanonical,
  depthUnit,
  formatDepthBound,
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
import { invalidateForUnavailableSource, workspaceStatus, type WorkspaceStatus } from "./workspaceStatus";

type CompletionEvent = {
  readonly revision: number;
  readonly label: string;
  readonly description: string;
};

const diagnosticsToItems = (
  items: readonly Diagnostic[],
  units: UnitPreferences["depth"],
  ceilingContext?: Parameters<typeof formatCaveCeilingViolation>[1],
): readonly WarningItem[] => items.map((item, index) => {
  const message = ceilingContext
    ? formatCaveCeilingViolation(item, ceilingContext) ?? formatDiagnostic(item, units)
    : formatDiagnostic(item, units);
  return {
    id: `${item.code}-${index}`,
    message: ceilingContext && item.code === "EXPOSURE_CEILING_VIOLATION"
      ? message
      : item.field ? `${message} (${item.field})` : message,
    severity: item.severity,
  };
});

const enteredLimitLabel = (
  shown: number | undefined,
  entered: readonly (number | undefined)[],
): string => shown !== undefined && entered.some((value) => value !== undefined && Math.abs(value - shown) <= 1e-6)
  ? "Entered limit"
  : "Gas-derived: every leg scaled together; failure scenarios not rechecked";

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
  readonly cylinders: readonly RouteCylinder[];
  readonly preferences: UnitPreferences;
  readonly onChange: (next: RouteDraft) => void;
  readonly onRemove?: () => void;
}) {
  const set = <K extends keyof RouteDraft>(key: K, value: RouteDraft[K]) => onChange({ ...route, [key]: value });
  const stage = routeStageCylinder(route, cylinders);
  // Access and stages are set per cylinder, so a cylinder used by several gases stays locked until each gas has its own.
  const shared = cylinders.filter((cylinder) => cylinder.gases.length > 1);
  const sharedNote = shared.length > 0
    ? `${shared.map((cylinder) => `“${cylinder.name}”`).join(", ")} ${shared.length === 1 ? "is" : "are"} selected for more than one gas. Give each gas its own cylinder before setting access or a stage with it on this leg.`
    : undefined;
  // A gas that joined the plan after this leg's cylinders were set is treated as not carried here until the diver sets it.
  const unset = unsetRouteCylinders(route, cylinders);
  const unsetNames = unset.map((cylinder) => `“${cylinder.name}”`);
  const unsetList = unsetNames.length < 2 ? unsetNames.join("") : `${unsetNames.slice(0, -1).join(", ")} and ${unsetNames.at(-1)}`;
  const checksRef = useRef<HTMLDivElement>(null);
  const keepUnsetNotCarried = () => {
    onChange(withUnsetGasesKept(route, cylinders));
    // The button leaves with the notice; keep keyboard focus on the first gas it was about.
    checksRef.current?.querySelector<HTMLInputElement>(`input[data-cylinder-id="${CSS.escape(unset[0].id)}"]`)?.focus();
  };
  return <article className="bf-route-editor" id={`cave-route-${route.id}`} ref={containerRef} tabIndex={-1}>
    <header className="bf-row-header">
      <div><p className="bf-eyebrow">PENETRATION LEG</p><h3>{route.id}</h3></div>
      {onRemove && <ActionButton danger onClick={onRemove} quiet small>Remove</ActionButton>}
    </header>
    <div className="bf-form-grid bf-form-grid--route">
      <FieldGroup label="Leg label"><input aria-label="Leg label" onChange={(event) => set("id", event.currentTarget.value)} value={route.id} /></FieldGroup>
      <DepthField label={`Start depth (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("startDepthM", value)} units={preferences.depth} valueM={route.startDepthM} />
      <DepthField label={`End depth (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("endDepthM", value)} units={preferences.depth} valueM={route.endDepthM} />
      <NumberField label="Duration (min)" min={0.1} onChange={(durationMinutes) => set("durationMinutes", durationMinutes)} step={0.5} value={route.durationMinutes} />
      <DepthField label={`Distance (${depthUnit(preferences.depth)})`} min={0} onChange={(value) => set("distanceM", value)} units={preferences.depth} valueM={route.distanceM} />
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
        <select
          aria-label="Stage cylinder"
          onChange={(event) => {
            const id = event.currentTarget.value;
            onChange(withStageCylinder(route, cylinders.find((cylinder) => cylinder.id === id)));
          }}
          value={stage?.id ?? ""}
        >
          <option value="">Select cylinder</option>
          {cylinders.map((cylinder) => <option disabled={cylinder.gases.length > 1} key={cylinder.id} value={cylinder.id}>{cylinder.name}</option>)}
        </select>
      </FieldGroup>}
    </div>
    <FieldGroup error={sharedNote} hint="A dropped stage must be absent after its drop point until a recovery leg." label="Cylinders accessible on this leg">
      <div className="bf-check-grid" ref={checksRef}>
        {cylinders.map((cylinder) => {
          const access = routeCylinderAccess(route, cylinder);
          return <label className="bf-check" key={cylinder.id}>
            <input
              checked={access === "accessible"}
              data-cylinder-id={cylinder.id}
              disabled={cylinder.gases.length > 1}
              onChange={(event) => onChange(withCylinderAccess(route, cylinder, event.currentTarget.checked, cylinders))}
              ref={(input) => {
                if (input) input.indeterminate = access === "mixed";
              }}
              type="checkbox"
            />
            <span>{cylinder.name}</span>
          </label>;
        })}
      </div>
    </FieldGroup>
    {unset.length > 0 && <div className="bf-inline-fix bf-inline-fix--warning" role="status">
      <p>{unset.length === 1
        ? `${unsetList} joined the plan after this leg's cylinders were set and is treated as not carried here. Tick it if you carry it on this leg, or keep it not carried.`
        : `${unsetList} joined the plan after this leg's cylinders were set and are treated as not carried here. Tick any you carry on this leg, or keep them not carried.`}</p>
      <ActionButton onClick={keepUnsetNotCarried} quiet small>Keep not carried</ActionButton>
    </div>}
  </article>;
}

/** Cave adds one blocking state to the shared workspace statuses: a cylinder used by several gases. */
type CaveWorkspaceStatus = WorkspaceStatus | "cylinder-shared";

const AUTO_RECALCULATE_MS = 400;

const statusLabel: Record<CaveWorkspaceStatus, string> = {
  draft: "Draft",
  updating: "Updating",
  current: "Current",
  "needs-attention": "Needs attention",
  "source-changed": "Source changed",
  "source-unavailable": "Source unavailable",
  "cylinder-shared": "Cylinder shared",
};

const statusDescription: Record<CaveWorkspaceStatus, string> = {
  draft: "No cave calculation yet. Review route, gas access, and scenarios, then calculate once.",
  updating: "Inputs changed. Recalculating automatically; previous cave results are hidden.",
  current: "The result matches every current route, scenario, gas, and limit input.",
  "needs-attention": "Current cave inputs could not produce a result. Fix the diagnostics in Setup.",
  "source-changed": "A Tank Bank source or revision changed. Update explicitly before reviewing the cave plan.",
  "source-unavailable": "A selected Tank Bank cylinder cannot be used. Choose another cylinder or detach the gas in Setup; the cave plan is not calculated until then.",
  "cylinder-shared": "One Tank Bank cylinder is selected for more than one gas. Give each gas its own cylinder, or switch the extra gases off, in Setup; the cave plan is not calculated until then.",
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
    scenarioTriggers,
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
  const cylinders = useMemo(() => routeCylinders(draft, resolved), [draft, resolved]);
  const normalizedRoute = useMemo(() => normalizeCaveRoute(route, cylinders), [cylinders, route]);
  // Derived from the current route, not the calculation, so setting a gas clears them at once.
  const routeNotices = useMemo(() => unsetGasNotices(route, cylinders), [cylinders, route]);
  const scenarioApplicabilities = useMemo(
    () => Object.fromEntries(caveScenarioKinds(draft.mode).map((kind) => [kind, scenarioApplicability(kind, route, cylinders)])) as Record<CaveScenarioKind, ReturnType<typeof scenarioApplicability>>,
    [cylinders, draft.mode, route],
  );
  const scenarios = useMemo<readonly CaveScenarioRequest[]>(
    () => buildScenarioRequests(enabledScenarios, route, cylinders, scenarioTriggers),
    [cylinders, enabledScenarios, route, scenarioTriggers],
  );
  const timeline = useMemo(
    () => buildCaveTimeline(route, cylinders, enabledScenarios, scenarioTriggers),
    [cylinders, enabledScenarios, route, scenarioTriggers],
  );
  // No dive input exists while a selected Tank Bank source is unavailable, and no route while a
  // cylinder is used by several gases, so there is no cave input to calculate or match.
  const dive = resolved.input;
  const legs = normalizedRoute.legs;
  const input = useMemo<CavePlanInput | undefined>(() => dive && legs && {
    mode: draft.mode,
    dive,
    route: legs,
    reserve: dive.reservePolicy,
    scenarios,
    ...(limits.turnPressureBar === undefined ? {} : { turnPressureBar: barGauge(limits.turnPressureBar) }),
    ...(limits.turnTimeMinutes === undefined ? {} : { turnTimeSeconds: seconds(limits.turnTimeMinutes * 60) }),
    ...(limits.maximumDistanceM === undefined ? {} : { maximumPenetrationDistanceM: meters(limits.maximumDistanceM) }),
    ...(limits.maximumTimeMinutes === undefined ? {} : { maximumPenetrationTimeSeconds: seconds(limits.maximumTimeMinutes * 60) }),
  }, [dive, draft.mode, legs, limits, scenarios]);
  const inputSignature = input === undefined ? undefined : JSON.stringify(input);
  const sourceSignature = tankSourceSignature(draft, tankBank, "cave");
  // workspaceStatus reads a missing input as an unavailable source, so a shared cylinder is reported
  // first once every source loads.
  const status: CaveWorkspaceStatus = resolved.ok && !normalizedRoute.ok
    ? "cylinder-shared"
    : workspaceStatus({
        inputSignature,
        sourceSignature,
        calculated,
        attemptedInputSignature: session.attemptedInputSignature,
      });
  const calculatedIsCurrent = status === "current";
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

  const updateRoute = (index: number, next: RouteDraft) => {
    onSessionChange((current) => {
      const updated = [...current.route];
      const previousId = updated[index]?.id;
      updated[index] = next;
      const renamedTriggers = Object.fromEntries(Object.entries(current.scenarioTriggers).map(([kind, trigger]) => [
        kind,
        trigger.targetLegId === previousId ? { ...trigger, targetLegId: next.id } : trigger,
      ])) as Record<CaveScenarioKind, CaveScenarioTrigger>;
      return {
        ...current,
        route: updated,
        scenarioTriggers: repairScenarioTriggers(renamedTriggers, updated, cylinders),
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
        scenarioTriggers: repairScenarioTriggers(current.scenarioTriggers, updated, cylinders),
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
        scenarioTriggers: repairScenarioTriggers(current.scenarioTriggers, [...current.route, {
          id,
          startDepthM: previous?.endDepthM ?? 0,
          endDepthM: previous?.endDepthM ?? current.draft.depthM,
          durationMinutes: 5,
          distanceM: 75,
          propulsion: "fins",
          stageAction: "none",
        }], cylinders),
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
          // Per-scenario last eligible leg (not always the route's final leg).
          scenarioTriggers: initialScenarioTriggers(next.mode, current.route, cylinders),
          selectedScenario: 0,
        });
  };
  const changeLimits = (next: CaveLimitsDraft) => {
    onSessionChange((current) => ({ ...current, limits: next }));
  };
  const changeScenarioTrigger = (kind: CaveScenarioKind, next: CaveScenarioTrigger) => {
    onSessionChange((current) => ({
      ...current,
      scenarioTriggers: { ...current.scenarioTriggers, [kind]: next },
    }));
  };
  const changeScenarios = (next: readonly CaveScenarioKind[]) => {
    onSessionChange((current) => ({ ...current, enabledScenarios: next }));
  };
  const selectScenario = (index: number) => {
    onSessionChange((current) => ({ ...current, selectedScenario: index }));
  };
  const focusSetupRoute = (routeId: string) => {
    const target = document.getElementById(`cave-route-${routeId}`);
    target?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    target?.focus({ preventScroll: true });
  };
  const focusSetupScenario = (kind: CaveScenarioKind) => {
    const target = document.getElementById(`cave-scenario-${kind}`);
    target?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      block: "start",
    });
    target?.focus({ preventScroll: true });
  };
  const selectTimelineScenario = (kind: CaveScenarioKind) => {
    const index = calculated?.result.scenarios.findIndex((scenario) => scenario.kind === kind) ?? -1;
    if (index >= 0) selectScenario(index);
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
      // plan, so snapshot them explicitly with the immutable cave result, together
      // with the route's gases treated as not carried because they were never set.
      warnings: [...calculated.diagnostics, ...routeNotices],
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
  const summary = `${draft.mode.toUpperCase()} · ${route.length} leg${route.length === 1 ? "" : "s"} · ${Math.round(depthFromCanonical(routeDistance, preferences.depth))} ${depthUnit(preferences.depth)} · ${routeMinutes} min · ${scenarios.length} scenario${scenarios.length === 1 ? "" : "s"} · GF ${draft.gfLowPercent}/${draft.gfHighPercent}`;
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
            : status === "cylinder-shared"
              ? <ActionButton disabled>Resolve shared cylinder</ActionButton>
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
      {status === "needs-attention" && <WarningList
        items={diagnosticsToItems(diagnostics, preferences.depth, dive ? { route, dive, units: preferences.depth } : undefined)}
        title="Cave calculation diagnostics"
      />}
      <WarningList items={diagnosticsToItems(resolved.diagnostics, preferences.depth)} title="Tank Bank sources unavailable" />
      <WarningList items={diagnosticsToItems(normalizedRoute.diagnostics, preferences.depth)} title="Shared Tank Bank cylinders" />
      <WarningList items={diagnosticsToItems(routeNotices, preferences.depth)} title="Leg cylinders to confirm" />
      <PlannerEditor draft={draft} environment="cave" onChange={changeMode} preferences={preferences} showBottomTime={false} tankBank={tankBank} unavailableSources={resolved.unavailableSources} />
      <Panel actions={<ActionButton onClick={addLeg} quiet>Add route leg</ActionButton>} title="Penetration route">
        <CaveRouteTimeline model={timeline} onScenarioActivate={focusSetupScenario} onSegmentActivate={focusSetupRoute} preferences={preferences} />
        <CaveAccessTable cylinders={cylinders} preferences={preferences} route={route} />
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
          <DepthField hint="Gas-derived: the whole route is scaled until a cylinder no longer keeps its reserve or the recalculated plan has an error. Failure scenarios are not rechecked at that limit." label={`Maximum penetration distance (${depthUnit(preferences.depth)}; 0 = gas-derived)`} min={0} onChange={(value) => changeLimits({ ...limits, maximumDistanceM: value > 0 ? value : undefined })} units={preferences.depth} valueM={limits.maximumDistanceM ?? 0} />
          <NumberField hint="Gas-derived: the whole route is scaled until a cylinder no longer keeps its reserve or the recalculated plan has an error. Failure scenarios are not rechecked at that limit." label="Maximum penetration time (min; 0 = gas-derived)" min={0} onChange={(value) => changeLimits({ ...limits, maximumTimeMinutes: value > 0 ? value : undefined })} value={limits.maximumTimeMinutes ?? 0} />
        </div>
        <FieldGroup label="Scenarios to calculate">
          <div className="bf-scenario-editor">
            {caveScenarioKinds(draft.mode).map((kind) => {
              const applicability = scenarioApplicabilities[kind];
              const trigger = scenarioTriggers[kind];
              const point = scenarioTriggerPoint(trigger, route);
              return <article className="bf-scenario-editor__item" id={`cave-scenario-${kind}`} key={kind} tabIndex={-1}>
                <label className="bf-check">
                  <input checked={enabledScenarios.includes(kind)} disabled={!applicability.applicable} onChange={(event) => changeScenarios(event.currentTarget.checked ? [...enabledScenarios, kind] : enabledScenarios.filter((candidate) => candidate !== kind))} type="checkbox" />
                  <span>{scenarioLabel(kind)}</span>
                </label>
                {!applicability.applicable && <p className="bf-scenario-editor__reason">{applicability.reason}</p>}
                <p className="bf-scenario-editor__model">{scenarioModelLine(kind)}</p>
                {applicability.applicable && <div className="bf-form-grid">
                  <FieldGroup label={`${scenarioLabel(kind)} trigger leg`}>
                    <select aria-label={`${scenarioLabel(kind)} trigger leg`} onChange={(event) => changeScenarioTrigger(kind, { targetLegId: event.currentTarget.value })} value={trigger.targetLegId}>
                      {route.filter((leg) => applicability.eligibleLegIds.includes(leg.id)).map((leg) => <option key={leg.id} value={leg.id}>{leg.id}</option>)}
                    </select>
                  </FieldGroup>
                  <DepthField
                    label={`${scenarioLabel(kind)} trigger distance (${depthUnit(preferences.depth)}; 0 = end of leg)`}
                    min={0}
                    onChange={(value) => {
                      // Keep the typed distance in state so intermediate values (e.g. `4` while
                      // entering `410`) are not snapped back to the previous valid trigger.
                      const next: CaveScenarioTrigger = {
                        targetLegId: trigger.targetLegId,
                        ...(value > 0 ? { targetDistanceM: value } : {}),
                        ...(value > 0 && !isScenarioDistanceValid({ targetLegId: trigger.targetLegId, targetDistanceM: value }, route)
                          ? { repairNote: "Enter a distance inside this leg that leaves at least 1 s after rounding." }
                          : {}),
                      };
                      changeScenarioTrigger(kind, next);
                    }}
                    units={preferences.depth}
                    valueM={trigger.targetDistanceM ?? 0}
                  />
                </div>}
                {point && <p className="bf-scenario-editor__point">Trigger: {point.leg.id} · {depthFromCanonical(point.distanceM, preferences.depth).toFixed(0)} {depthUnit(preferences.depth)} from entrance · {depthFromCanonical(point.depthM, preferences.depth).toFixed(0)} {depthUnit(preferences.depth)} depth</p>}
                {trigger.repairNote && <p className="bf-scenario-editor__reason" role="status">{trigger.repairNote}</p>}
              </article>;
            })}
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
          {calculated.result.turnTimeSeconds !== undefined && <ResultMetric
            detail={enteredLimitLabel(calculated.result.turnTimeSeconds, [
              limits.turnTimeMinutes === undefined ? undefined : limits.turnTimeMinutes * 60,
              limits.maximumTimeMinutes === undefined ? undefined : limits.maximumTimeMinutes * 60,
            ])}
            label="Maximum turn time"
            value={formatDuration(calculated.result.turnTimeSeconds)}
          />}
          {calculated.result.maximumPermittedPenetrationDistanceM !== undefined && <ResultMetric
            detail={enteredLimitLabel(calculated.result.maximumPermittedPenetrationDistanceM, [limits.maximumDistanceM])}
            label="Maximum penetration distance"
            value={formatDepthBound(calculated.result.maximumPermittedPenetrationDistanceM, preferences.depth, "upper")}
          />}
        </div>
      </Panel>
      <WarningList items={diagnosticsToItems([...aggregateCaveDiagnostics, ...routeNotices], preferences.depth)} title="Aggregate cave diagnostics" />
      <Panel title="Penetration route">
        <CaveRouteTimeline model={timeline} onScenarioActivate={selectTimelineScenario} preferences={preferences} readOnly />
      </Panel>
      <Panel title="Failure scenarios">
        <SegmentedControl
          label="Scenario result"
          onChange={(value) => selectScenario(Number(value))}
          options={calculated.result.scenarios.map((scenario, index) => ({ value: String(index), label: scenarioLabel(scenario.kind) }))}
          value={String(selectedScenarioIndex)}
        />
        {scenarioResult ? <div className="bf-scenario-summary">
          <ResultMetric kind="text" label="Scenario status" tone={scenarioResult.safe ? "safe" : "danger"} value={scenarioResult.safe ? "Calculated sufficient" : "Unsafe or unavailable"} />
          <p className="bf-scenario-editor__model">{scenarioModelLine(scenarioResult.kind)}</p>
          {scenarioTriggerPoint(scenarioTriggers[scenarioResult.kind], route) && <p className="bf-scenario-editor__point">Trigger: {scenarioTriggerPoint(scenarioTriggers[scenarioResult.kind], route)!.leg.id} · {depthFromCanonical(scenarioTriggerPoint(scenarioTriggers[scenarioResult.kind], route)!.distanceM, preferences.depth).toFixed(0)} {depthUnit(preferences.depth)} from entrance · {depthFromCanonical(scenarioTriggerPoint(scenarioTriggers[scenarioResult.kind], route)!.depthM, preferences.depth).toFixed(0)} {depthUnit(preferences.depth)} depth</p>}
          <WarningList items={diagnosticsToItems(scenarioResult.diagnostics, preferences.depth)} title={`${scenarioLabel(scenarioResult.kind)} diagnostics`} />
        </div> : <p>No failure scenarios selected.</p>}
        {caveScenarioKinds(draft.mode).filter((kind) => enabledScenarios.includes(kind) && !scenarioApplicabilities[kind].applicable).map((kind) => <p className="bf-scenario-editor__reason" key={kind}>{scenarioLabel(kind)} is not calculated: the route has {kind === "scooter-failure" ? "no scooter leg" : "no leg that drops or recovers a stage"}.</p>)}
      </Panel>
      <PlanResultView compact plan={calculated.result.base} preferences={preferences} title="Base cave plan" />
      {scenarioResult?.plan && <PlanResultView compact plan={scenarioResult.plan} preferences={preferences} title={`${scenarioLabel(scenarioResult.kind)} plan`} />}
    </section> : <Panel eyebrow={statusLabel[status]} title="Cave review unavailable">
      <p>{statusDescription[status]}</p>
    </Panel>}
    <SavePlanDialog defaultName={`${draft.mode.toUpperCase()} cave · ${route.length} leg${route.length === 1 ? "" : "s"}`} onCancel={() => setSaveOpen(false)} onSave={save} open={saveOpen} />
  </>;
}
