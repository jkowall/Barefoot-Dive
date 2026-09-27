# Profile exposure traces — contracts

**Status:** drafted for scientific review; **not** an implementation authorization.  
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
