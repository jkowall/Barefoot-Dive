# Brief: Profile chart legibility and a readout that never moves

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30, including violet deco stops). Proposals V2 and B2.
- **Status:** ready to implement. No engine, calculation, storage, or schema change. The chart keeps showing emitted data only.
- **Suggested branch:** `cursor/profile-chart-legibility`, from the latest `main`.
- **Order:** first wave, in parallel with `color-semantics.md`, which edits none of this brief's source files. Both edit `design.md` and change the `plan-results` and `cave-results` baselines, which cannot be merged as text: whichever lands second rebases, merges `design.md`, and renders those baselines again. `gas-budget-bars.md` (for `src/styles/tokens.css`), `saved-plan-cards.md` (if it reuses the chart model), and `ccr-bailout-comparison.md` (chart files) start after this lands. The traces work in `profile-exposure-traces.md` also extends this scrubber; it waits for its contract review, and whichever lands second rebases.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0). `src/ui/ProfileChart.tsx` and `src/ui/profileChartModel.ts` are unchanged since 0.5.2.

- **Ticks.** Runtime ticks come from `niceTicks` over seconds in `buildProfileChartModel`, so a 57:20 plan is ticked at 0:00, 16:40, 33:20, and 50:00, then 57:20. At phone width the last two labels collide ("50:0057:20").
- **Stretched text.** The plot is a 720 × 330 viewBox with `preserveAspectRatio="none"`, so axis and label text stretch with the container. `src/styles/profile.css` sets 18 px and 17 px text on phones to compensate.
- **Phase strip.** It draws one block per segment. The planner splits stops into one-minute segments, so a 16-minute stop shows as 16 blocks. The strip colors (`--bf-phase-*` in `src/styles/tokens.css`) fail the dataviz categorical checks: the worst adjacent pair is ΔE 4.5, and 7 of 8 hues are below the chroma floor. Stops use `--bf-phase-stop: var(--bf-warning)`, the same amber as warnings, the ceiling checkpoint, and warning reserve markers. The deco-window washes in the plot use the same amber.
- **Moving readout.** The readout adds an "Event marker" cell only while the selection sits on an event (`selectedMarkers.length > 0 && …`). Keyboard or pointer scrubbing onto a gas switch therefore moves the plot down one readout row, 53 px at 1440 × 1024, and back again one step later.
- **Readout size.** Open-circuit plans show "Plan mode: Open circuit" and "Breathing: Open circuit", which duplicate each other. On a phone the readout takes about 300 px before the plot starts.
- **Cave timeline.** The Cave route timeline (0.7.0) colors its own segments with `--bf-phase-penetration` and `--bf-phase-exit` in `src/styles/layout.css`.

## Requirements

1. **Minute ticks.**
   - Runtime ticks fall on whole minutes, with the step (5, 10, 15, 20, 30, or 60 minutes) chosen for about five to seven ticks.
   - Label them in whole minutes ("10", "20"), and label the exact end in m:ss ("57:20").
   - Drop any tick label that would sit within about 40 px of the end label.
   - Title the axis "Runtime (min)".
   - Build this as a pure function in `profileChartModel.ts`.
2. **Unstretched text.** Size the viewBox to the measured plot width (for example with a `ResizeObserver`), or draw the axis text in HTML, so 11 px text renders at 11 px on every screen. Remove the phone font-size workaround. Pointer-to-runtime mapping must stay exact.
3. **Three-class strip.**
   - Classes: travel (descent, bottom, ascent, penetration, exit), stop, and bailout.
   - Merge consecutive segments of the same class into one block. Zero-duration switch segments never break a run, and a stop and a bailout never merge with travel.
   - Keep the existing surface-colored gap between blocks.
   - Colors: travel is `var(--bf-line-strong)`, stop is `#8b84d6` (the new `--bf-phase-stop`), and bailout is `#c47350` (the new `--bf-phase-bailout`). The deco-window washes use the stop color at their current low opacity. The legend and the "Timeline durations" keys use the same three swatches.
   - The ceiling checkpoint stays `--bf-warning`, because it marks a limit.
   - Keep `--bf-phase-penetration` and `--bf-phase-exit` unchanged; the Cave timeline uses them.
