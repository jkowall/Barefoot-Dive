import type { Diagnostic, DivePlan, DivePlanInput } from "../domain/types";

export type PlanWorkspaceView = "setup" | "review";

export type CalculatedPlanSession = {
  readonly input: DivePlanInput;
  readonly plan: DivePlan;
  readonly inputSignature: string;
  readonly sourceSignature: string;
  /** Superseded by an unavailable Tank Bank source; see `WorkspaceCalculation` in `workspaceStatus.ts`. */
  readonly sourceInvalidated?: boolean;
};

export type PlanWorkspaceSession = {
  readonly view: PlanWorkspaceView;
  readonly calculated?: CalculatedPlanSession;
  readonly diagnostics: readonly Diagnostic[];
  readonly attemptedInputSignature?: string;
};

export const createInitialPlanWorkspaceSession = (): PlanWorkspaceSession => ({
  view: "setup",
  diagnostics: [],
});
