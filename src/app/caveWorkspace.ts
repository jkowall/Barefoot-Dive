import type {
  CavePlanInput,
  CavePlanResult,
  CaveScenarioKind,
  Propulsion,
  StageAction,
} from "../cave";
import type { Diagnostic } from "../domain/types";
import { DEFAULT_PLAN_DRAFT, type PlanDraft } from "./planning";

export type CaveWorkspaceView = "setup" | "review";

export type RouteDraft = {
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

export type CaveLimitsDraft = {
  readonly turnPressureBar?: number;
  readonly turnTimeMinutes?: number;
  readonly maximumDistanceM?: number;
  readonly maximumTimeMinutes?: number;
  readonly scenarioTargetDistanceM?: number;
};

export type CalculatedCaveSession = {
  readonly input: CavePlanInput;
  readonly result: CavePlanResult;
  /** Includes cave-layer warnings/errors returned outside the base decompression plan. */
  readonly diagnostics: readonly Diagnostic[];
  readonly inputSignature: string;
  readonly sourceSignature: string;
};

export type CaveWorkspaceSession = {
  readonly view: CaveWorkspaceView;
  readonly draft: PlanDraft;
  readonly route: readonly RouteDraft[];
  readonly limits: CaveLimitsDraft;
  readonly enabledScenarios: readonly CaveScenarioKind[];
  readonly targetLegId: string;
  readonly selectedScenario: number;
  readonly pendingRouteId?: string;
  readonly calculated?: CalculatedCaveSession;
  readonly diagnostics: readonly Diagnostic[];
  readonly attemptedInputSignature?: string;
};

export const caveScenarioKinds = (mode: PlanDraft["mode"]): readonly CaveScenarioKind[] => mode === "oc"
  ? ["oc-lost-gas", "lost-buddy", "scooter-failure", "stage-failure"]
  : ["ccr-loop-failure"];

const createInitialCaveDraft = (): PlanDraft => {
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
};

export const createInitialCaveWorkspaceSession = (): CaveWorkspaceSession => ({
  view: "setup",
  draft: createInitialCaveDraft(),
  route: [{
    id: "route-1",
    startDepthM: 0,
    endDepthM: 18,
    durationMinutes: 5,
    distanceM: 60,
    propulsion: "fins",
    stageAction: "none",
  }],
  limits: {},
  enabledScenarios: caveScenarioKinds("oc"),
  targetLegId: "route-1",
  selectedScenario: 0,
  diagnostics: [],
});
