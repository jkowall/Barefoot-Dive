# Test coverage and verification

## Commands

| Command | Current purpose |
| --- | --- |
| `npm run lint` | ESLint source/config check |
| `npm run test` | All Vitest unit suites |
| `npm run build` | TypeScript no-emit check and Vite production build |
| `npm run check` | lint, unit tests, and build |
| `npm run verify:deco` | `src/engine` suites |
| `npm run verify:gas` | gas and calculator suites |
| `npm run verify:exposure` | domain validation and tissue suites |
| `npm run verify:cave` | cave suites |
| `npm run test:ui` / `npm run test:visual` | Playwright smoke/visual browser gates |
| `npm run build:mobile` | web build plus Capacitor iOS/Android sync |
| `npm audit --omit=optional` | registry advisory check for the installed dependency tree |
| `cd android && ./gradlew assembleDebug` | unsigned Android debug build |
| `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build` | unsigned iOS simulator build |

## Current suites

Vitest covers domain units/validation, compile-time absolute/gauge/delta pressure separation, planner and tissue behavior, published reference-comparison envelopes, source-backed calculator fixtures, calculator/planner parity, gas ledger/reserves, cave routes/scenarios, app planning resolution, and storage schema/snapshot/revision behavior. Cave regressions include a stage-only route with zero back-gas use, finite input rejection, CCR bailout-cylinder limits, and a bound where longer exposure creates new decompression before gas is exhausted. Playwright covers safety-gate persistence, accessible control naming/focus, primary workflows, offline reload, stored cave-layer safety diagnostics, and committed phone/tablet/desktop visual snapshots. The exact pass baseline is the result of the commands above in the current checkout; this document does not convert a green test run into field validation or cave-procedure approval.

Native sync/build is a separate gate from web tests. Opening, signing, submitting, deploying, or publishing a native artifact is not performed by this repository.

## Tools redesign coverage

Calculator and application tests cover the eleven production functions and the redesigned workspace. Focused coverage includes:

- category navigation and all eleven named capabilities on phone, tablet, and desktop layouts;
- live recalculation and visible assumptions for simple tools, with per-session inputs not persisted as plans;
- Emergency Gas entered-schedule behavior, optional OC cylinder checks, required single-cylinder CCR checks, Rock Bottom / Minimum Gas and Simplified Bailout mode binding, insufficient-gas diagnostics, debounced live updates, and suppression of superseded results and Plan actions;
- Tank Bank snapshotting, manual detachment, and no silent refresh after a Tank Bank edit;
- exact `Use in Plan` patches and rejection of unrelated-field mutation;
- versioned Best Mix/END narcotic policy, SAC / RMV direct-volume versus cylinder-pressure-drop modes, absolute/gauge/delta pressure semantics, display-unit changes that preserve canonical values, and context-specific Tank Bank availability.

The current frozen browser baseline is 17 functional smoke cases plus 18 visual cases spanning phone, tablet, and desktop. The visual suite captures the Tools library, a simple live result, and the full live Emergency Gas workspace without a fixed calculation control competing with primary navigation.

These cases prove deterministic arithmetic and application behavior only. No test result is independent safety validation or a compatibility/parity claim.

## Safety gaps

Representative OC multigas, CCR, and CCR-bailout comparison envelopes are committed, including their schedule-distribution differences. Broader multi-depth/mix, altitude, CNS-output, reserve, and cave evidence remains incomplete. Cave ceiling-safe routes require explicit route modeling and qualified cave-diver review. Compatibility presets remain experimental and are not parity tests.
