import { expect, it } from "vitest";
import { AIR, DEFAULT_ENVIRONMENT, DEFAULT_PLANNER_SETTINGS, DEFAULT_RESERVE_POLICY, DEFAULT_RMV, EAN50, OXYGEN } from "../domain/defaults";
import type { CcrDiveInput, DivePlan, Gas, OcDiveInput } from "../domain/types";
import { barAbsolute, barGauge, fraction, liters, meters, seconds } from "../domain/units";
import { calculateDivePlan, calculateEventDivePlan, type ExposureEvent } from "./planner";
import { calculateCavePlan, type CavePlanInput } from "../cave";
import { DEFAULT_PLAN_DRAFT, resolvePlanInput } from "../app/planning";

function hash(value: unknown): string {
  const text = JSON.stringify(value);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, "0");
}
const digest = (plan: DivePlan | undefined): unknown => plan && ({ id: plan.id, segments: plan.segments, stops: plan.stops, summary: plan.summary, gasLedger: plan.gasLedger, diagnostics: plan.diagnostics, safetyStatus: plan.safetyStatus, bailout: digest(plan.bailoutPlan) });
const tx1845: Gas = { id: "tx18-45", name: "Tx18/45", oxygen: fraction(0.18), helium: fraction(0.45), role: "bottom" };

/**
 * Byte-identity guard for legacy inputs. These digests were captured from engine 0.1.0
 * before low setpoints, dil-out, gas-only planning, and the hypoxic-leg fixes were added.
 * Legacy CCR breathing (open-circuit diluent above the activation depth) and non-hypoxic
 * OC schedules, ledgers, diagnostics, and plan ids must stay exactly the same.
 */
