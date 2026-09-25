# AGENTS.md - Barefoot Dive development guide

This document defines the repository-specific rules for AI/LLM assistants working on Barefoot Dive. Barefoot Dive shares application-shell patterns with Barefoot Blender, but its decompression, exposure, cave, gas-ledger, persistence, and unit contracts are independent.

## Mandatory first step

Before planning, reviewing, or editing, read this file from disk rather than relying only on pasted context. Then inspect the current files and worktree state relevant to the request.

Every implementation plan must cover, when applicable:

- Code and data-model changes
- Tests and regression coverage
- Documentation impact
- Version and `CHANGELOG.md` decision
- Validation commands
- Commit, push, deployment, signing, and store-submission boundaries

## Project overview

Barefoot Dive is an offline-first, client-only technical-diving planner for open-circuit and constant-setpoint CCR dives. It includes decompression planning, gas/reserve accounting, Tank Bank, immutable Saved Plan snapshots, eleven calculator capabilities, and experimental cave route/scenario planning.

All output is decision support. Passing tests does not establish decompression safety, cave-procedure validity, or parity with a dive computer or third-party planner.

## Technology

- React 19 and strict TypeScript 6
- Vite 8 with `vite-plugin-pwa`
- Vitest for unit, invariant, fixture, and reference-comparison tests
- Playwright for browser smoke, offline, accessibility-oriented, and visual-regression checks
- Capacitor 8 iOS and Android shells
- Vanilla mobile-first CSS: `src/index.css` imports the sectioned token, base, shell, controls, layout, results, profile, pages, and motion files in `src/styles/`
- Versioned local persistence through `src/storage`; there is no backend

There are no accounts, analytics, subscriptions, calculation services, provider credentials, or network calculation dependencies.

## Repository structure

```text
src/
├── app/            # Plan, Cave, Tools, Tank Bank, Saved Plans, UI orchestration
├── calculations/   # Production functions behind all eleven Tools capabilities
├── cave/           # Route, access, limit, and failure-scenario layer
├── domain/         # Branded units, public types, defaults, and validation
├── engine/         # ZH-L16C tissues, conventions, event planner, bailout state transfer
├── gas/            # Gas-use integration, reserves, and ledger calculations
├── platform/       # PWA/native platform boundaries
├── storage/        # Versioned local codecs, Tank Bank, and Saved Plan snapshots
├── ui/             # Shared presentation components
├── App.tsx         # Application routing and cross-workspace state
├── main.tsx        # Entry point and PWA registration
├── index.css       # Global visual system entry; imports src/styles/
└── styles/         # Tokens, base, shell, controls, layout, results, profile, pages, motion
tests/ui/           # Playwright smoke and phone/tablet/desktop visual suites
documentation/      # Architecture, calculations, flows, tests, tools, and trust boundaries
ios/                # Capacitor iOS project
android/            # Capacitor Android project
```

## Development commands

```bash
npm install                 # Install the locked dependency tree
npm run dev                 # Start the Vite development server
npm run lint                # ESLint
npm run test                # All Vitest suites
npm run test:watch          # Vitest watch mode
npm run build               # TypeScript no-emit check plus production/PWA build
npm run check               # lint, all Vitest tests, and build
npm run verify:deco         # Engine and decompression suites
npm run verify:gas          # Gas-ledger and calculator suites
npm run verify:exposure     # Domain validation and tissue suites
npm run verify:cave         # Cave route/scenario suites
npm run test:ui             # Playwright desktop smoke suite
npm run test:visual         # Phone/tablet/desktop visual regression suite
npm run test:visual:update  # Deliberately refresh committed visual baselines
npm run mobile:sync         # Build and sync the production bundle to both native shells
```

Native compile gates:

```bash
(cd android && ./gradlew assembleDebug)
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator CODE_SIGNING_ALLOWED=NO build
```

Do not open GUI applications, sign, upload, submit, deploy, or publish unless the user explicitly requests that action.

## Definition of done

A task is complete only when:

1. The requested change is implemented without unrelated rewrites.
2. Behavior changes have proportionate unit, fixture, UI, or visual coverage.
3. The appropriate verification matrix below passes, or the exact unrun/failed gate is reported.
4. Public behavior, calculation contracts, persistence, or trust boundaries are documented.
5. Version and changelog impact are explicitly decided for release work.
6. The final response lists the outcome, validation, and remaining scientific or release risks.

## Scientific and safety invariants

### Unit system

Canonical calculation inputs use:

- metres for depth and distance
- seconds for time
- bar absolute for ambient pressure, PPO2, CCR setpoints, and tissues
- bar gauge for cylinder/manifold readings
- bar delta for consumption and pressure differences
- surface litres for gas volume
- litres per minute for RMV/SAC
- fractions from 0 to 1 for gas composition and Gradient Factors

Use the branded types and constructors in `src/domain/types.ts` and `src/domain/units.ts`. Never replace `BarAbsolute`, `BarGauge`, or `BarDelta` with a generic pressure type. Display conversions to feet, PSI, or rated cubic feet belong at UI boundaries and must not rewrite canonical values.

