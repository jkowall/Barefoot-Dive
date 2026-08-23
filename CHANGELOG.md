# Changelog

## Unreleased

- Licensed the project under the Apache License 2.0 and added SPDX package metadata.
- Added the illustrated Barefoot Dive identity across the in-app brand, browser icons, PWA install assets, iOS and Android launchers, and native splash screens.
- Added Cloudflare Workers static-asset hosting for `barefootdive.app` and `www.barefootdive.app`, automated `main` deployments through Workers Builds, deploy-package validation, and security headers.
- Replaced the generic Tools selector with a task-oriented library and focused, responsive calculator workspaces for all eleven named capabilities.
- Added per-tool ephemeral session inputs, field and cross-field diagnostics, typed result presenters, Tank Bank snapshots with manual detachment, and safe debounced live results for Emergency Gas.
- Added clearer Tools section hierarchy, live/updating/invalid status cues, active-navigation indicators, restrained page/result transitions, and reduced-motion behavior.
- Refined the shared visual system with layered workspace depth, stronger page and panel hierarchy, clearer result metrics, richer navigation and controls, and visible keyboard focus for segmented choices.
- Added one-shot border completion cues for Plan and Cave calculations, local snapshot and cylinder saves, and confirmed Tool-to-Plan transfers without animating safety-critical values; successful calculations bring the completed result into view.
- Split the single top-level Plan workspace into Setup and Review, with an explicit first calculation, debounced recalculation after later valid edits, and suppression of superseded results and saving while inputs are updating or invalid.
- Kept the current Plan draft and matching result across primary-workspace navigation for the app session, surfaced Tank Bank source revisions for explicit Plan updates, retained display/local preferences in Settings, and made edited Cave results require an explicit `Update cave plan` before output or saving returns.
- Added exact, confirmed Plan patches for Best Mix, one selected SAC/RMV target, and OC rock-bottom assumptions; unsupported calculators remain display-only.
- Added versioned trimix Best Mix and END narcotic policies, dual-input SAC/RMV, entered-schedule Emergency Gas, and distinct absolute, gauge, and pressure-delta types.
- Added source-backed literal Tools fixtures from NOAA, U.S. Navy, SSI, and the documented Subsurface convention option; these establish formula arithmetic only, not procedure or planner parity.
- Required explicit END oxygen, OC Emergency team size, and cylinder reserve; routed Emergency segments through the shared planner gas-integration primitive and exposed exact Best Mix active constraints.
- Fixed Tank Bank card actions so multiple cylinders keep their Delete controls separated and clickable across responsive layouts.
- Scrolled newly added deco and bailout gas editors into view without hiding them behind the sticky application header.

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
