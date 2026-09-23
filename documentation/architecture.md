# Architecture

## Runtime

Barefoot Dive is a client-only React 19/TypeScript/Vite application. The browser PWA uses static assets and an explicitly registered production service worker from `vite-plugin-pwa`; registration is skipped when `Capacitor.isNativePlatform()` is true. Capacitor packages the same bundle for iOS and Android without running a service worker inside the native WebView. Development service-worker registration is intentionally disabled. There is no server, account, network calculation service, analytics, subscription, provider credential, or secret boundary. The app sends no email, runs no scheduled or background work, and embeds no agents, webhooks, or external automation.

## Calculation layers

`src/domain` defines branded units, defaults, validation, gas/cylinder types, diagnostics, and plan schemas. `src/domain/validation.ts` also owns the shared PPO₂ helpers (`gasPPO2`, `isBelowMinimumPPO2`, `isGasBreathable`, `isSwitchEligible`, `compareGasPreference`, `effectiveBailoutGases`) so the scheduler, validation, and the cave layer judge a gas the same way. `src/engine` contains the pure ZH-L16C (16 compartments) tissue model, GF ceilings, deterministic stop scheduler, event model, OC/CCR breathing strategies, gas switching, setpoint transitions, and exact-state CCR bailout. `src/gas` integrates surface-normalized gas use and reserve policy crossings. `src/calculations` contains the production functions behind the 11 named Tools capabilities and planner support flows.

`src/cave` is a local route/event/scenario layer over `calculateEventDivePlan`, not a second decompression engine. It models explicit penetration/exit legs, segment-level accessible-cylinder selection, stage drop/recovery state, operational turn thresholds, planned-turn minimum pressure, and lost-back-gas, lost-buddy, scooter-failure, stage-failure, and CCR-loop-failure scenarios. A ceiling-safe cave route must be explicitly represented and checked; cave output remains experimental pending qualified cave-diver review.

## Storage and UI

`src/storage` serializes versioned envelopes to `localStorage`. Tank Bank records carry timestamps and revisions. Saved plans clone normalized inputs, resolved equipment/gases, results, warnings, engine/convention metadata, and optional cave input/result snapshots. Recalculation appends a new record revision with parent lineage; it does not mutate the prior snapshot.

`src/App.tsx` and the workspace components hold session drafts, matching calculated results, stale/source-change status, and navigation state. They pass normalized inputs to the pure calculation modules and render the returned values and diagnostics. `src/app/caveWorkspace.ts` defines the Cave session contract so its draft and matching result survive primary-workspace navigation. Plan and Cave session drafts plus Tools inputs reset on reload; Tank Bank and Saved Plans persist through the storage codecs.

`src/ui/profileChartModel.ts` converts emitted plan segments and reserve crossings into chart geometry, boundaries, and event markers. It interpolates planned depth inside each linear segment. `src/ui/ProfileChart.tsx` handles mouse, touch, and keyboard selection and renders only emitted phase, gas, setpoint, reserve, and endpoint-ceiling data. The chart does not calculate a new plan or infer continuous physiological or cylinder state.

`src/index.css` is the visual-system entry point; it only imports the sectioned stylesheets in `src/styles/` (tokens, base, shell, controls, layout, results, profile, pages, motion). Every color, size, and duration is a custom property declared in `src/styles/tokens.css`, and the IBM Plex Sans and Mono faces are bundled from `@fontsource` packages and precached by the service worker so the installed app renders identically offline. Gas ledger entries can additionally carry `gasOnly` and `requiredVolumeL` (gas-only planning) and `preBailoutDeductionL` (dil-out); all are optional, so stored snapshots stay readable without a schema migration. `src/app/recalculation.ts` reruns a saved plan from its stored normalized input exactly as stored, without defaults, so older records keep the behavior their missing fields imply; the store writes the result as a new revision. `src/app/runtimeRows.ts` is a presentation-only helper that folds consecutive identical stop segments into one runtime-table row; it never feeds a calculation.

The Tools workspace is a session-level UI over the production calculator functions. Its task categories and eleven named capabilities are documented in [`tools.md`](tools.md). Simple calculations are live and ephemeral. Emergency Gas debounces its explicit entered-schedule calculation, hides superseded output while updating, and enables Plan application only when the result signature matches the current input snapshot. CCR Simplified Bailout is bounded to one cylinder, and it is not a second planner or generated bailout engine. Tank Bank selections are copied into a session snapshot, with visible manual detachment. Plan application is an explicit allow-listed patch: Best Mix can change only the OC bottom-gas name/O2/He, SAC / RMV can change one selected RMV target, and OC Rock Bottom / Minimum Gas can change only OC rock-bottom assumptions.

Pressure types remain distinct through this boundary: ambient is absolute, cylinder pressure is gauge, and consumption uses gauge-pressure deltas. Best Mix and END policy identifiers, plus SAC / RMV input mode, belong in result assumptions so a policy or mode change can mark a result stale.

## Known risks and assumptions

- Current reference comparisons cover a limited set of profiles and formula fixtures. Cave workflows and compatibility-named presets remain experimental; [`reference-validation.md`](reference-validation.md) records the evidence boundary.
- Clearing browser or WebView storage removes Tank Bank and Saved Plan data. The product has no cloud backup or sync path.
- A green local build or CI run does not prove that Cloudflare serves the same revision. Release verification must compare the live asset hashes and headers after deployment.

## Build and release gates

`npm run lint`, `npm run test`, and `npm run build` are the baseline checks; `npm run check` runs all three. `npm run check:deploy` validates the Cloudflare Worker upload without publishing it. Cloudflare Workers Builds publishes the client-only web bundle from `main`; that delivery state does not change the scientific validation boundary. `npm run build:mobile` builds then runs Capacitor sync, and Playwright smoke/visual suites are separate browser gates. No signed or store-submitted native artifact is included.

## Related documents

- [`ROADMAP.md`](../ROADMAP.md): sequenced validation, expansion, and acceptance gates.
- [`design.md`](../design.md): product and interface system.
- [`calculation-model.md`](calculation-model.md): scientific model, conventions, and limitations.
- [`flows.md`](flows.md): safety-sensitive planning and persistence flows.
- [`tools.md`](tools.md): Tools behavior, session state, and exact Plan patches.
- [`permissions.md`](permissions.md): local-only access and operation boundaries.
- [`variables.md`](variables.md): configuration and secret inventory.
- [`seo.md`](seo.md): fixed public metadata and indexing boundary.
- [`deployment.md`](deployment.md): Cloudflare hosting, automatic builds, and delivery verification.
- [`tests.md`](tests.md): current verification coverage and gaps.
- [`reference-validation.md`](reference-validation.md): independent evidence and parity boundaries.