### Calculation boundaries

- Keep `src/engine`, `src/gas`, `src/calculations`, and the calculation portions of `src/cave` pure and deterministic.
- Do not import React, storage, or app-state types into the scientific core.
- Return structured diagnostics. Do not silently clamp, sanitize, or substitute unsafe scientific inputs.
- Preserve serializable tissue state and exact CCR bailout transfer from the selected trigger state.
- Route all planner and Tool gas consumption through shared production integration functions; do not duplicate formulas in UI code.
- Every cylinder pressure must retain cylinder water-volume/rated-capacity context.
- Expected consumption and reserve are separate quantities.
- Hypoxic bottom gas requires an explicit breathable travel-gas sequence.
- Cave cylinder access, drop/recovery, route exposure, decompression, and failure scenarios must be modeled explicitly.

### Claims and evidence

- Compatibility-named policies are experimental presets unless current independent vectors prove more.
- Do not claim MultiDeco, Shearwater, Subsurface, dive-computer, or procedure parity from internal tests alone.
- Source-backed fixtures must record literal inputs, outputs, tolerances, source revision/page/equation, unit translations, and assumptions.
- Analyzer readings, manufacturer limits, team procedures, a dive computer, and qualified-diver review remain authoritative boundaries.
- Cave results remain visibly experimental pending qualified cave-diver review.

## Persistence and snapshot rules

- Tank Bank records are mutable equipment records with revisions.
- Calculated/saved plans snapshot normalized inputs, resolved gas/cylinder state, result, warnings/errors, engine version, convention version, and cave context when applicable.
- Tank Bank edits must never silently rewrite an existing calculated Tool result or Saved Plan.
- Recalculation creates a new Saved Plan revision with lineage; it does not mutate the historical revision.
- Tool inputs and results are session-local and reset on application reload.
- Storage schema or codec changes require migration and regression coverage.
- `localStorage` is not cloud sync or backup; do not imply otherwise.

## React and UI conventions

- Use functional components and hooks only.
- Keep calculation logic outside components; UI calls production functions and renders typed results/diagnostics.
- Preserve the application-level Plan draft so Tool patches change only allow-listed fields.
- Plan patches must use `ToolPlanPatch` and `applyToolPlanPatch`; never reconstruct or replace unrelated plan state.
- Keep interactive controls accessible by name, keyboard, and focus behavior.
- Use large touch targets, safe-area spacing, bottom navigation on mobile, and the rail on desktop.
- Preserve the dark slate/blue Barefoot visual family, strong information hierarchy, and restrained motion.
- Motion must clarify state, must not animate or count through safety-critical numeric values, and must honor `prefers-reduced-motion`.
- Never show a superseded result beside edited inputs. Disable saving or Plan application until the displayed result matches the current input signature.
- Do not add decorative dive imagery, low-information gauges, excessive cards, icons, or animation without a functional reason.

## Adding or changing functionality

### Scientific calculation or planner behavior

1. Define or update branded public input/output types.
2. Implement the pure function in the appropriate domain module.
3. Add invariants, boundary cases, and literal reference fixtures.
4. Reuse the production function from planners and Tools.
5. Update calculation, validation, test, and reference documentation.
6. Run the scientific verification suites and request an independent safety review for decompression, CCR bailout, CNS, reserve, or cave semantics.

### Tool capability

1. Keep production math in `src/calculations` or the shared gas layer.
2. Add the task to the typed Tools catalog and focused presenter.
3. Store canonical session inputs separately for each tool.
4. Offer Tank Bank only when cylinder context is material.
5. Use exact, confirmed, allow-listed Plan patches only.
6. Add calculator fixtures, planner parity tests, browser behavior tests, and responsive visual coverage.

### Persistence change

1. Update schema and codec deliberately.
2. Preserve backward-readable records or add an explicit migration.
3. Test malformed, older, and current envelopes.
4. Verify immutable snapshots and revision lineage.
5. Update `documentation/architecture.md`, `flows.md`, and `tests.md`.

### Native or PWA change

1. Preserve the rule that service-worker registration is skipped on native platforms.
2. Run web build/offline smoke, Capacitor sync, and unsigned native compile gates.
3. Treat copied native web assets and generated Capacitor configuration as build output.
4. Do not add permissions, signing material, services, or deployment configuration without explicit scope.

## Verification matrix

### Documentation-only

- Inspect links, commands, and changed claims.
- Run `git diff --check` once files are tracked or staged.
- Run code gates only when documentation changes a command/config contract.

### UI, state, styling, or application wiring

- `npm run check`
- `npm run test:ui`
- `npm run test:visual` when rendered output changes
- Regenerate visual snapshots only after inspecting the new phone, tablet, and desktop images

### Decompression, tissue, convention, or validation logic

- `npm run check`
- `npm run verify:deco`
- `npm run verify:exposure`
- relevant independent reference comparisons
- read-only scientific review before calling the gate complete

### Gas, reserve, calculator, CCR bailout, or cave logic

