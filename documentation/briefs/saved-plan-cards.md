# Brief: Saved plan cards that show the stored plan

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30). Proposal V6.
- **Status:** ready to implement. No engine, calculation, storage, or schema change: every value shown is already in the stored record.
- **Suggested branch:** `cursor/saved-plan-cards`, from the latest `main`.
- **Order:** second wave, after `profile-chart-legibility.md` if you reuse `buildProfileChartModel` (that brief changes the model); otherwise independent. Import the new thumbnail component directly rather than through `src/ui/index.tsx`, which `gas-budget-bars.md` and later briefs edit. It runs at the same time as `gas-budget-bars.md`; both edit `documentation/architecture.md`, so whichever lands second rebases and merges it. Every brief also shares `tests/ui/visual.spec.ts`, `documentation/flows.md`, `documentation/tests.md`, and `CHANGELOG.md`.

Read `AGENTS.md` first. It is binding, including the persistence and snapshot rules, the verification matrix, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0). `src/app/SavedPlansPage.tsx` is unchanged since 0.5.2.

- **What a card shows:** the title, the mode and environment, six actions, the created and updated dates with the revision, and three tiles:
  - Engine, in safe green when current and warning when older;
  - Convention;
  - Cave snapshot.

  It also lists the stored warnings. It shows no runtime, TTS, decompression time, maximum depth, gases, or profile shape, so comparing plans means opening each one.
- **Stored data:** each `SavedPlanRecord` (`src/storage/types.ts`) holds the immutable `calculatedPlan` (`DivePlan`, with `summary` and `segments`), `normalizedInputSnapshot`, `warnings`, `engineVersion`, and, for Cave, `caveInputSnapshot` and `caveResultSnapshot`. `collectCaveDiagnostics` (`src/app/caveDiagnostics.ts`) already flattens a stored cave result's diagnostics for the card's warning list and for the "SAVED CAVE SNAPSHOT · UNSAFE" detail header.

## Requirements

1. **Summary row.** Under the dates, show the stored `calculatedPlan.summary` as ruled tiles in tabular monospace:
   - Runtime;
   - TTS;
   - Deco, with the detail "Time at stops", as in Review;
   - Maximum depth, in the depth preference.

   For a CCR plan with a bailout plan, add "Bailout TTS" from `calculatedPlan.bailoutPlan.summary`.
2. **Gases.** List the gas names the stored plan uses, from the stored ledger or the normalized input, in plan order, without duplicates.
3. **Profile thumbnail.** Draw a static line of depth over runtime from the stored `calculatedPlan.segments`: about 56 to 64 px tall, full card width, in the accent color, with no axes, labels, or interaction. Hide it from assistive technology; the summary tiles are its text equivalent. Keep the drawing in a small pure component (for example `src/ui/ProfileSparkline.tsx`).
4. **Unsafe cave snapshots.** When a stored cave snapshot's diagnostics include an error, the card's header says "Unsafe" in the danger color with an alert icon, so color is not the only signal. The detail view's "SAVED CAVE SNAPSHOT · UNSAFE" eyebrow stays as it is.
5. **Engine tile.** Default tone when current, warning when older. Green never marks the engine version.
6. **Recalculate nothing.** An older-engine revision shows its stored numbers next to the existing older-engine warning, and a Recalculate still creates a new revision.
7. Tokens only. Keep the six actions reachable by keyboard in the same order, and add no motion.

## Out of scope

- Comparing two saved plans side by side: a separate product decision, not taken.
- Any change to the saved-plan schema, codecs, migrations, or `src/storage`.
- `src/ui/ProfileChart.tsx` and `src/ui/profileChartModel.ts`, which you may only read, and any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, or `src/cave`.

## Owned paths

- `src/app/SavedPlansPage.tsx`
- a new `src/ui/ProfileSparkline.tsx` with a test for its geometry
- `src/styles/pages.css` (the Saved Plans card rules)
- a new `tests/ui/saved-plan-cards.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it adds
- `documentation/flows.md` (Saved Plans), `documentation/architecture.md` (the new component), `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest: the thumbnail's points follow the stored segments' runtimes and depths, with an empty plan drawing nothing.
- Playwright, in the new spec file:
  - Save the default draft and a Cave plan, then open Saved Plans. Each card shows the stored runtime, TTS, deco, and maximum depth exactly as its Review showed them.
  - A cave snapshot with a stored error shows "Unsafe".
  - The engine tile is not green.
  - The actions keep their keyboard order.
- Visual: add a "saved plans list" case with two records on phone, tablet, and desktop (none exists today); write it with `--update-snapshots=missing` and inspect it. Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `documentation/flows.md`: what a Saved Plans card shows, and that it reads only the stored snapshot.
- `documentation/architecture.md`: the thumbnail component.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Saved plan cards show the stored runtime, TTS, deco time, maximum depth, gases, and a small profile, and mark unsafe cave snapshots, so you can compare plans without opening each one." Do not bump the version.

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
