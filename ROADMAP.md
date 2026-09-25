# Barefoot Dive roadmap

This roadmap starts from the `0.5.1` evaluation build. It describes priority and dependency order, not delivery dates or a claim of field readiness. Calculation breadth does not substitute for independent validation, and no item changes the analyzer-first, qualified-diver-review boundary.

Barefoot Dive remains an offline-first, client-only product. Calculations and persistence stay on the device; a backend or remote calculation service is not part of this roadmap.

## Status

- **Current**: implemented in the repository with automated coverage; the applicable gates must still be rerun for any candidate revision.
- **Next**: validation, qualified evaluation, and scope decisions required before broader use or a stronger capability claim.
- **Later candidate**: possible post-validation work, not a commitment. It requires evidence of user need and an explicit decision to start.
- **Out of scope**: not planned and not a hidden prerequisite for any Current, Next, or Later candidate work.

## Current: `0.5.1` evaluation build

- Unit-safe ZH-L16C/GF engine, OC planning, CCR decompression/exposure with a low setpoint from the surface and a high setpoint below separate switch-up and switch-down depths, exact-trigger-state CCR bailout to open circuit, dil-out, travel/deco/diluent/bailout gases, and OC/CCR-bailout gas ledgers with reserve crossings.
- Engine 0.3.0: every ascent leg re-checks its arrival ceiling, and new open-water OC plans charge the bottom RMV until the first stop, with a Setup switch back to the original deco-RMV-from-end-of-bottom rule.
- Gas-only open-water planning with per-gas minimum volumes to carry, and bailout surface/coverage checks plus mid-leg switches that keep open-circuit ascents breathable.
- Experimental cave route context with accessible cylinders, stage drop/recovery, gas-derived OC turn constraints, CCR bailout-derived limits, and required failure scenarios.
- Tank Bank, immutable Saved Plan revisions, all eleven Tools calculators, responsive offline PWA, and iOS/Android shells.
- Tank Bank integrity: invalid stored cylinders are quarantined one record at a time, and Plan and Cave stop instead of calculating while a gas's Tank Bank cylinder is unavailable or selected for another gas.
- Representative DecoTengu and pinned Abysner comparison coverage with known input and schedule-distribution differences documented.
- Experimental compatibility presets for Barefoot, Shearwater Petrel 3, and MultiDeco conventions.
- Task-oriented Gas & depth, Consumption & cylinders, and Emergency & exposure Tools categories; focused responsive workspaces; ephemeral per-session inputs; Tank Bank snapshot/manual-detachment; and narrow, explicit Plan patches. Emergency Gas remains an entered-schedule check, not a generated decompression/bailout plan; OC cylinder context is optional and CCR bailout-cylinder context is required.
- Time-accurate interactive profile graphs across primary, CCR bailout, Cave base/scenario, and stored base-plan results, with runtime/depth axes, emitted phase/decompression bands, switch and reserve markers, endpoint ceiling checkpoints, and mouse, touch, and keyboard scrubbing.

The current build is not a field-validated planner. Its web deployment is an experimental build for evaluation; cave planning and named compatibility presets remain experimental.

Current CCR scope covers decompression/exposure scheduling and exact-state bailout planning. Metabolic oxygen consumption and diluent use for descent, ADV operation, flushes, or loop-volume loss are not modeled. Barefoot Dive therefore makes no claim about remaining onboard oxygen or diluent pressure, reserve, or sufficiency.

The Tools redesign is implemented with focused UI, debounced live Emergency results, exact-input result suppression, Tank Bank snapshots, exact patches, policy versions, SAC dual modes, unit presentation, and pressure-semantics regression coverage. The committed source-backed Tools fixtures establish their stated formula arithmetic only; qualified review and broader independent planner, reserve, CNS, and cave vectors remain required before safety or compatibility claims.

## Next: validation and scope decisions

These items are listed in priority order and take precedence over adding planner breadth.

