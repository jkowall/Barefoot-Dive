# Brief: CCR bailout comparison beside the primary plan

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30). Proposal V4.
- **Status:** ready to implement once its order allows. No engine, calculation, storage, or schema change: both traces and every number are emitted plan data.
- **Suggested branch:** `cursor/ccr-bailout-comparison`, from the latest `main`.
- **Order:** fourth wave. Start after `profile-chart-legibility.md` (chart files) and `runtime-leave-column.md` (the last of the briefs that edit `src/app/PlanResultView.tsx` and `src/ui/index.tsx` before this one). `motion-tokens-and-guard.md` comes after it.

Read `AGENTS.md` first. It is binding, including the rule that CCR bailout comes from the exact trigger state, the verification matrix, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **Layout.** For a CCR plan with a bailout plan, `PlanResultView` (`src/app/PlanResultView.tsx`) shows the primary summary, diagnostics, profile, runtime, and ledger. Below them sits a "CCR bailout plan" panel with three tiles (Bailout runtime, Bailout TTS, Bailout status), then the bailout's own diagnostics, profile, runtime, and ledger. On a 1440 px screen the two summaries are about 2,000 px apart, so comparing them means scrolling.
- **Timelines.** Both plans start at runtime 0. The bailout plan repeats the primary segments up to the trigger and cuts short the one the trigger interrupts (the bottom).
  - The default draft in CCR with a 10-minute trigger shows this. The primary bottom segment runs 2:13 + 25:00, the bailout bottom 2:13 + 10:00, and the bailout plan then switches gas at 12:13 and 40 m.
  - With problem-solving time (engine 0.4.0), the switch is followed by a `bailout` segment held at the trigger depth for that time, before the ascent.
- **TTS references differ.** The bailout plan's TTS counts from the trigger runtime, the end of the shortened bottom segment, so it includes the gas switch and any problem-solving hold (`bailoutTriggerRuntime` in `src/engine/planner.ts`). The primary TTS counts from the end of bottom time.
  - On that draft: primary 54:00 runtime, 26:47 TTS from the end of bottom time, 19:00 deco, first stop 15 m (49 ft); bailout 23:20 runtime, 11:07 TTS from the trigger, 4:00 deco, first stop 12 m (39 ft).
  - A 2-minute problem-solving hold makes the bailout 29:00 with a 16:47 TTS.

  The two TTS values are not comparable without their references.

## Requirements

1. **The panel.** Replace the "CCR bailout plan" panel's three tiles with a "Bailout comparison" panel, keeping its "Exact trigger tissue state" eyebrow. The bailout's diagnostics, profile, runtime, and ledger stay below it. The panel holds a two-row table and one chart.
2. **The table.** Rows are Primary (CCR, with its setpoints) and Bailout (open circuit from the exact trigger state). Columns are Runtime, TTS, Deco (time at stops), First stop, and Open-circuit gas.
   - Each TTS cell names its reference: "from the end of bottom time", or "from the trigger at 12:13". With a problem-solving hold, add "including 2:00 of problem-solving".
   - Open-circuit gas is "Loop gas not modeled" for the primary and "2 of 2 cylinders sufficient" for the bailout, counted from the bailout ledger's `sufficient` flags.
   - Never print a difference between the two plans.
3. **The chart.** It shares one runtime axis (0 to the longer runtime, whole-minute ticks as in `profile-chart-legibility.md`) and one depth axis.
   - The primary is a solid accent line.
   - The bailout branch is a dashed line in the bailout color (`--bf-phase-bailout`). It starts where the bailout leaves the shared timeline and includes the flat problem-solving hold.
   - A ring marks the trigger, labeled with its runtime and depth ("Trigger 12:13 · 131 ft").
   - Each line gets a direct end label ("Primary surfaces 54:00", "Bailout surfaces 23:20"), and a legend uses line keys.
   - On phones, use short end labels ("Primary", "Bailout") so they do not collide.
4. **Where the branch starts.** Implement this as a pure, tested function in `src/ui/profileChartModel.ts`.
   - Walk the two segment lists together while the kind, gas, start runtime, start and end depths, and duration match.
   - A bailout segment with the same kind, gas, start, and depths but a shorter duration ends the shared part; the branch starts after it, at the trigger.
   - Any other difference starts the branch at that segment.
   - Return the trigger runtime and depth, and the problem-solving hold's duration, from the emitted segments: the hold is the run of `bailout` segments held at the trigger depth right after the gas switch. `DivePlan` carries no trigger or hold field, and `PlanResultView` receives only the plan, so never read them from the input or recompute a segment.
5. **Accessibility.** The table is the text equivalent. The chart is `role="img"` with a name that states both surfacing runtimes and the trigger. Add no motion, and do not tween or draw the lines in.

## Out of scope

- Overlaying the bailout on the interactive primary profile. Scrubbing semantics stay with `profile-chart-legibility.md` and `profile-exposure-traces.md`.
- Any change to how the bailout plan is calculated, or under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.
- Cave CCR loop-failure scenarios, which Cave Review shows separately.

## Owned paths

- `src/ui/profileChartModel.ts` and `src/ui/profileChartModel.test.ts` (the branch function only)
- a new `src/ui/ProfileComparison.tsx`, exported from `src/ui/index.tsx`
- `src/app/PlanResultView.tsx` (the bailout panel only)
- `src/styles/profile.css` (a comparison section)
- a new `tests/ui/ccr-bailout-comparison.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it adds
- `documentation/flows.md`, `design.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest, branch function, each run through `calculateDivePlan`:
  - the default CCR draft with a 10-minute trigger: the branch starts at 12:13, 40 m;
  - the same with 120 s of problem-solving time: the hold belongs to the branch;
  - dil-out as the only bailout gas;
  - a trigger at 0 minutes;
  - a plan without a bailout plan: no panel.
- Playwright, in the new spec file:
  - The CCR default draft with a 10-minute trigger shows both TTS references and the trigger label.
  - With problem-solving time, the bailout row says it includes the hold.
  - The table is reachable as a table with headers.
- Visual: add a "CCR bailout comparison" case on phone, tablet, and desktop with `--update-snapshots=missing`, and inspect it. Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `documentation/flows.md`: the comparison and its TTS references.
- `design.md`: the dashed branch in the bailout color, and the rule that no difference is printed.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "CCR Review compares the bailout with the primary plan in one panel: runtime, TTS with its starting point, deco, first stop, and bailout gas, with the bailout branch drawn from the trigger on the primary profile." Do not bump the version.

## Verification

```bash
npm run check
npm run test:ui
npm run test:visual
git diff --check
```

CCR bailout is a protected area. Before merge, get an independent read-only review of the branch function and the TTS labels against `src/engine/planner.ts`.

## Git and pull request

- Sign every commit (`git commit -S`), open one pull request against `main`, and delete this brief in that pull request.
- Merging stays with Jonah; do not merge the pull request yourself.
