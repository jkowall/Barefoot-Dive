# Changelog

## Unreleased

## [0.2.0] - 2026-08-23

- Licensed the project under the Apache License 2.0 and added SPDX package metadata.
- Added the illustrated Barefoot Dive identity across the in-app brand, browser icons, PWA install assets, iOS and Android launchers, and native splash screens.
- Added Cloudflare Workers static-asset hosting for `barefootdive.app` and `www.barefootdive.app`, automated `main` deployments through Workers Builds, deploy-package validation, and security headers.
- Replaced the generic Tools selector with a task-oriented library and focused, responsive calculator workspaces for all eleven named capabilities.
- Added per-tool ephemeral session inputs, field and cross-field diagnostics, typed result presenters, Tank Bank snapshots with manual detachment, and safe debounced live results for Emergency Gas.
- Added clearer Tools section hierarchy, live/updating/invalid status cues, active-navigation indicators, restrained page/result transitions, and reduced-motion behavior.
- Refined the shared visual system with layered workspace depth, stronger page and panel hierarchy, clearer result metrics, richer navigation and controls, and visible keyboard focus for segmented choices.
- Added one-shot border completion cues for Plan and Cave calculations, local snapshot and cylinder saves, and confirmed Tool-to-Plan transfers without animating safety-critical values; successful calculations bring the completed result into view.
- Split the top-level Plan and Cave workspaces into Setup and Review, with an explicit first calculation, debounced recalculation after later valid edits, and suppression of superseded results and saving while inputs are updating or invalid.
- Kept the current Plan and Cave drafts and matching results across primary-workspace navigation for the app session, surfaced Tank Bank source revisions for explicit Plan or Cave updates, and retained display/local preferences in Settings.
- Made Cave Review show one aggregate status and diagnostic list across the base plan and every enabled failure scenario, so an unsafe unselected scenario cannot sit behind a positive overall summary before saving.
- Added exact, confirmed Plan patches for Best Mix, one selected SAC/RMV target, and OC rock-bottom assumptions; unsupported calculators remain display-only.
- Added versioned trimix Best Mix and END narcotic policies, dual-input SAC/RMV, entered-schedule Emergency Gas, and distinct absolute, gauge, and pressure-delta types.
- Added source-backed literal Tools fixtures from NOAA, U.S. Navy, SSI, and the documented Subsurface convention option; these establish formula arithmetic only, not procedure or planner parity.
- Required explicit END oxygen, OC Emergency team size, and cylinder reserve; routed Emergency segments through the shared planner gas-integration primitive and exposed exact Best Mix active constraints.
- Made Tools depth, cylinder pressure, surface-gas volume, and RMV presentation follow Settings while retaining canonical metres, bar, litres, and L/min; strengthened the MOD Feet/Meters regression.
- Fixed Tank Bank card actions so multiple cylinders keep their Delete controls separated and clickable across responsive layouts.
- Scrolled newly added deco and bailout gas editors and Cave route legs into view without hiding them behind sticky workspace controls, and kept rapid route additions uniquely numbered.
- Kept long result metric values, including the calculated safety status, inside their cards at intermediate viewport widths.
- Added time-accurate interactive profile graphs with labeled runtime and depth measures, decompression bands, subdued endpoint ceiling checkpoints with a plain-language explanation, numbered and selectable gas/setpoint-switch and reserve-crossing details, a docked non-overlapping scrub readout, and accessible mouse, touch, and keyboard inspection across primary, CCR bailout, Cave base/scenario, and stored base-plan results.
- Displayed the app release and calculation-engine identifiers together in Settings so support reports can distinguish product changes from scientific engine changes.
- Used the planner's canonical engine identifier for Saved Plan stale-version checks.

## [0.1.0] - 2026-08-21

- Added the offline-first React/Vite PWA and Capacitor application shell.
- Added pure unit-safe technical calculations: ZH-L16C/GF planning, OC and constant-setpoint CCR profiles, travel/deco/diluent/bailout semantics, exact-trigger-state CCR bailout, and integrated gas/reserve accounting.
- Added all 11 production calculator tools: MOD, Best Mix, END, gas density, PPO2, SAC/RMV, gas duration, rock bottom, cylinder gas, CNS, and simplified bailout.
- Added Tank Bank and immutable saved-plan snapshots with revisions, lineage, engine/convention metadata, warnings, and cave context.
- Added independent imperial rated-capacity, metric water-volume, and pressure preferences while retaining canonical water-volume and bar calculations.
- Displayed and entered PSI as whole numbers across planning, cave, Tank Bank, and Tools while retaining canonical bar precision.
- Added pinned OC multigas, CCR, and CCR-bailout comparison envelopes against Abysner's published cross-planner profiles, with schedule differences documented rather than claimed as parity.
- Added experimental cave route and scenario modeling with per-cylinder turn context, recalculated gas-derived bounds, CCR bailout-ledger limits, and immutable cave-layer safety diagnostics. Cave ceiling-safe routes require explicit modeling and qualified cave-diver review.
- Documented compatibility presets as experimental settings presets, not MultiDeco or Shearwater parity claims.
- Added a sequenced roadmap separating validation gates, planned product expansion, and conditional connected capabilities.
- No signed or store-submitted native artifact is included.