| Work | Intended outcome | Exit evidence |
| --- | --- | --- |
| Evaluate current workflows with qualified divers | Confirm through dry-run or side-by-side planning that square-profile planning, CCR bailout, Tools, Saved Plans, and experimental Cave workflows are understandable and useful before expanding them | Structured observations, critical-task failures, and explicit keep/change/defer decisions for Later candidates; this is product evidence, not authorization to use Barefoot Dive as a sole planner underwater |
| Decide the CCR onboard-gas promise | Choose whether CCR remains decompression/exposure plus bailout only or should later estimate onboard oxygen and diluent sufficiency | A written scope decision informed by qualified CCR evaluation, with UI and documentation aligned to the chosen boundary |
| Decide the cave scope | Decide whether the implemented experimental CCR cave/bailout-derived behavior remains in scope alongside OC cave planning | An explicit OC/CCR scope decision before investing in further cave qualification or expansion |
| Decide the named-preset strategy | Choose whether each compatibility-named preset stays explicitly experimental, loses the external product name, or enters a formal validation effort | A keep/rename/remove/validate decision for every preset; any validation path identifies pinned product/firmware versions and comparison evidence |
| Expand decompression reference vectors | Cover air, nitrox, trimix, CCR, bailout, multiple GF pairs, fresh/salt water, and altitude | Versioned inputs, independently sourced expected results, tolerances, and documented discrepancy decisions |
| Decide gradient-factor anchoring after a deepened first stop | Since engine 0.2.1 the arrival re-check can move the first stop deeper, which anchors the gradient-factor line deeper and can shorten the shallow stops (by up to 55 minutes in exploratory comparisons). Decide whether to keep Baker's first-stop anchor, or to anchor at the ceiling-derived stop and hold GF low below it so the re-check only adds time | A written decision with its output impact documented, independent vectors covering the arrival re-check, and scientific review |
| Decide stop-hold ceiling transients | Decide whether the scheduler looks ahead through a stop, or emits a warning with the largest excess and the gradient factor reached, when the ceiling deepens past a held stop after a switch from a nitrogen-rich loop to a lean, helium-heavy bailout gas (up to 7.0 m in exploratory comparisons). Decide it together with anchoring, because a look-ahead deepens first stops | A scheduler or diagnostic change with its output impact documented, independent bailout vectors, and scientific review |
| Decide the remaining gas-accounting phases | Engine 0.3.0 charges the open-circuit climb to the first stop at the bottom RMV when a plan opts in. Decide whether the moves between stops should also use the bottom RMV, as the CCR bailout ledger does, and whether cave turn limits adopt the first-stop boundary | A written decision with its gas and turn-pressure impact documented, published or measured ascent-RMV evidence where available, and scientific review; cave adoption also needs qualified cave-diver review |
| Validate gas, reserves, and oxygen exposure | Independently check integrated consumption, rock bottom/team reserve, thirds/sixths, reserve crossings, CNS, and unit conversions | Committed positive and failure vectors with reviewer/source identity |
| Qualify retained cave semantics | Review OC turn pressure, thirds/sixths, team reserve, stage access, scooter failure, lost-gas/lost-buddy behavior, and any retained CCR bailout-derived limits | Named qualified cave-diver review, committed scenario vectors, and no unresolved critical/high audit findings |
| Harden release evidence | Repeat web, offline, migration, accessibility, visual, Android, iOS, and dependency gates from a frozen revision | Reproducible release report and an explicit go/no-go decision; web hosting does not authorize signing or store submission |

## Later candidates: open-water planning depth

1. Arbitrary multi-level open-water profile editing using the existing exposure-event model.
2. Repetitive dives and explicit surface intervals with serializable tissue-state lineage.
3. General `+5 minutes` and lost-gas comparison plans.
4. Constraint-driven maximum-bottom-time solver outside cave mode.
5. Extend the delivered emitted-data profile scrubber with separately calculated continuous cylinder-pressure, GF, tissue, PPO₂, CNS, or other exposure traces. This requires versioned production contracts and independent scientific review; onboard CCR oxygen or diluent pressure appears only if that capability is separately approved and implemented.

