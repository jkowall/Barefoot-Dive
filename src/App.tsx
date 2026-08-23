import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { calculateCavePlan } from "./cave";
import { calculateDivePlan, ENGINE_VERSION } from "./engine/planner";
import {
  createSavedPlansStore,
  createTankBankStore,
  storageOptions,
  type SavedPlanDraft,
  type SavedPlanRecord,
  type TankRecord,
} from "./storage";
import {
  AppShell,
  CompletionNotice,
  ConfirmDialog,
  EmptyState,
  PageHeader,
  Panel,
  SegmentedControl,
  WarningList,
  type NavigationItem,
  type RouteKey,
} from "./ui";
import CavePage from "./app/CavePage";
import { collectCaveDiagnostics } from "./app/caveDiagnostics";
import { createInitialCaveWorkspaceSession, type CaveWorkspaceSession } from "./app/caveWorkspace";
import { ActionButton } from "./app/controls";
import { DEFAULT_PREFERENCES, type UnitPreferences } from "./app/helpers";
import { DEFAULT_PLAN_DRAFT, type PlanDraft } from "./app/planning";
import PlanPage from "./app/PlanPage";
import { PlanResultView } from "./app/PlanResultView";
import { createInitialPlanWorkspaceSession, type PlanWorkspaceSession } from "./app/planWorkspace";
import { SavedPlansPage } from "./app/SavedPlansPage";
import { TankBankPage } from "./app/TankBankPage";
import { createInitialToolsSessionState, type ToolsSessionState } from "./app/toolsSession";
import {
  applyToolPlanPatch,
  describeToolPlanPatch,
  draftFromCylinder,
  toolPlanPatchError,
  type ToolPlanPatch,
} from "./app/toolUse";
import ToolsPage from "./app/ToolsPage";

const SAFETY_KEY = "barefoot-dive:safety-acknowledged";
const PREFERENCES_KEY = "barefoot-dive:preferences";

function readSafetyAcknowledgement(): boolean {
  try {
    return localStorage.getItem(SAFETY_KEY) === "true";
  } catch {
    return false;
  }
}

