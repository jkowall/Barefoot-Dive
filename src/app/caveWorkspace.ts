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

/**
 * A route leg as the diver edits it. Cylinder access and the stage are recorded by gas draft key,
 * not cylinder id, because a gas's cylinder id changes with its Tank Bank source; `caveRoute.ts`
 * maps them to the current cylinder ids when it builds the cave input.
 */
export type RouteDraft = {
  readonly id: string;
  readonly startDepthM: number;
  readonly endDepthM: number;
  readonly durationMinutes: number;
  readonly distanceM: number;
  readonly propulsion: Propulsion;
  /**
   * Gases whose cylinders are accessible on this leg. Undefined means every plan cylinder; the first
   * access edit records the gases then taking part.
   */
  readonly accessibleGasKeys?: readonly string[];
  /**
   * Gases whose access the diver has set on this leg: those listed at the first access edit and each
   * one ticked, unticked, or kept not carried since. Written with `accessibleGasKeys`.
   */
  readonly setGasKeys?: readonly string[];
  readonly stageAction: StageAction;
  /** The gas whose cylinder is dropped or recovered on this leg. */
  readonly stageGasKey?: string;
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
  /** Superseded by an unavailable Tank Bank source; see `WorkspaceCalculation` in `workspaceStatus.ts`. */
  readonly sourceInvalidated?: boolean;
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
