# Profile exposure traces — contracts

**Status:** reviewed on 2026-09-30, outcome **REVISE** (see [Review record](#review-record)); **not** an implementation authorization. Implementation stays blocked until this note is amended as the record requires and the CCR loop-PPO₂ decision (checklist item 2) is made and re-reviewed.\
**Source brief:** [`briefs/profile-exposure-traces.md`](briefs/profile-exposure-traces.md) (ROADMAP Later item 5).  
**Method id (proposed):** `barefoot-profile-traces-v1`.

These contracts define how continuous (or densely sampled) decision-support traces may be derived for the existing Plan / Cave / Saved Plan profile scrubber. They do **not** change ZH-L16C coefficients, GF scheduling, CCR bailout transfer, or gas-integration semantics. Analyzer readings, manufacturer limits, a dive computer, and qualified-diver review remain authoritative. Passing tests or green CI does not establish decompression safety or dive-computer parity.

Linked from [`calculation-model.md`](calculation-model.md). Implementation must not start until a Sol (or equivalent) read-only review of this note is recorded.

---

## Current scrubber baseline (unchanged until a trace PR)

- Geometry and interaction: `src/ui/profileChartModel.ts`, `src/ui/ProfileChart.tsx`.
- Adapters: `profileSegments()` / `profileReserveCrossings()` in `src/app/PlanResultView.tsx` (primary, CCR bailout, Cave base/scenario, reopened Saved Plan).
- Today the readout shows the active emitted segment’s phase, gas, plan mode, setpoint, and **endpoint** ceiling, plus linearly interpolated **planned depth** only.
- Architecture and flows already state that continuous cylinder pressure, GF, tissue, PPO₂, and exposure state are outside the graph contract. Trace builders must live in pure modules (`src/engine`, `src/gas`, `src/calculations`, and/or a dedicated pure helper), not in React.

---

## §1 Inputs

### Units

Canonical only: metres, seconds, bar absolute (ambient, PPO₂, setpoints, tissues), bar gauge (cylinder), bar delta (consumption), surface litres, litres per minute, fractions 0–1. Display conversion (ft, PSI, rated ft³) happens only at the UI boundary and must not feed the builder.

### Authoritative sources

| Source | Role |
| --- | --- |
| `DivePlan.segments` (`ProfileSegment`) | Time, depth endpoints, gas id/name, optional `setpointBar`, applied `gf`, endpoint `ceilingDepthM`, `tissuesAfter` |
| `DivePlan.gasLedger` (`GasLedgerEntry`) | Per-gas/cylinder aggregates, optional `reserveCrossing`, cylinder context |
| `DivePlan.metadata` | `engineVersion`, model id, convention id — stamp every trace result |
| `DivePlanInput` (and Saved Plan `normalizedInputSnapshot`) | Gas mixes, environment, RMV, cylinders — required to recompute PPO₂ and pressure series |
| Production helpers | `gasPPO2`, tissue/ceiling functions, `calculateGasLedger` (and any new pure sample API that reuses its integration) |

Do **not** treat chart display depths, UI-interpolated values, or Tool session drafts as inputs.

### Plans in scope

The same scrubber surfaces as today:

1. Primary open-circuit and CCR `DivePlan`
2. Nested `DivePlan.bailoutPlan` when shown
3. Cave base and selected scenario plans (each is a `DivePlan` passed through `PlanResultView`)

Gas-only plans (no cylinder assignment) may produce PPO₂ / ceiling traces but **must not** claim a cylinder-pressure series.

### Per-quantity inputs

**Ambient / inspired PPO₂ (first ship)**

- **OC (and OC bailout segments):** `gasPPO2(gas, depthM, environment)` from the segment’s gas at the sample depth. Gas composition comes from the plan input / resolved gases keyed by `gasId`, not from display labels.
- **CCR loop segments with `setpointBar`:** the authoritative commanded value is `ProfileSegment.setpointBar` (bar absolute). The first-ship PPO₂ readout for those samples is that setpoint (held for the segment), not a reconstructed diluent metabolism. Modeled loop inert / achievable PPO₂ may be added only under a later method revision after Sol review of `inertInspiredPressure` semantics.
- **CCR segments without setpoint** (open-circuit style bailout legs on the bailout plan): treat as OC using the segment gas.

**Controlling GF / ceiling (first ship)**

- Authoritative emitted checkpoints: each segment’s endpoint `ceilingDepthM` and applied `gf`.
- `tissuesAfter` is authoritative tissue state **at the segment end**.
- Controlling compartment id is **not** currently emitted on `ProfileSegment`. First ship must not invent one in the UI. A later revision may extend the emitted plan or recompute via `calculateCeiling()` at sample points; that is a protected-area-adjacent change and needs explicit Sol approval.

**Per-cylinder remaining pressure (gauge)**

- Authoritative cylinder context: `GasLedgerEntry` rows with `cylinderId`, `cylinderWaterVolumeL`, `startingPressureBar`, and volumes produced by `calculateGasLedger`.
- Aggregate ledger endpoints alone are **not** a pressure-vs-time series. A continuous pressure trace must reuse production gas integration (today’s internal consumption path is discarded after aggregation). Implementation may expose a pure sample/integration API in `src/gas`; it must not duplicate formulas in `src/ui`.
- Unassigned / ambiguous cylinder rows, `gasOnly` entries, and normal CCR loop consumables (unmodeled) produce **no** pressure series for that identity.
- Onboard CCR O₂ / diluent cylinder pressures remain out of scope until a separate brief authorizes them.

**CNS / OTU**

- Not in scope for `barefoot-profile-traces-v1`.
- Tools `calculateCNS({ ppo2Bar, durationSeconds })` is a **constant-PPO₂** single-exposure helper, not a planner accumulator. It must not be summed per scrub pixel or per arbitrary Δt as a substitute for a versioned timeline accumulator.
- OTU has no production function yet. CNS and OTU ship only after a dedicated production accumulation contract and Sol review.

---

## §2 Sampling

### Sample set definition

A trace sample is a canonical runtime `t` (seconds from plan start) at which every enabled series is evaluated or marked unavailable.

**Required samples (all first-ship series):**

1. Every `ProfileSegment` start runtime  
2. Every `ProfileSegment` end runtime  
3. Every `GasLedgerEntry.reserveCrossing.runtimeSeconds` when present  

**Zero-duration segments** (gas-switch, setpoint-switch, and similar): exactly one sample at that runtime; they still define stepwise gas/setpoint changes.

**Positive-duration segments** (descent, bottom, ascent, stop, penetration, exit, bailout): both endpoints are required. Interior samples:

- **Endpoint-only mode:** no interior samples (polyline connects required samples only).  
- **Dense mode (optional, method-stamped):** fixed Δt in canonical seconds. Proposed default for dense mode: **Δt = 1 s**, aligned so that every required sample above is included exactly (do not skip a boundary because it falls between ticks).

First-ship builders may implement endpoint-only mode only. Dense mode, if added later under the same method id, must be documented here with the Δt before use.

### Coverage rules

- Ascents and stops are ordinary positive-duration segments; both endpoints are samples.  
- The final plan endpoint belongs to the final segment (same half-open interval rule as `findActiveSegment`).  
- Samples are computed in canonical units; the UI converts for display.

---

## §3 Interpolation and recomputation

Rule of thumb: **do not linearly interpolate a safety-critical quantity unless this table says the linear form is an explicit display approximation of emitted checkpoints.** Prefer production recomputation at each sample.

| Quantity | Between emitted points | Notes |
| --- | --- | --- |
| Planned depth | Linear in time within the active segment | Existing display contract (`interpolatePlannedDepth`); not a physiological claim |
| OC PPO₂ | **Recompute** `gasPPO2` at sample depth (depth may be linearly interpolated for the depth argument only) | Do not linearly interpolate PPO₂ itself |
| CCR commanded setpoint | **Step hold** of `setpointBar` for the active segment | Change only at segment boundaries / setpoint-switch samples |
| Endpoint ceiling / applied GF (first ship) | **Step hold** of the **previous segment end** checkpoint until the next segment end | Readout must label this as endpoint-checkpoint / held, not “continuous tissue ceiling.” Continuous recomputed ceiling from tissue replay is a later revision |
| Tissue compartment pressures | **No linear interpolation** for decision support | Use `tissuesAfter` only at the segment end sample that owns them, or recompute via production tissue update in a later revision |
| Cylinder remaining pressure | **Recompute** with production gas integration along the profile | Linear pressure between ledger endpoints is forbidden as an authoritative series |
| CNS / OTU | N/A until accumulator exists | — |

### Continuous ceiling (deferred)

A scientifically meaningful continuous ceiling during a held stop can deepen without a new segment boundary. First ship therefore uses stepwise endpoint ceilings only. A later method revision may:

1. Replay tissue kinetics and `calculateCeiling()` at dense samples from the correct prior tissue state, or  
2. Emit richer checkpoints from the planner  

Either path needs Sol review and must not silently appear under `barefoot-profile-traces-v1` without updating this note.

---

## §4 Versioning and Saved Plans

### Trace result identity

Every successful or failed pure builder result carries:

- `methodId`: `barefoot-profile-traces-v1` (or a later bumped id when semantics change)  
- `engineVersion` and convention id copied from `DivePlan.metadata`  
- The plan id / revision identity used as input  

### Persistence choice (decided for v1)

**Recompute on open; do not snapshot trace payloads into `SavedPlanRecord`.**

Rationale: Saved Plans already snapshot the full `DivePlan` and normalized input; recalculation already creates a new revision with lineage. Omitting traces from storage avoids a schema migration for an experimental display layer and keeps historical revisions free of stale series when method semantics improve.

On open or Review:

1. Build traces from the stored `calculatedPlan` (+ normalized input / resolved cylinders when recomputation needs them).  
2. If the stored engine/convention cannot support a requested series under this method, return §5 diagnostics for that series — do not substitute another method’s values silently.  
3. Explicit recalculation remains the path that produces a new plan revision; traces then rebuild from the new plan.

### If a future revision snapshots traces

That revision must:

- Bump storage schema or add an optional versioned envelope  
- Stamp method + engine + convention on the payload  
- Preserve immutable historical revisions (new revision or omit traces on old records)  
- Add codec tests for older envelopes  

Until then, UI session state may cache a rebuilt trace for the current matching result only (session-local, like Tool results).

---

## §5 Diagnostics

### Hard rules

- Never invent a flat line, zero series, or “safe” placeholder when a series cannot be built.  
- Never silently clamp PPO₂, pressure, or ceiling into a valid range to keep the chart pretty.  
- Never show onboard CCR O₂/diluent pressure under this method.  
- Motion must not tween safety-critical numeric readouts; honor `prefers-reduced-motion`.

### Failure model

Return structured `Diagnostic` values (or a typed trace-series status that maps to them) with stable codes, for example:

| Situation | Severity | Behavior |
| --- | --- | --- |
| Empty segments / missing plan metadata | error | No traces |
| Gas id on a segment cannot be resolved for PPO₂ | error for PPO₂ series | Other series may still build |
| Sample depth/gas yields validation failure from `gasPPO2` | error/warning per existing validation | Mark sample or series unavailable |
| Cylinder pressure requested for gas-only / unassigned / ambiguous cylinder | warning or error on that series | Omit that series |
| Dense or recompute path fails mid-profile | error on that series | Do not fill the remainder with interpolation |
| CNS/OTU requested under v1 | error | Series absent; point at missing accumulator |

Partial success is allowed: e.g. PPO₂ and stepwise ceiling succeed while cylinder pressure fails. The scrubber readout must show which series are active and which failed, in plain language, so an unavailable series cannot be read as zero exposure or full cylinders.

---

## First-ship UI binding (non-normative to the science; follows the brief)

After Sol review and an implementation PR:

- Extend the existing scrubber readout; no decorative gauges.  
- Session-local toggles; default **PPO₂ + stepwise endpoint ceiling/GF** only.  
- Cylinder-pressure toggle optional once §1–§3 gas path exists.  
- Tabular monospace for measured values; tokens only.  
- Keyboard and screen-reader parity with today’s scrubber.

---

## Review checklist for Sol

1. OC PPO₂ via `gasPPO2` at interpolated depth — acceptable for decision support?  
2. CCR first-ship “PPO₂” = commanded `setpointBar` step-hold — acceptable labeling?  
3. Stepwise endpoint ceiling (not continuous tissue ceiling) — acceptable for v1 with clear labeling?  
4. Cylinder pressure only via production gas integration — confirm no endpoint-linear shortcut.  
5. CNS blocked until a planner accumulator exists — confirm.  
6. Recompute-on-open, no Saved Plan trace snapshot — confirm.  
7. Any additional diagnostics or plan kinds to exclude (e.g. unsafe plans)?

Record the review outcome (approve / revise) before coding. Implementation PRs cite this note and the method id.

---

## Review record

**2026-09-30 · outcome REVISE.** Independent read-only review by Claude (Fable model) against `ee16534` (app 0.8.0, `barefoot-dive-engine-0.4.0`), with scratch probes only; no repository file was changed by the review. The structure holds (pure builders, structured diagnostics, no Saved Plan snapshot, CNS blocked), but §1 and §3 misstate what engine 0.4.0 emits for CCR PPO₂, a single held ceiling value understates the ceiling, and the cylinder-pressure and recompute-on-open rules need consistency checks before code starts.

| Item | Outcome | Required |
| --- | --- | --- |
| 1. OC PPO₂ via `gasPPO2` | Accept with conditions | The signature is `gasPPO2(gas, depthM, input: DivePlanInput): number` (`src/domain/validation.ts`), not `(gas, depthM, environment)`. It is FO₂ × ambient pressure with no water-vapor term, the same basis as MOD, switch, and hypoxic checks. Label it "PPO₂ (FO₂ × ambient)", not "inspired", and brand it `BarAbsolute` in the builder. |
| 2. CCR PPO₂ as the segment's `setpointBar`, held | **Reject as written** | New CCR plans opt into the ambient-limited ascent (`src/app/planning.ts`). On a leg above the held setpoint's achievable depth, the segment keeps the held value while the tissue model limits inspired inert pressure to ambient minus water vapor minus the setpoint (`src/engine/tissues.ts`), so the loop PPO₂ falls through the leg. A probe (45 m for 30 min, setpoint 1.30 bar, seawater) shows a 3.6 to 0 m segment carrying 1.30 bar while the achievable loop PPO₂ falls to 0.94 bar: a step-hold overstates by up to 0.36 bar. Cave exit legs record the opposite end, the value achievable at the shallow end (`displaySetpointBar` in `src/engine/planner.ts`), so a step-hold understates there. Required: per-sample loop PPO₂ = `ambientLimitedSetpoint(heldHigh, depth, environment)` (`src/domain/validation.ts`), with the commanded setpoint shown separately. **Decision needed:** either the planner emits an optional held setpoint (for example `heldSetpointBar`) on `ProfileSegment`, an additive field with codec and back-read tests, or ambient-limited legs show "loop PPO₂ unavailable" with a diagnostic. Deriving the held setpoint from the input in the builder would re-implement planner rules and is not approved. |
| 3. Stepwise endpoint ceiling | Accept with conditions | Holding one checkpoint understates the ceiling through descent, bottom, and penetration segments, and through the early part of each ascent. Show a two-checkpoint bracket in the readout: the previous segment's `ceilingDepthM` as start, this segment's as end, both labeled "checkpoint, not computed between". A ceiling at or below `EPSILON` reads "no ceiling", as today. Plot no staircase (design.md; CHANGELOG 0.2.1). The emitted `gf` is the GF at the segment's end checkpoint (event plans use GF low for every route event), so label it "GF at checkpoint". Recomputing `calculateCeiling(segment.tissuesAfter, segment.gf, environment)` at the end sample is approved as a self-check that also names the controlling compartment; samples between checkpoints remain unapproved. |
| 4. Cylinder pressure through production integration only | Accept with conditions | `ConsumptionRecord`, `consumptionFractionAtTime`, and `crossingFraction` are private to `src/gas/ledger.ts` and discarded after aggregation. A cumulative series matches `reserveCrossing.expectedPressureBar`, timed bailout-SAC slices, problem-solving holds, the first-stop and bottom/deco boundaries, and dil-out deductions only if it consumes the same record list. Required: an exported sibling of `calculateGasLedger` that returns the records plus cumulative volume (one writer in the protected gas area, `npm run verify:gas`, no formula outside `src/gas`). The diluent bailout series starts at `startingVolumeL / cylinderWaterVolumeL`, not `startingPressureBar`, and pre-trigger diluent pressure is unavailable. Remaining pressure is not clamped in the ledger: end the series where the cylinder is empty, with a `CYLINDER_EXHAUSTED` diagnostic; never draw negative gauge pressure or clamp to zero silently. |
| 5. CNS blocked | Confirmed | `calculateCNS` is a constant-PPO₂ NOAA single-exposure helper (0.6 to 1.6 bar); no planner accumulator exists. A future accumulator must use the item 2 loop PPO₂, not `setpointBar`. |
| 6. Recompute on open, no snapshot | Accept with conditions | The ledger options the planner used (bottom-end runtime, bailout start runtime, problem-solving hold, dil-out) are not stored on `DivePlan` or `SavedPlanRecord`. PPO₂ and ceiling traces use stored segments, gases, and environment only. A pressure trace rebuilds its records and must reproduce the stored per-cylinder `totalUsedL`, `remainingVolumeL`, and `reserveCrossing.runtimeSeconds` within 1e-6; otherwise it returns `TRACE_LEDGER_MISMATCH`, omits the series, and suggests Recalculate. For a revision whose `engineVersion` differs from the current engine, the check is mandatory and the readout names the stored engine version. |
| 7. Exclusions and flags | Required list | Unsafe plans: traces allowed, the readout carries the status. Gas-only plans: no pressure. CCR primary loop segments: a gap in pressure, never a flat line (legacy open-circuit diluent legs may show). Bailout plans: cylinders full before the trigger, dil-out diluent unavailable before it. `BAILOUT_RMV_SWITCH_REQUIRED`: the pressure series carries the error or is omitted. Cave: a scenario's plan is optional, scenario ledgers start at the loop-failure trigger, base-plan traces are never labeled as turn limits, and the experimental label stays. Older-engine revisions: item 6. Hypoxic and `oxygen-at-20ft-stop-v1` segments: show the unclamped PPO₂ with its diagnostic. |

Further changes to this note:

- **§1 Authoritative sources:** correct the `gasPPO2` signature and name the two PPO₂ bases the readout must distinguish: FO₂ × ambient for open circuit, and the CCR loop maximum, which subtracts water vapor.
- **§1 CCR:** rewrite per item 2, and add `ascentSetpointMode` to the inputs.
- **§1 Cylinder context:** the series origin is `startingVolumeL` and `preBailoutDeductionL`, not `startingPressureBar`, which is the pressure before a dil-out deduction.
- **§2 Sample set:** key samples by runtime and segment id in emission order, because several segments share a runtime (a gas switch and a bailout segment; a Cave setpoint switch and the first penetration leg), so steps are not deduplicated away.
- **§3 Continuous ceiling (deferred):** the ceiling normally shallows during a stop; it deepens inside descent, bottom, and penetration segments. Restate so the item 3 bracket is motivated correctly.
- **§4 Trace identity:** also stamp `conventionVersion`, `coefficientHash`, and `assumptionsHash`, which distinguish revisions with the same engine string.
- **§5 Failure model:** add `TRACE_LEDGER_MISMATCH`, `CYLINDER_EXHAUSTED`, and a "loop PPO₂ unavailable on ambient-limited leg" code, plus the rule that a rebuilt pressure series that does not reproduce the stored `reserveCrossing` is discarded, not shown.

Next: amend this note, decide item 2, and have the same reviewer recheck the amended sections. The shipped scrub readout already shows the segment's `setpointBar` as "Setpoint", so on ambient-limited legs it can differ from the loop PPO₂ in the way item 2 describes; the item 2 decision should cover that readout too.
