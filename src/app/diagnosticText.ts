import type { DepthMention, Diagnostic } from "../domain/types";
import { formatMessageDepth, roundBound } from "../domain/units";
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
 * Where `metric` is printed in `text` at or after `from`, as a whole number: "21.3 m" inside
 * "121.3 m" is a different depth and is skipped. Returns -1 when it is not printed.
 */
function printedAt(text: string, metric: string, from: number): number {
  for (let at = text.indexOf(metric, from); at >= 0; at = text.indexOf(metric, at + 1)) {
    const before = at > 0 ? text[at - 1]! : "";
    if (!/[\d.]/.test(before)) return at;
  }
  return -1;
}

/**
 * A diagnostic message in the user's depth unit.
 *
 * Engine and validation messages print depths in canonical metres. For imperial users each printed
 * depth is restated in whole feet from its exact value and its rounding direction, never by converting
 * the rounded metre text. Explicit `depthMentions` are replaced in order; otherwise a message that
 * prints its `depthM` is converted. A message whose depths cannot be matched is shown unchanged.
 */
export function formatDiagnostic(diagnostic: Diagnostic, units: UnitPreferences["depth"]): string {
  if (units !== "imperial") return diagnostic.message;
  if (diagnostic.depthMentions) {
    let text = diagnostic.message;
    let from = 0;
    for (const mention of diagnostic.depthMentions) {
      const metric = formatMessageDepth(mention.valueM, mention.rounding);
      const at = printedAt(text, metric, from);
      if (at < 0) return diagnostic.message;
      const imperial = feetMention(mention);
      text = `${text.slice(0, at)}${imperial}${text.slice(at + metric.length)}`;
      from = at + imperial.length;
    }
    return text;
  }
  if (diagnostic.depthM === undefined) return diagnostic.message;
  const metric = formatMessageDepth(diagnostic.depthM);
  const imperial = feetMention({ valueM: diagnostic.depthM, rounding: "nearest" });
  let text = diagnostic.message;
  for (let at = printedAt(text, metric, 0); at >= 0; at = printedAt(text, metric, at + imperial.length)) {
    text = `${text.slice(0, at)}${imperial}${text.slice(at + metric.length)}`;
  }
  return text;
}
