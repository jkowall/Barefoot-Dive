# Barefoot Dive

Barefoot Dive is an offline-first, client-only technical dive-planning PWA with Capacitor iOS and Android shells. It supports open-circuit (OC) and constant-setpoint CCR planning, gas and reserve accounting, Tank Bank equipment records, saved local snapshots, and an experimental cave route/scenario workflow.

## Implemented scope

- Pure, deterministic, unit-branded TypeScript calculations using metres, seconds, bar absolute, litres, and fractions.
- A 16-compartment ZH-L16C engine with gradient factors, tissue ceilings, event segments, OC gas switches, CCR setpoint activation/deactivation, travel/deco gases, diluent, and bailout.
- CCR bailout generated from the exact trigger state at the selected at-depth time, rather than from a separately reconstructed profile.
- Integrated gas use and reserves, including fixed, custom, thirds, sixths, and rock-bottom policies, with reserve-crossing diagnostics.
- Eleven production calculator tools: MOD, Best Mix, END, gas density, PPO2, SAC/RMV, gas duration, rock bottom, cylinder gas, CNS, and simplified bailout. The UI calls these production functions; there is no parallel demo calculator path.
- The task-oriented Tools library organizes those eleven capabilities into focused, responsive workspaces. Emergency Gas contains Rock Bottom / Minimum Gas and Simplified Bailout modes; it checks an entered schedule, optionally against one OC cylinder and always against one CCR bailout cylinder. It does not generate a decompression or bailout plan. See [`documentation/tools.md`](documentation/tools.md).
- Tank Bank records with explicit cylinder/gas assignment, analyzer-first fields, revision metadata, archive/restore, and local persistence. Depth, pressure, and cylinder-capacity preferences are independent: imperial cylinders use rated surface ft³ at working pressure, while metric cylinders use physical water-volume litres.
- Saved plans as immutable input/equipment/result snapshots. Recalculation creates a new revision with lineage, engine/convention metadata, warnings, and (for cave plans) complete cave input/result context.

Cave planning is deliberately experimental. It models route legs, penetration/exit exposure events, accessible cylinders, per-cylinder turn-pressure/reserve limits, and scenarios for lost back gas, lost buddy, scooter failure, stage failure, and CCR loop failure. Gas-derived maximum distance/time is reported only when a bounded search can establish safe and unsafe candidates after recalculating tissues, decompression, and the relevant OC or CCR-bailout ledgers. A cave ceiling-safe route must be explicitly modeled and checked; cave results are not a claim of qualified cave-diver procedure or planner parity and remain pending qualified cave-diver review.

Compatibility presets named for MultiDeco and Shearwater are selectable scheduling presets only. They are explicitly experimental and make no firmware, schedule, or parity claim.

## Development and verification

```sh
npm install
npm run lint
npm run test
npm run build
npm run check
```

Focused suites are available with `npm run verify:deco`, `npm run verify:gas`, `npm run verify:exposure`, and `npm run verify:cave`. Browser smoke and visual checks use `npm run test:ui` and `npm run test:visual` and require the Playwright browser environment. `npm run build:mobile` runs the web build and Capacitor sync; opening native projects is a separate gate. Cloudflare deployment is documented in [`documentation/deployment.md`](documentation/deployment.md). No signed or store-submitted native artifact is present in this repository.

## Data, safety, and trust boundaries

The app runs calculations locally in the browser or native WebView and stores Tank Bank and saved-plan data in `localStorage`. It has no accounts, authentication, network calculation service, analytics, subscriptions, provider credentials, or bundled secrets. Clearing browser/app storage removes local data; snapshots are not a cloud backup.

Outputs are decision support. Analyze gases with appropriate equipment, verify assumptions and final readings, and have a qualified diver review the plan. Public web availability does not establish decompression, CNS, bailout, reserve, or cave-procedure safety or parity with a computer/planner. See [`documentation/reference-validation.md`](documentation/reference-validation.md) for the current evidence boundary.

See [`ROADMAP.md`](ROADMAP.md) for sequenced validation and product work. See [`design.md`](design.md) and [`documentation/`](documentation/) for product and implementation detail.

## License

Copyright 2026 Jonah Kowall. Licensed under the [Apache License 2.0](LICENSE).