it("reproduces engine 0.1.0 results for legacy CCR, OC, and cave inputs", () => {
  const out: Record<string, string> = {};
  const oc: OcDiveInput = { mode: "oc", environment: "open-water", depthM: meters(45), bottomTimeSeconds: seconds(25 * 60), bottomGas: tx1845, decoGases: [{ ...EAN50, switchDepthM: meters(21) }, { ...OXYGEN, switchDepthM: meters(6) }], cylinders: [], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY };
  const r1 = calculateDivePlan(oc); out.ocTrimix = hash(r1.ok ? digest(r1.value) : r1);
  const ocAir: OcDiveInput = { ...oc, depthM: meters(30), bottomTimeSeconds: seconds(20 * 60), bottomGas: AIR, decoGases: [] };
  const r2 = calculateDivePlan(ocAir); out.ocAir = hash(r2.ok ? digest(r2.value) : r2);
  const ccr: CcrDiveInput = { mode: "ccr", environment: "open-water", depthM: meters(45), bottomTimeSeconds: seconds(30 * 60), diluent: { ...AIR, id: "dil", role: "diluent" }, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [{ ...tx1845, id: "bo", role: "bailout" }, { ...EAN50, id: "bo50", role: "bailout", switchDepthM: meters(21) }], bailoutTriggerSecondsAtDepth: seconds(15 * 60), cylinders: [], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY };
  const r3 = calculateDivePlan(ccr); out.ccrLegacy = hash(r3.ok ? digest(r3.value) : r3);
  const draftOc = resolvePlanInput(DEFAULT_PLAN_DRAFT, []).input!;
  const r4 = calculateDivePlan(draftOc); out.draftOc = hash(r4.ok ? digest(r4.value) : r4);
  const draftCcrLegacy = resolvePlanInput({ ...DEFAULT_PLAN_DRAFT, mode: "ccr" }, []).input as CcrDiveInput;
  const legacyOnly: CcrDiveInput = { mode: "ccr", environment: draftCcrLegacy.environment, depthM: draftCcrLegacy.depthM, bottomTimeSeconds: draftCcrLegacy.bottomTimeSeconds, diluent: draftCcrLegacy.diluent, setpointBar: draftCcrLegacy.setpointBar, setpointActivationDepthM: draftCcrLegacy.setpointActivationDepthM, bailoutGases: draftCcrLegacy.bailoutGases, cylinders: draftCcrLegacy.cylinders, settings: draftCcrLegacy.settings, environmentSettings: draftCcrLegacy.environmentSettings, rmv: draftCcrLegacy.rmv, reservePolicy: draftCcrLegacy.reservePolicy };
  const r5 = calculateDivePlan(legacyOnly); out.draftCcrLegacy = hash(r5.ok ? digest(r5.value) : r5);
  const diluent = { ...AIR, id: "surface-diluent", role: "diluent" as const, cylinderId: "diluent-cylinder" };
  const bailout = { ...AIR, id: "surface-bailout", role: "bailout" as const, cylinderId: "surface-bailout-cylinder" };
  const cave: CavePlanInput = { mode: "ccr", reserve: { kind: "fixed", minimumPressureBar: barGauge(35) }, dive: { mode: "ccr", environment: "cave", depthM: meters(30), bottomTimeSeconds: seconds(120), diluent, setpointBar: barAbsolute(1.3), setpointActivationDepthM: meters(6), bailoutGases: [bailout], cylinders: [{ id: "diluent-cylinder", name: "Diluent", waterVolumeL: liters(3), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: diluent, maximumPPO2: barAbsolute(1.4), revision: 1 }, { id: "surface-bailout-cylinder", name: "Bailout", waterVolumeL: liters(20), workingPressureBar: barGauge(200), currentPressureBar: barGauge(200), gas: bailout, maximumPPO2: barAbsolute(1.6), revision: 1 }], settings: DEFAULT_PLANNER_SETTINGS, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY }, route: [{ id: "surface-entry", startDepthM: meters(0), endDepthM: meters(30), durationSeconds: seconds(300), distanceM: meters(100), propulsion: "fins", accessibleCylinderIds: ["diluent-cylinder", "surface-bailout-cylinder"] }] };
  const r6 = calculateCavePlan(cave);
  out.caveCcrLegacy = hash(r6.ok ? { base: digest(r6.value.base), scenarios: r6.value.scenarios.map((s) => ({ ...s, plan: digest(s.plan) })), turn: r6.value.turnPressureBar, margin: r6.value.reserveMarginL, limit: r6.value.limitingResource } : r6);
  // Explicit CCR-to-CCR events on a legacy input under the Shearwater preset (5 s switch):
  // the switch segment keeps the 0.1.0 exposure on the new setpoint.
  const eventDiluent = { ...AIR, id: "dil", role: "diluent" as const };
  const eventInput: CcrDiveInput = { mode: "ccr", environment: "open-water", depthM: meters(30), bottomTimeSeconds: seconds(24 * 60), diluent: eventDiluent, setpointBar: barAbsolute(1.2), setpointActivationDepthM: meters(6), bailoutGases: [{ ...AIR, id: "bo", role: "bailout" }], cylinders: [], settings: { ...DEFAULT_PLANNER_SETTINGS, conventionId: "shearwater-petrel3-v103-compatible-v1" }, environmentSettings: DEFAULT_ENVIRONMENT, rmv: DEFAULT_RMV, reservePolicy: DEFAULT_RESERVE_POLICY };
  const events: ExposureEvent[] = [
    { id: "descent", kind: "descent", startDepthM: meters(0), endDepthM: meters(30), durationSeconds: seconds(6 * 60), gas: eventDiluent, strategy: { kind: "ccr", diluent: eventDiluent, setpointBar: barAbsolute(0.7) } },
    { id: "bottom", kind: "bottom", startDepthM: meters(30), endDepthM: meters(30), durationSeconds: seconds(24 * 60), gas: eventDiluent, strategy: { kind: "ccr", diluent: eventDiluent, setpointBar: barAbsolute(1.2) } },
  ];
  const r7 = calculateEventDivePlan(eventInput, events); out.eventCcrShearwater = hash(r7.ok ? digest(r7.value) : r7);
  expect(out).toEqual({
    ocTrimix: "d1a70220",
    ocAir: "c92c4bef",
    ccrLegacy: "06f9b48e",
    draftOc: "2ecdc3b8",
    draftCcrLegacy: "043fd4da",
    caveCcrLegacy: "fff4643c",
    eventCcrShearwater: "c6c1b827",
  });
});
