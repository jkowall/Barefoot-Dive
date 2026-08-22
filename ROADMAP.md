# Barefoot Dive roadmap

This roadmap starts from the `0.1.0` build candidate. It describes priority and dependency order, not delivery dates or a claim of field readiness. Calculation breadth does not substitute for independent validation, and no item changes the analyzer-first, qualified-diver-review boundary.

## Status

- **Current**: implemented in this checkout and covered by the present automated gates.
- **Next**: validation and product work required before considering a broader beta or stronger capability claim.
- **Later**: post-validation product expansion.
- **Conditional**: begins only after a separate product and security decision.

## Current: `0.1.0` initial goal

- Unit-safe ZH-L16C/GF engine, OC and constant-setpoint CCR planning, exact-trigger OC bailout, travel/deco/diluent/bailout gases, gas ledgers, and reserve crossings.
- Real OC/CCR cave route context with accessible cylinders, stage drop/recovery, gas-derived turn constraints, and required failure scenarios.
- Tank Bank, immutable Saved Plan revisions, all eleven Tools calculators, responsive offline PWA, and iOS/Android shells.
- Representative DecoTengu and pinned Abysner comparison coverage with known input and schedule-distribution differences documented.
- Experimental compatibility presets for Barefoot, Shearwater Petrel 3, and MultiDeco conventions.
- Task-oriented Gas & depth, Consumption & cylinders, and Emergency & exposure Tools categories; focused responsive workspaces; ephemeral per-session inputs; Tank Bank snapshot/manual-detachment; and narrow, explicit Plan patches. Emergency Gas remains an entered-schedule check, not a generated decompression/bailout plan; OC cylinder context is optional and CCR cylinder context is required.

The current build is not a field-validated planner. Its web deployment is an experimental build for evaluation; cave planning and named compatibility presets remain experimental. Normal CCR oxygen metabolism and diluent/loop consumption are explicitly not modeled yet.

The Tools redesign is implemented with focused UI, debounced live Emergency results, exact-input result suppression, Tank Bank snapshots, exact patches, policy versions, SAC dual modes, unit presentation, and pressure-semantics regression coverage. The committed source-backed Tools fixtures establish their stated formula arithmetic only; qualified review and broader independent planner, reserve, CNS, and cave vectors remain required before safety or compatibility claims.

## Next: validation and release confidence

These items take priority over adding more planner breadth.

| Work | Intended outcome | Exit evidence |
| --- | --- | --- |
| Expand decompression reference vectors | Cover air, nitrox, trimix, CCR, bailout, multiple GF pairs, fresh/salt water, and altitude | Versioned inputs, independently sourced expected results, tolerances, and documented discrepancy decisions |
| Validate gas, reserves, and oxygen exposure | Independently check integrated consumption, rock bottom/team reserve, thirds/sixths, reserve crossings, CNS, and unit conversions | Committed positive and failure vectors with reviewer/source identity |
| Add normal CCR consumables | Model configurable oxygen metabolism plus diluent/ADV/flush use without inferring them from OC RMV | Per-cylinder ledgers, reserve/remaining pressure, failure diagnostics, persistence migration, and independent fixtures |
| Qualify cave semantics | Review turn pressure, thirds/sixths, team reserve, stage access, scooter failure, lost-gas/lost-buddy, and CCR bailout behavior | Named qualified cave-diver review, committed scenario vectors, and no unresolved critical/high audit findings |
| Define compatibility status | Separate a settings preset from actual planner or firmware parity for each named convention | Pinned product/firmware versions, exact comparison inputs, result tolerances, and an explicit validated/partial/experimental label |
| Harden release evidence | Repeat web, offline, migration, accessibility, visual, Android, iOS, and dependency gates from a frozen revision | Reproducible release report and an explicit go/no-go decision; web hosting does not authorize signing or store submission |

## Later: open-water planning depth

1. Arbitrary multi-level open-water profile editing using the existing exposure-event model.
2. Repetitive dives and explicit surface intervals with serializable tissue-state lineage.
3. General `+5 minutes` and lost-gas comparison plans.
4. Maximum-realistic-bottom-time reverse solver outside cave mode.
5. Runtime profile scrubbing with depth, active gas, expected cylinder pressure, ceiling, GF state, and tissue state at each point.

Gate: every edited or derived profile must be deterministic, unit-safe, snapshot-compatible, and covered by planner/Tool parity and migration tests.

## Later: CCR and exposure expansion

1. Multiple automatic or manually scheduled CCR setpoint transitions.
2. OTU calculation and display from the same exposure timeline used by CNS.
3. Independently validated IBCD methodology, only after its model, applicability limits, and reference evidence are agreed.

Gate: no physiology or exposure feature ships from an isolated UI formula; it must use a versioned production function, structured diagnostics, and independent fixtures.

## Later: advanced cave planning

1. Complex branching routes and alternate exits.
2. Cave survey or map import with an explicit, inspectable route transformation.
3. Multiple teams and team-specific accessible-gas state.
4. Richer scooter range, tow, failure, and contingency modeling.
5. Combined failures only where the state transformation and reserve semantics can be reviewed deterministically.

Gate: cave results remain visibly experimental until the new route and reserve semantics receive qualified cave-diver review and committed failure vectors.

## Conditional: connected product capabilities

Cloud sync, shared plans, collaboration, accounts, a backend, analytics, subscriptions, device linking, signing, store submission, and additional deployment channels are not assumed roadmap commitments. Each requires a separate request plus privacy, security, data-migration, offline-conflict, and operating-cost decisions.

## Acceptance rule for every roadmap item

A calculation or planning capability is not complete until it has:

1. Canonical unit-safe domain types and pure production functions.
2. Explicit validation and structured, location-aware diagnostics.
3. Negative tests, invariants, and independently sourced reference fixtures proportional to its safety impact.
4. Planner/Tool parity where the same formula appears in more than one workflow.
5. Immutable saved-input, equipment, result, engine-version, and convention-version semantics with a migration path.
6. Responsive and accessible UI coverage plus updated architecture, flow, test, and validation documentation.
7. A frozen-tree safety review with no unresolved critical or high findings.