function readPreferences(): UnitPreferences {
  try {
    const stored = localStorage.getItem(PREFERENCES_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<UnitPreferences>;
    return {
      depth: parsed.depth === "metric" ? "metric" : "imperial",
      pressure: parsed.pressure === "bar" ? "bar" : "psi",
      cylinderCapacity: parsed.cylinderCapacity === "metric" ? "metric" : "imperial",
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function SafetyGate({ onAcknowledge }: { readonly onAcknowledge: (storageError?: string) => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  useEffect(() => buttonRef.current?.focus(), []);
  return <main className="bf-dialog-backdrop">
    <section aria-describedby="safety-description" aria-labelledby="safety-title" aria-modal="true" className="bf-dialog bf-safety-gate" role="dialog">
      <p className="bf-eyebrow">BEFORE YOU PLAN</p>
      <h1 id="safety-title">Decision support, not life-support equipment</h1>
      <p id="safety-description">Barefoot Dive does not replace training, team procedures, a dive computer, analyzed gas, manufacturer limits, or independent plan verification. Cave outputs are experimental. Confirm every gas and cylinder before use.</p>
      <ul className="bf-safety-list">
        <li>I will independently verify the plan and contingency gas.</li>
        <li>I will use final analyzer readings and current cylinder pressures.</li>
        <li>I understand software and convention differences can change decompression.</li>
      </ul>
      <div className="bf-dialog__actions">
        <button
          className="bf-button"
          onClick={() => {
            try {
              localStorage.setItem(SAFETY_KEY, "true");
              onAcknowledge();
            } catch (error) {
              onAcknowledge(error instanceof Error ? error.message : "Safety acknowledgement could not be persisted.");
            }
          }}
          ref={buttonRef}
          type="button"
        >I understand and accept</button>
      </div>
    </section>
  </main>;
}

function SettingsDialog({
  preferences,
  onChange,
  onClose,
}: {
  readonly preferences: UnitPreferences;
  readonly onChange: (next: UnitPreferences) => void;
  readonly onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  return <div className="bf-dialog-backdrop">
    <section aria-labelledby="settings-title" aria-modal="true" className="bf-dialog bf-settings-dialog" role="dialog">
      <p className="bf-eyebrow">LOCAL PREFERENCES</p>
      <h2 id="settings-title">Settings</h2>
      <div className="bf-settings-fields">
        <SegmentedControl
          label="Depth and distance"
          onChange={(depth) => onChange({ ...preferences, depth })}
          options={[{ value: "imperial", label: "Feet" }, { value: "metric", label: "Meters" }]}
          value={preferences.depth}
        />
        <SegmentedControl
          label="Cylinder pressure"
          onChange={(pressure) => onChange({ ...preferences, pressure })}
          options={[{ value: "psi", label: "PSI" }, { value: "bar", label: "Bar" }]}
          value={preferences.pressure}
        />
        <SegmentedControl
          label="Cylinder capacity"
          onChange={(cylinderCapacity) => onChange({ ...preferences, cylinderCapacity })}
          options={[{ value: "imperial", label: "Rated ft³" }, { value: "metric", label: "Water-volume L" }]}
          value={preferences.cylinderCapacity}
        />
      </div>
      <p>Canonical calculations remain meters, seconds, ambient bar absolute, cylinder bar gauge, surface liters, and gas fractions. Display preferences are independent.</p>
      <p className="bf-field-group__hint">App {__APP_VERSION__} · Calculation engine {ENGINE_VERSION}</p>
      <div className="bf-dialog__actions"><button className="bf-button" onClick={onClose} ref={closeRef} type="button">Done</button></div>
    </section>
  </div>;
}

function SavedPlanDetail({
  record,
  preferences,
  onBack,
}: {
  readonly record: SavedPlanRecord;
  readonly preferences: UnitPreferences;
  readonly onBack: () => void;
}) {
  const caveDiagnostics = record.caveResultSnapshot
    ? collectCaveDiagnostics(record.warnings, record.caveResultSnapshot)
    : [];
  const caveUnsafe = caveDiagnostics.some((item) => item.severity === "error");
  return <>
    <PageHeader
      actions={<ActionButton onClick={onBack} quiet>Back to library</ActionButton>}
      description={`Immutable revision ${record.revision} · ${record.engineVersion} · ${record.createdAt}`}
      eyebrow={record.caveResultSnapshot
        ? caveUnsafe ? "SAVED CAVE SNAPSHOT · UNSAFE" : "SAVED CAVE SNAPSHOT"
        : "SAVED PLAN SNAPSHOT"}
      title={record.title}
    />
    {record.engineVersion !== ENGINE_VERSION && <WarningList items={[{
      id: "older-engine",
      message: `This revision was calculated with ${record.engineVersion}. Recalculate from the library to create a new revision with ${ENGINE_VERSION}.`,
      severity: "warning",
    }]} title="Version status" />}
    {record.caveResultSnapshot && <>
      <WarningList items={caveDiagnostics.map((item, index) => ({
        id: `stored-cave-${item.code}-${index}`,
        message: item.field ? `${item.message} (${item.field})` : item.message,
        severity: item.severity,
      }))} title="Stored cave calculation diagnostics" />
      <Panel
        eyebrow={caveUnsafe ? "Stored safety errors · do not use" : "Experimental cave context retained"}
        title="Cave snapshot"
      >
        <p>{record.caveInputSnapshot?.route.length ?? 0} route legs · {record.caveResultSnapshot.scenarios.length} failure scenarios · limiting resource: {record.caveResultSnapshot.limitingResource}</p>
      </Panel>
    </>}
    <PlanResultView
      plan={record.calculatedPlan}
      preferences={preferences}
      title={record.caveResultSnapshot ? "Stored base decompression output" : "Stored calculated output"}
    />
  </>;
}

function buildRecalculation(record: SavedPlanRecord, reportError: (message: string) => void): SavedPlanDraft | undefined {
  if (record.caveInputSnapshot) {
    const calculated = calculateCavePlan(record.caveInputSnapshot);
    if (!calculated.ok) {
      reportError(calculated.errors.map((item) => `${item.message} (${item.code})`).join(" "));
      return undefined;
    }
    return {
      title: record.title,
      normalizedInputSnapshot: record.caveInputSnapshot.dive,
      calculatedPlan: calculated.value.base,
      caveInputSnapshot: record.caveInputSnapshot,
      caveResultSnapshot: calculated.value,
      warnings: collectCaveDiagnostics(
        [...calculated.warnings, ...(calculated.errors ?? [])],
        calculated.value,
      ),
    };
  }
  const calculated = calculateDivePlan(record.normalizedInputSnapshot);
  if (!calculated.ok) {
    reportError(calculated.errors.map((item) => `${item.message} (${item.code})`).join(" "));
    return undefined;
  }
  return {
    title: record.title,
    normalizedInputSnapshot: record.normalizedInputSnapshot,
    calculatedPlan: calculated.value,
    warnings: [...calculated.warnings, ...(calculated.errors ?? [])],
  };
}

export default function App() {
  const stores = useMemo(() => {
    try {
      const options = storageOptions();
      return {
        tankBank: createTankBankStore(options),
        savedPlans: createSavedPlansStore(options),
        error: undefined,
      };
    } catch (error) {
      return {
        tankBank: undefined,
        savedPlans: undefined,
        error: error instanceof Error ? error.message : "Local storage is unavailable.",
      };
    }
  }, []);
  const [acknowledged, setAcknowledged] = useState(readSafetyAcknowledgement);
  const [preferences, setPreferences] = useState(readPreferences);
  const [route, setRoute] = useState<RouteKey>("plan");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalError, setGlobalError] = useState<string>();
  const [openedRecord, setOpenedRecord] = useState<SavedPlanRecord>();
  const [planDraft, setPlanDraft] = useState<PlanDraft>(() => structuredClone(DEFAULT_PLAN_DRAFT));
  const [planSession, setPlanSession] = useState<PlanWorkspaceSession>(createInitialPlanWorkspaceSession);
  const [caveSession, setCaveSession] = useState<CaveWorkspaceSession>(createInitialCaveWorkspaceSession);
  const [pendingToolPatch, setPendingToolPatch] = useState<ToolPlanPatch>();
  const [planNotice, setPlanNotice] = useState<{ readonly revision: number; readonly label: string; readonly description: string }>();
  const [toolsSession, setToolsSession] = useState<ToolsSessionState>(createInitialToolsSessionState);
  const [dataRevision, setDataRevision] = useState(0);

  const savePreferences = (next: UnitPreferences) => {
    setPreferences(next);
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch (error) {
      setGlobalError(error instanceof Error ? error.message : "Preferences could not be stored.");
    }
  };
  const savedCountResult = stores.savedPlans?.list({ archived: false });
  const savedCount = savedCountResult?.ok ? savedCountResult.value.length : 0;
  const navigation: readonly NavigationItem[] = [
    { key: "plan", label: "Plan" },
    { key: "cave", label: "Cave" },
    { key: "tools", label: "Tools" },
    { key: "tanks", label: "Tank bank" },
    { key: "plans", label: "Saved plans", ...(savedCount > 0 ? { badge: savedCount } : {}) },
  ];
  const reportError = useCallback((message: string) => setGlobalError(message), []);
  const refreshData = useCallback(() => setDataRevision((revision) => revision + 1), []);
  const showPlanNotice = (label: string, description: string) => setPlanNotice((current) => ({
    revision: (current?.revision ?? 0) + 1,
    label,
    description,
  }));

  const useCylinder = (record: TankRecord) => {
    setPlanDraft(draftFromCylinder(record));
    setPlanSession(createInitialPlanWorkspaceSession());
    showPlanNotice("Plan started", `Started a new plan with ${record.name}.`);
    setOpenedRecord(undefined);
    setRoute("plan");
  };
  const requestToolPatch = (patch: ToolPlanPatch) => {
    const patchError = toolPlanPatchError(planDraft, patch);
    if (patchError) {
      reportError(patchError);
      return;
    }
    if (patch.kind === "best-mix") {
      const assignedId = planDraft.bottomGas.cylinderId;
      const listed = stores.tankBank?.list({ archived: false });
      const assigned = listed?.ok
        ? listed.value.find((record) => record.id === assignedId)
        : undefined;
      const exactMatch = assigned
        && Math.abs(assigned.gas.oxygen * 100 - patch.oxygenPercent) < 1e-9
        && Math.abs(assigned.gas.helium * 100 - patch.heliumPercent) < 1e-9;
      setPendingToolPatch({
        ...patch,
        preserveCylinderId: exactMatch ? assigned.id : undefined,
      });
      return;
    }
    setPendingToolPatch(patch);
  };
  if (!acknowledged) {
    return <SafetyGate onAcknowledge={(storageError) => {
      setAcknowledged(true);
      if (storageError) setGlobalError(storageError);
    }} />;
  }

  let content;
  if (openedRecord) {
    content = <SavedPlanDetail onBack={() => setOpenedRecord(undefined)} preferences={preferences} record={openedRecord} />;
  } else if (route === "plan") {
    content = <PlanPage
      draft={planDraft}
      onDraftChange={(next) => {
        setPlanDraft(next);
        setPlanNotice(undefined);
      }}
      onSessionChange={setPlanSession}
      onStorageChange={refreshData}
      plans={stores.savedPlans}
      preferences={preferences}
      session={planSession}
      tankRevision={dataRevision}
      tanks={stores.tankBank}
    />;
  } else if (route === "cave") {
    content = <CavePage
      onSessionChange={setCaveSession}
      onStorageChange={refreshData}
      plans={stores.savedPlans}
      preferences={preferences}
      session={caveSession}
      tankRevision={dataRevision}
      tanks={stores.tankBank}
    />;
  } else if (route === "tools") {
    content = <ToolsPage
      onError={reportError}
      onRequestPlanPatch={requestToolPatch}
      onSessionChange={setToolsSession}
      planMode={planDraft.mode}
      session={toolsSession}
      tankRevision={dataRevision}
      tanks={stores.tankBank}
      units={preferences}
    />;
  } else if (route === "tanks") {
    content = stores.tankBank
      ? <TankBankPage onError={reportError} onRecordsChange={refreshData} onSelectCylinder={useCylinder} store={stores.tankBank} units={preferences} />
      : <EmptyState description="Local storage is unavailable, so equipment records cannot be changed." title="Tank Bank unavailable" />;
  } else {
    content = stores.savedPlans
      ? <SavedPlansPage
          currentEngineVersion={ENGINE_VERSION}
          onError={reportError}
          onOpenPlan={(_, record) => setOpenedRecord(record)}
          onRecalculate={(record) => buildRecalculation(record, reportError)}
          onRecordsChange={refreshData}
          store={stores.savedPlans}
        />
      : <EmptyState description="Local storage is unavailable, so saved plan snapshots cannot be opened." title="Saved plans unavailable" />;
  }

  return <AppShell
    activeRoute={route}
    navigation={navigation}
    onNavigate={(next) => {
      setOpenedRecord(undefined);
      setSettingsOpen(false);
      setRoute(next);
    }}
    onOpenSettings={() => setSettingsOpen(true)}
  >
    {(stores.error || globalError) && <WarningList items={[{
      id: "application-error",
      message: stores.error ?? globalError ?? "Unknown application error.",
      severity: "error",
    }]} title="Application status" />}
    {globalError && <div className="bf-inline-actions"><ActionButton onClick={() => setGlobalError(undefined)} quiet>Dismiss error</ActionButton></div>}
    {route === "plan" && planNotice && <CompletionNotice
      actions={<ActionButton onClick={() => setPlanNotice(undefined)} quiet>Dismiss</ActionButton>}
      description={planNotice.description}
      key={planNotice.revision}
      label={planNotice.label}
    />}
    {content}
    {settingsOpen && <SettingsDialog onChange={savePreferences} onClose={() => setSettingsOpen(false)} preferences={preferences} />}
    <ConfirmDialog
      cancelLabel="Keep checking"
      confirmLabel="Apply to current Plan"
      description={pendingToolPatch ? describeToolPlanPatch(planDraft, pendingToolPatch, preferences.cylinderCapacity) : ""}
      onCancel={() => setPendingToolPatch(undefined)}
      onConfirm={() => {
        if (!pendingToolPatch) return;
        const description = describeToolPlanPatch(planDraft, pendingToolPatch, preferences.cylinderCapacity);
        setPlanDraft((current) => applyToolPlanPatch(current, pendingToolPatch));
        setPlanSession((current) => ({ ...current, view: "setup" }));
        setPendingToolPatch(undefined);
        showPlanNotice("Plan updated", description);
        setOpenedRecord(undefined);
        setRoute("plan");
      }}
      open={Boolean(pendingToolPatch)}
      title="Apply this exact change?"
    />
  </AppShell>;
}