- `npm run check`
- `npm run verify:gas`
- `npm run verify:exposure` when PPO2/CNS/tissues are affected
- `npm run verify:cave` when route, accessibility, turn, or scenario behavior is affected
- relevant planner-versus-Tool parity and literal reference fixtures
- read-only scientific review for safety-sensitive semantics

### PWA or native wiring

- `npm run check`
- offline Playwright smoke
- `npm run mobile:sync`
- unsigned Android debug build
- unsigned iOS simulator build

## Manual review checklist

- Safety acknowledgement remains first-run and persistent.
- Plan, Cave, Tools, Tank Bank, Saved Plans, and Settings remain reachable and keyboard-accessible.
- PSI/bar, ft/m, and cylinder-capacity preferences change presentation without corrupting canonical values.
- Whole-number PSI presentation does not reduce stored bar precision.
- Tool result status, pending state, invalid state, and Plan-action availability correspond to the exact current inputs.
- Tank Bank selection copies a snapshot; editing sourced values detaches without mutating the stored cylinder.
- Saved Plan reopening preserves the historical calculation and surfaces older engine versions.
- PWA reload works offline after installation.
- Phone, tablet, and desktop layouts preserve safe areas and navigation clearance.

## Documentation map

- `README.md`: implemented scope and trust boundary
- `design.md`: product and visual intent
- `ROADMAP.md`: post-initial-goal validation and expansion sequence
- `CHANGELOG.md`: user-visible changes
- `documentation/architecture.md`: runtime and module boundaries
- `documentation/calculation-model.md`: scientific contracts and limitations
- `documentation/flows.md`: planning, snapshot, Tools, and offline flows
- `documentation/reference-validation.md`: source and parity evidence
- `documentation/tests.md`: verification commands, current coverage, and known gaps
- `documentation/tools.md`: Tools behavior and Plan handoff
- `documentation/permissions.md`: local-only permissions boundary
- `documentation/variables.md`: configuration and secret inventory

## Common pitfalls

1. Mixing absolute, gauge, and delta pressure.
2. Passing display PSI/feet/cubic feet into canonical calculations.
3. Treating bottom time as total runtime; it is time at target depth.
4. Breathing a hypoxic bottom gas from the surface without travel gas.
5. Calculating CCR bailout from a reconstructed profile instead of the exact trigger tissue state.
6. Computing cave limits by scaling an existing result without recalculating exposure and decompression.
7. Using only one cylinder ledger when the route breathes stages or other accessible gases.
8. Letting Tank Bank edits rewrite historical calculations.
9. Displaying a stale result or enabling Plan application against changed Tool inputs.
10. Treating green regression tests as independent safety validation.
11. Registering a service worker in the native Capacitor WebView.
12. Committing copied web bundles, native build output, local SDK paths, signing material, or test reports.
13. Testing another worktree's preview server. Playwright builds and serves each checkout on its own free port and never reuses a running server by default; set `PLAYWRIGHT_REUSE_SERVER=1` only for a preview of this checkout's current build, because reuse skips the build.

## Protected areas

Do not change these unless the request explicitly requires it and the relevant verification/review gate is planned:

- ZH-L16C coefficients and tissue equations
- Gradient Factor ceiling/stop scheduling
- CCR setpoint and exact-state bailout behavior
- gas integration and reserve semantics
- cave route access, limit solving, and failure scenarios
- branded pressure/unit types
- saved-plan schema, migrations, and immutable snapshot semantics
- PWA service-worker/native registration boundary
- Capacitor app identity and native project configuration
- scientific validation/compatibility status labels

## Multi-agent and model policy

Use delegation only for concrete, independent, bounded work.

- Root integration and cross-module design: `gpt-5.6-terra`, medium by default.
- Bounded implementation, tests, CRUD, and documentation: `gpt-5.6-luna`, low or medium.
- Scientific design and read-only safety review: `gpt-5.6-sol`, high only when justified.
- Do not use Ultra.
- Keep at most two child agents active at once.
- Child agents must not spawn other agents.
- Assign owned paths and acceptance commands; never give two writers the same shared file group.
- Scientific modules, central types, package configuration, application state, and global CSS have one writer at a time.
- Sol normally reviews rather than implements. Terra or Luna fixes findings, and Sol rechecks only the affected calculation when needed.

## Git, commit, and release policy

- Preserve unrelated worktree changes and inspect `git status --short --branch` before staging.
- Stage explicit intended paths. For the initial repository import, first audit the complete non-ignored inventory before staging it.
- All commits must be signed with `git commit -S`.
- Run the applicable verification gate before committing and record the result in the handoff.
- Do not amend, rebase, force-push, push, open a PR, deploy, sign native artifacts, upload, submit, or publish without explicit user authorization.
- A local build, synced native shell, green CI check, or model completion message is not a deployment or release.
- Update `CHANGELOG.md` for user-visible changes. Do not bump the application version for internal-only work.
- Do not create a public safety, validation, compatibility, or parity claim without documented independent evidence and separate authorization.

There is currently no authorized production deployment, store submission, signing workflow, subscription gate, or automatic push-to-production contract in this repository.
