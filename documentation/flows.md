# Flows

## Local plan flow

1. The diver enters a validated OC or constant-setpoint CCR profile, gases, cylinders, GF/settings, RMV, and reserve policy.
2. The UI resolves Tank Bank records into explicit gas/cylinder snapshots and calls the pure planner.
3. The engine simulates descent, bottom exposure, switches/setpoint changes, ascent, and stops. It emits event segments, tissues, ceilings, diagnostics, gas ledger, reserve crossings, and safety status.
4. For CCR, the selected at-depth trigger state is cloned exactly and used to build the independent OC bailout plan.
5. The diver reviews warnings, analyzer assumptions, gas/reserve sufficiency, and qualified-diver boundaries before optionally saving a local snapshot.

## Cave flow

The diver defines explicit penetration/exit route legs and the cylinders accessible on each leg, then chooses lost-back-gas, lost-buddy, scooter-failure, stage-failure, or CCR-loop-failure scenarios. The cave layer resolves the breathing cylinder for every route segment, applies stage drop/recovery state, derives exact route events and both operational and planned-turn constraints, and passes them to the production event planner. Gas-derived maximum time/distance is solved by repeatedly recalculating scaled candidates, including changed tissues, decompression, and per-cylinder gas use; it is omitted when a safe/unsafe bracket cannot be established. CCR limits and reserve margin use the actual bailout contingency ledger. Cave input, result, and cave-layer diagnostics are retained in saved snapshots, and any stored error reopens under an explicit unsafe banner. A cave ceiling-safe route must be explicitly modeled; the route layer does not infer a safe overhead exit from an open-water result. Cave results are experimental pending qualified cave-diver review.

## Tools flow

The user chooses a task category and capability in the focused Tools workspace. Simple tools recalculate locally as their session inputs change and expose assumptions and warnings. Tank Bank selection copies gas/cylinder data into an ephemeral session snapshot; the user may visibly detach and continue with manual values. A result is not a plan mutation until the user chooses an exact Plan action and confirms its before/after preview. The allow-list is Best Mix to the OC bottom-gas name/O2/He, SAC / RMV to one selected RMV target, and OC Rock Bottom / Minimum Gas to OC rock-bottom assumptions.

Emergency Gas has a stricter flow. The user enters an explicit ascent/stop schedule and the RMV/team assumptions, optionally adding cylinder context for OC gas-pressure bounds; CCR Simplified Bailout requires one cylinder. The current input snapshot recalculates automatically after a short pause. During that pause the old result is not displayed and Plan application is disabled; invalid inputs produce current diagnostics instead of preserving an old answer. It is not a generated decompression or bailout plan. Any safety or compatibility interpretation still requires independent fixtures, analyzer-first verification, and qualified review.

## Local/offline and native flow

The PWA service worker serves the built assets after installation. Capacitor shells serve the same local bundle. Tank Bank and saved plans read/write browser/WebView `localStorage`. There is no account check, network calculation, sync, analytics, subscription, signing, store submission, or deployment flow.
