# Brief: A Leave column in the runtime schedule

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30, including exact m:ss with no rounding). Proposal V7.
- **Status:** ready to implement once its order allows. No engine, calculation, storage, or schema change.
- **Suggested branch:** `cursor/runtime-leave-column`, from the latest `main`.
- **Order:** third wave, after `gas-budget-bars.md` (both edit `src/app/PlanResultView.tsx` and `src/ui/index.tsx`). It can run at the same time as `tools-pressure-bar.md`; they share no source file, but both edit `tests/ui/visual.spec.ts`, `documentation/tests.md`, and `CHANGELOG.md`, so whichever lands second rebases and merges them. `ccr-bailout-comparison.md` starts after this lands.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **Columns.** `RuntimeSchedule` (`src/ui/index.tsx`) shows Runtime (min), Depth, Time, Gas, and Instruction.
- **Row source.** `runtimeRows` in `src/app/PlanResultView.tsx` maps each `GroupedRuntimeSegment` from `runtimeScheduleRows` (`src/app/runtimeRows.ts`) to a row. The Runtime column is the row's start runtime rounded to the nearest minute (`Math.round(startRuntimeSeconds / 60)`).
- **Folded rows.** A folded stop row starts when the diver leaves the previous stop and includes the travel ("stop (incl. 1:00 ascent)").
- **What a slate needs.** When to leave each stop. The diver gets it today by adding the rounded start and the stop time. On the default draft, the 20 ft oxygen stop row starts at 39 (rounded) with 16:00, and the diver leaves at 55:20.

## Requirements

1. **The column.** Add a "Leave" column after Time. Each row shows its end runtime, `startRuntimeSeconds + durationSeconds` of the folded row, in exact m:ss (h:mm:ss past an hour) with `formatDuration` from `src/app/helpers.ts`. Do not round to minutes.
2. **Compute it in `runtimeRows.ts`,** next to the folding, from the emitted segment times. It is presentation arithmetic on emitted values, and it never feeds a calculation.
3. **Row meanings.**
   - A switch row with no duration leaves at its start.
   - The bottom row leaves at the end of bottom time.
   - The ascent to the first stop leaves at arrival at that stop.
   - The final ascent leaves at surfacing, which equals the plan's runtime.
4. **Unchanged.** The Runtime (min) column keeps its values and header, and nothing else in the schedule, the profile, or the profile data table changes. On phones the table keeps scrolling sideways as today.
5. The header is plain text. Add no colors and no motion.

## Out of scope

- Any change to how rows fold, to rounding elsewhere, or under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- `src/app/runtimeRows.ts` and `src/app/runtimeRows.test.ts`
- `src/app/PlanResultView.tsx` (the runtime row mapping only)
- `src/ui/index.tsx` (`RuntimeRow` and `RuntimeSchedule` only)
- a new `tests/ui/runtime-leave-column.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest:
  - Leave for a folded stop row, a switch-on-arrival row, a zero-duration switch row, the bottom row, the ascent to the first stop, and the final ascent, whose Leave equals the plan runtime.
  - A plan longer than an hour (the default draft at 45 minutes runs 1:45:00).
- Playwright: on the default draft, the 20 ft oxygen stop row reads Leave 55:20, and the last row's Leave equals the Runtime tile (57:20).
- Visual: `plan-results` changes on phone, tablet, and desktop. Cave results fold their tables, so check whether `cave-results` changes. Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `documentation/flows.md`: the Leave column and its exact m:ss format.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "The runtime schedule adds a Leave column with the exact runtime to leave each stop, so a slate needs no adding." Do not bump the version.

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
