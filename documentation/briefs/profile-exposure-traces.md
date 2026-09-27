# Brief: Continuous exposure traces on the calculated profile scrubber

- **Source:** product direction after Cave timeline work. Extend the existing Plan/Cave/Saved Plan profile scrubber with continuous traces (cylinder pressure, GF, tissues, PPO₂, CNS), not a one-off UI formula. Roadmap Later item 5 under open-water planning depth.
- **Status:** contracts drafted in [`documentation/profile-exposure-traces.md`](../profile-exposure-traces.md) (`barefoot-profile-traces-v1`); **not** ready to implement until Sol (or equivalent) records a read-only review of that note. No silent clamping of unsafe values.
- **Suggested branch:** `cursor/profile-exposure-traces`, from `main` after Cave timeline lands if that PR touches shared profile UI; otherwise from latest `main`.
- **Order:** after Cave distance-axis timeline if both are open and share `src/ui` profile components; otherwise independent. Do not start coding until contracts §1–§5 in [`profile-exposure-traces.md`](../profile-exposure-traces.md) have a recorded Sol review.

Read `AGENTS.md` first. It is binding, including scientific invariants, branded units, and the rule that motion must not animate safety-critical numbers. Analyzer readings, manufacturer limits, and a dive computer remain authoritative.

## Intent

At any scrub position on an already-calculated plan, show continuous (or densely sampled) decision-support traces derived from the same production exposure path the planner used—not reconstructed ad hoc in React.

First ship order (each may be a separate PR after contracts review):

1. Ambient PPO₂ (and CCR commanded setpoint where applicable) along the profile
2. Stepwise controlling GF / endpoint ceiling already implied by emitted checkpoints (continuous tissue ceiling is deferred — see the design note §3)
3. Per-cylinder remaining pressure (gauge) for open-circuit / bailout ledgers already integrated by `src/gas`
4. CNS clock (and later OTU) only after planner accumulation exists as a versioned production function

Onboard CCR O₂ / diluent pressure appears **only** if a separate CCR onboard-gas scope decision and brief authorize it.

## Required contracts before code

Normative draft: [`documentation/profile-exposure-traces.md`](../profile-exposure-traces.md) (also linked from `calculation-model.md`):

1. **Inputs:** which DivePlan / event / ledger fields are authoritative; no display-unit inputs.
2. **Sampling:** event endpoints (+ reserve crossings); optional dense Δt stamped in the method.
3. **Interpolation:** which quantities may be linear vs recomputed with production functions.
4. **Versioning:** method id + engine/convention stamps; v1 recomputes on open and does not snapshot traces into Saved Plans.
5. **Diagnostics:** structured failures when a trace cannot be built; never invent a flat line.

## UI requirements (after contracts review)

- Extend the existing scrubber readout; do not add decorative gauges.
- Trace toggles are session-local; default to PPO₂ + controlling ceiling/GF only.
- Tabular monospace for measured values; tokens only; honor `prefers-reduced-motion`; never tween the numeric readout.
- Keyboard and screen-reader parity with today’s scrubber.

## Out of scope

- Changing ZH-L16C coefficients, GF scheduling, or bailout transfer semantics without a separate protected-area brief.
- Claiming MultiDeco / Shearwater / dive-computer parity.
- Cave route timeline (shipped; `CaveRouteTimeline` / `caveTimeline.ts`).
- CCR onboard gas modeling.

## Owned paths (expected once unblocked)

- Pure trace builder(s) under `src/engine` and/or `src/gas` / `src/calculations` as the contracts dictate
- `src/ui` profile chart model + presenters
- Planner/Tool parity tests and reference fixtures proportional to safety impact
- Docs: `calculation-model.md`, `profile-exposure-traces.md`, `reference-validation.md`, `tests.md`, `CHANGELOG.md`
- Visual baselines for Plan/Cave scrubber cases

## Verification (when implementing)

```bash
npm run check
npm run verify:deco
npm run verify:exposure
npm run verify:gas   # if cylinder-pressure traces ship
npm run test:ui
npm run test:visual
```

Plus an independent scientific read-only review of the contracts and the first shipped trace.

## Git and pull request

- Sign commits; one PR per trace family if that keeps review tractable.
- Delete this brief in the PR that completes the first shipped trace family **or** replace it with a thinner follow-on brief listing remaining traces.
- Merging stays with Jonah.
