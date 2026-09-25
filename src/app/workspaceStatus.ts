/** Status of a Plan or Cave workspace. Both derive it here so they apply the same rules. */
export type WorkspaceStatus = "draft" | "updating" | "current" | "needs-attention" | "source-changed" | "source-unavailable";

/** The part of a session's calculation that decides whether it still matches the Setup inputs. */
export type WorkspaceCalculation = {
  readonly inputSignature: string;
  readonly sourceSignature: string;
  /**
   * Set once a selected Tank Bank source became unavailable after this calculation. The result then
   * never matches again, even if the source returns unchanged; only an explicit recalculation replaces it.
   */
  readonly sourceInvalidated?: boolean;
};

/**
 * The workspace status. `inputSignature` is undefined while a selected Tank Bank source is unavailable,
 * because there is then no input to calculate or match.
 */
export function workspaceStatus({ inputSignature, sourceSignature, calculated, attemptedInputSignature }: {
  readonly inputSignature: string | undefined;
  readonly sourceSignature: string;
  readonly calculated?: WorkspaceCalculation;
  readonly attemptedInputSignature?: string;
}): WorkspaceStatus {
  if (inputSignature === undefined) return "source-unavailable";
  if (calculated && !calculated.sourceInvalidated && calculated.inputSignature === inputSignature) return "current";
  if (attemptedInputSignature === inputSignature) return "needs-attention";
  if (calculated && (calculated.sourceInvalidated || calculated.sourceSignature !== sourceSignature)) return "source-changed";
  return calculated ? "updating" : "draft";
}

/**
 * Marks the session's calculation as superseded by an unavailable Tank Bank source and forgets the last
 * attempt, so the next explicit Update is judged on its own outcome. Returns the same session when there
 * is nothing to mark.
 */
export function invalidateForUnavailableSource<S extends {
  readonly calculated?: WorkspaceCalculation;
  readonly attemptedInputSignature?: string;
}>(session: S): S {
  if (!session.calculated || session.calculated.sourceInvalidated) return session;
  return { ...session, calculated: { ...session.calculated, sourceInvalidated: true }, attemptedInputSignature: undefined };
}
