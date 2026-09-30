# Brief: A pressure bar for the Emergency Gas cylinder check

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30). Proposal V8.
- **Status:** ready to implement once its order allows. No engine, calculation, storage, or schema change: `calculateEmergencyGas` already returns every value the bar needs.
- **Suggested branch:** `cursor/tools-pressure-bar`, from the latest `main`.
- **Order:** third wave, after `gas-budget-bars.md` (which adds the bar component this brief reuses) and `color-semantics.md` (which edits `src/app/ToolsPage.tsx`). It can run at the same time as `runtime-leave-column.md`; they share no source file, but both edit `tests/ui/visual.spec.ts`, `documentation/tests.md`, and `CHANGELOG.md`, so whichever lands second rebases and merges them.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **The tiles.** With a cylinder, `ResultDetails` in `src/app/ToolsPage.tsx` shows up to ten tiles for Emergency Gas:
  - Required gas and Team multiplier;
  - Cylinder capacity, Starting pressure, Reserve pressure, and Pressure drop;
  - Required start, Remaining, and Margin;
  - Cylinder check.

  On the default Rock Bottom / Minimum Gas case that is 3365 psi to start, 508 psi reserve, an 836 psi drop, 1344 psi required start, 2528 psi remaining, and a 2021 psi margin. How those numbers relate is left for the diver to work out.
- **What the calculation returns.** `calculateEmergencyGas` (`src/calculations/index.ts`) returns `pressureDropBar`, `requiredStartingPressureBar`, `remainingPressureBar`, `availablePressureBar`, `marginPressureBar`, and `sufficient`. The starting and reserve pressures come from the entered cylinder (`emergencySnapshot.cylinder`).

## Requirements

1. **Where.** Add the bar component from `gas-budget-bars.md` above the Emergency Gas tiles, only when a cylinder is checked. Schedule-only results show no bar.
2. **Geometry, in gauge pressure.**
   - The frame runs from the starting pressure (left) to zero.
   - The pressure drop grows from the left.
   - The reserve zone is the last `reservePressureBar` of the frame.
   - A drop that reaches into the reserve zone is drawn in the danger color after a 2 px surface gap.
   - Label the end of the drop with the emitted `remainingPressureBar` ("2528 psi after the ascent").
   - Label the margin with the emitted `marginPressureBar`, the same value as the Margin tile, including when it is negative.
   - If the drop exceeds the starting pressure, stop the bar at the frame and label its end "exceeds the cylinder", as the ledger bars do. `calculateEmergencyGas` clamps `remainingPressureBar` to zero, so print no remaining pressure in that case.

   Print no other derived number. The component's model works in fractions of the frame, so pass pressures rather than volumes; add a pressure variant to it only if needed.
3. **Status and labels.** The bar's status chip follows `sufficient` (Sufficient or Insufficient, with icon and label) and matches the Cylinder check tile. All tiles stay.
4. **Accessibility.** The bar is `role="img"` with a name built from the same values, for example "Cylinder check, sufficient: 836 psi drop from 3365 psi leaves 2528 psi, 2021 psi above the 508 psi reserve".
5. **Pending results.** While the result is updating after an edit, the bar is hidden with the rest of the result, as today. It never shows a superseded result beside edited inputs. Add no motion; the bar renders at its final size.

## Out of scope

- Bars for Cylinder Gas or Gas Duration.
- Any change under `src/calculations`, `src/engine`, `src/gas`, `src/domain`, `src/cave`, or `src/storage`.
- `src/app/PlanResultView.tsx` and the ledger rows.
- `src/ui/index.tsx`, which `runtime-leave-column.md` edits at the same time. Import anything new from `src/ui/GasBudget.tsx` directly.

## Owned paths

- `src/app/ToolsPage.tsx` (the Emergency Gas result block only)
- `src/ui/GasBudget.tsx` and `src/ui/gasBudgetModel.ts` (a pressure variant only, if needed) with their test
- `src/styles/results.css` (the gas budget section only, for a pressure variant class if one is needed; otherwise reuse the component's classes unchanged)
- a new `tests/ui/tools-pressure-bar.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `documentation/tools.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest: the bar model on the default case, an insufficient case where the drop runs into the reserve, and a drop larger than the starting pressure (the bar stops at the frame).
- Playwright, in the new spec file:
  - The default Rock Bottom / Minimum Gas case shows the bar with its accessible name.
  - Switching to "Schedule only" removes it.
  - An edit hides it until the result is live again.
- Visual: `tools-emergency` changes on phone, tablet, and desktop. Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `documentation/tools.md`: the bar and what it shows.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Emergency Gas draws the cylinder check as one pressure bar: the ascent's drop, the reserve at the empty end, and the margin between them." Do not bump the version.

## Verification

```bash
npm run check
npm run test:ui
npm run test:visual
git diff --check
```

## Git and pull request

- Sign every commit (`git commit -S`), open one pull request against `main`, and delete this brief in that pull request.
- Merging stays with Jonah; do not merge the pull request yourself.