4. **Palette evidence.** Both new colors pass the dataviz palette checks on `#0b1118` and `#10171f`, all pairs:
   - CVD ΔE 19.7 and normal-vision ΔE 20.0 between them;
   - at least 5:1 contrast on both surfaces;
   - the depth trace keeps the accent `#5ec8e5` as the one highlighted series (its lightness is above the categorical band), and its separation from both passes (CVD ΔE at least 13.7).

   Record this in `design.md`.
5. **A readout that never moves.**
   - Always render the Event cell, with the ledger's empty-cell placeholder (`—`) when the selection is not on an event.
   - Keep the set of cells fixed for a plan: Setpoint for CCR only, Ceiling always.
   - Drop the Breathing cell for open-circuit plans only. CCR plans keep it, because it separates loop from open-circuit bailout.
   - On phones, lay the cells out in two columns.
   - Scrubbing must never change the readout's height.
6. **Ceiling note.** Replace the paragraph with one sentence: "Amber marker: the model's ceiling at the end of the inspected segment, a checkpoint rather than a continuous line."
7. **Unchanged.** What the chart draws from the plan: segments, event markers, the ceiling checkpoint, scrubbing, and `aria-valuetext`. The Setpoint cell keeps its value source and label. The 2026-09-30 review of `documentation/profile-exposure-traces.md` found that a segment's `setpointBar` can differ from the loop PPO₂ on ambient-limited CCR legs; that decision belongs to the traces work, so do not relabel or recompute the cell here. Add no animation.

## Out of scope

- Continuous traces (PPO₂, GF, tissues, cylinder pressure, CNS). They are covered by `profile-exposure-traces.md` and its contract review.
- The CCR bailout comparison (`ccr-bailout-comparison.md`) and anything in `src/app/PlanResultView.tsx`.
- `src/styles/layout.css` (the Cave timeline), and any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- `src/ui/ProfileChart.tsx`, `src/ui/profileChartModel.ts`, and `src/ui/profileChartModel.test.ts`
- `src/styles/profile.css`, `src/styles/tokens.css` (the phase block only)
- a new `tests/ui/profile-chart.spec.ts`, and the `tests/ui/smoke.spec.ts` assertions named under Tests
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `design.md`, `documentation/flows.md` (the profile description), `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest:
  - tick steps and labels for 10-minute, 57:20, 1:45:00, and 4-hour plans, and the end-label rule;
  - merging: a 16-minute stop is one block, stops alternate with travel, bailout never merges with travel, and zero-duration switches are skipped.
- Playwright, in the new spec file:
  - Focus the primary profile on the default draft, press ArrowRight through every boundary, and assert the plot's top never moves. The same check fails today at the first gas switch (538 to 591 px at 1440 × 1024).
  - The Event cell shows the empty-cell placeholder (`—`) away from events.
  - Every tick label is a whole minute except the end label.
- Update the smoke assertions these requirements change: the scrubber case in `tests/ui/smoke.spec.ts` checks the old ceiling-note copy ("horizontal position for segment-end time" and "No marker means no ceiling at that segment’s end") and a 17px ceiling label at phone width. Check the new one-sentence note and the native label size instead, and leave that case's other assertions as they are.
- Visual:
  - `profile-selected`, `plan-results`, and `cave-results` change on phone, tablet, and desktop.
  - Add a calculated CCR plan case (none exists today) with `--update-snapshots=missing`, then inspect it.
  - Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `design.md`: the three-class strip, its colors and validation numbers, and the rule that the ceiling checkpoint keeps the warning color.
- `documentation/flows.md`: minute ticks, the strip classes, and the fixed readout.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "The profile chart ticks runtime in whole minutes, shows deco stops in violet instead of the warning amber with each stop as one block, keeps its text sharp on every screen, and no longer shifts while you scrub." Do not bump the version.

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
