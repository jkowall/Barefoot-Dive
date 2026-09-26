import type { DepthMention, Diagnostic } from "../domain/types";
import { formatMessageDepth, meters, roundBound } from "../domain/units";
import { depthFromCanonical, type UnitPreferences } from "./helpers";

/** A message depth restated in whole feet, rounded in the same direction as the metre text. */
function feetMention(mention: DepthMention): string {
  const feet = depthFromCanonical(mention.valueM, "imperial");
  const whole = mention.rounding === "nearest"
    ? Math.round(feet)
    : roundBound(feet, 0, mention.rounding === "down" ? "upper" : "lower");
  return `${whole} ft`;
}

/**
 * Where `metric` is printed in `text` at or after `from`, as a whole depth: "21.3 m" inside
 * "121.3 m" or "21.3 min" is something else and is skipped. Returns -1 when it is not printed.
 */
function printedAt(text: string, metric: string, from: number): number {
  for (let at = text.indexOf(metric, from); at >= 0; at = text.indexOf(metric, at + 1)) {
    const before = at > 0 ? text[at - 1]! : "";
    const after = text[at + metric.length] ?? "";
    if (!/[\d.]/.test(before) && !/[\p{L}\p{N}]/u.test(after)) return at;
  }
  return -1;
}

/**
 * Whether `text` still prints a depth in metres the way the engine does, with one decimal ("3.6 m",
 * "0.0 m"), as opposed to "21.3 min" or a user's gas name such as "EAN50 21 m".
 */
function printsMetres(text: string): boolean {
  return /\d\.\d m(?![\p{L}\p{N}])/u.test(text);
}

/**
 * Mentions for a saved diagnostic from before `depthMentions` existed (0.5.1 and earlier) whose message
 * prints more than one depth. Its structured fields still hold every printed value, and the message
 * printed each to the nearest 0.1 m.
 */
function legacyMentions(diagnostic: Diagnostic): readonly DepthMention[] | undefined {
  const { depthM, actual } = diagnostic;
  if (depthM === undefined || actual === undefined) return undefined;
  const nearest = (valueM: number): DepthMention => ({ valueM: meters(valueM), rounding: "nearest" });
  switch (diagnostic.code) {
    // "… shallower than {achievable} m, so the plan switches to the low setpoint at {achievable} m instead of {switch-down} m."
    case "CCR_SWITCH_DOWN_DEEPENED":
      return [nearest(depthM), nearest(depthM), nearest(actual)];
    // "No bailout gas is breathable between {shallow} m and {deep} m. …"
    case "CCR_BAILOUT_COVERAGE_GAP":
      return [nearest(actual), nearest(depthM)];
    default:
      return undefined;
  }
}

/**
 * A diagnostic message in the user's depth unit.
 *
 * Engine and validation messages print depths in canonical metres. For imperial users each printed
 * depth is restated in whole feet from its exact value and its rounding direction, never by converting
 * the rounded metre text. Explicit `depthMentions` are replaced in order, as are the mentions of a
 * multi-depth warning saved before they existed; otherwise a message that prints its `depthM` is
 * converted. A message whose depths cannot all be matched is shown unchanged, never in mixed units.
 */
export function formatDiagnostic(diagnostic: Diagnostic, units: UnitPreferences["depth"]): string {
  if (units !== "imperial") return diagnostic.message;
  const mentions = diagnostic.depthMentions ?? legacyMentions(diagnostic);
  let text = diagnostic.message;
  if (mentions) {
    let from = 0;
    for (const mention of mentions) {
      const metric = formatMessageDepth(mention.valueM, mention.rounding);
      const at = printedAt(text, metric, from);
      if (at < 0) return diagnostic.message;
      const imperial = feetMention(mention);
      text = `${text.slice(0, at)}${imperial}${text.slice(at + metric.length)}`;
      from = at + imperial.length;
    }
  } else {
    if (diagnostic.depthM === undefined) return diagnostic.message;
    const metric = formatMessageDepth(diagnostic.depthM);
    const imperial = feetMention({ valueM: diagnostic.depthM, rounding: "nearest" });
    for (let at = printedAt(text, metric, 0); at >= 0; at = printedAt(text, metric, at + imperial.length)) {
      text = `${text.slice(0, at)}${imperial}${text.slice(at + metric.length)}`;
    }
  }
  return printsMetres(text) ? diagnostic.message : text;
}