Entry gate: qualified evaluation shows that current square-profile planning is understood and that at least one candidate addresses a repeated planning need. Every edited or derived profile must be deterministic, unit-safe, snapshot-compatible, and covered by planner/Tool parity and migration tests.

## Later candidates: CCR and exposure expansion

- Independent vectors for the low/high setpoint switch schedule, dil-out bailout, and gas-only volumes, then a qualified CCR review of the 0.4.0 defaults (0.7/1.3 bar, 6 m switch-up and switch-down).
- Trigger bailout gas selection that respects the bottom PPO₂ limit (or a dedicated bailout PPO₂ limit); today it is flagged, not changed, because it alters exact-state bailout results.
- Planner CNS accumulation alongside OTU, from the same exposure timeline.

1. If the CCR onboard-gas decision supports it, estimate onboard oxygen use from a configurable metabolic rate plus explicit additions or losses, and diluent use from descent, ADV/manual-add, flush, and loop-loss assumptions. Define and version which values are profile-derived versus user-entered, attribute every use to an explicit cylinder, keep the calculation local, and never infer it from OC RMV.
2. More than two setpoints, or manually scheduled CCR setpoint transitions.
3. OTU calculation and display from the same exposure timeline used by CNS.
4. Independently validated IBCD methodology, only after its model, applicability limits, and reference evidence are agreed.

Entry gate: qualified CCR evaluation establishes a repeated need and the scientific model can be independently sourced. Onboard-gas accounting additionally requires separate oxygen and diluent ledgers, versioned assumptions and sources, reserve/remaining-pressure and insufficiency diagnostics, local snapshot migration, independent fixtures, and an explicit ideal-versus-real-gas model decision. No physiology or exposure feature ships from an isolated UI formula; it must use a versioned production function and structured diagnostics.

## Later candidates: advanced cave planning

1. Complex branching routes and alternate exits.
2. Cave survey or map import with an explicit, inspectable route transformation.
3. Multiple teams and team-specific accessible-gas state.
4. Richer scooter range, tow, failure, and contingency modeling.
5. Combined failures only where the state transformation and reserve semantics can be reviewed deterministically.

Entry gate: current cave semantics first pass qualified review, and observed planning sessions identify a repeated need for the selected candidate. Cave results remain visibly experimental until new route and reserve semantics receive qualified cave-diver review and committed failure vectors.

## Explicitly out of scope

The product boundary excludes a backend, server-side persistence, accounts or authentication, cloud sync, shared-plan collaboration, remote calculation services, analytics or tracking, subscriptions or payments, and device linking. Calculations, planning data, and persistence remain on-device. Static web hosting and native packaging do not change this boundary.

Changing this boundary would require replacing this roadmap through an explicit product decision plus privacy, security, data-migration, offline-conflict, and operating-cost analysis. No connected capability is authorized, planned, or required by any item here.

Deployment, native signing, and store submission are release actions rather than product capabilities. They remain separate authorization and release-readiness decisions.

## Acceptance rule for every roadmap item

A calculation or planning capability is not complete until it has:

1. Canonical unit-safe domain types and pure production functions.
2. Explicit validation and structured, location-aware diagnostics.
3. Negative tests, invariants, and independently sourced reference fixtures proportional to its safety impact.
4. Planner/Tool parity where the same formula appears in more than one workflow.
5. Immutable saved-input, equipment, result, engine-version, and convention-version semantics with a migration path.
6. Responsive and accessible UI coverage plus updated architecture, flow, test, and validation documentation.
7. A frozen-tree scientific and safety review appropriate to the claim, including qualified human review for operational or cave semantics, with no unresolved critical or high findings. Automated or AI review alone is not exit evidence.
