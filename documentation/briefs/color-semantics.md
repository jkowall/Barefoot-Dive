# Brief: Green only for calculated sufficiency, neutral freshness pills, and a completion cue that shows safety errors

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30). Proposals V1 and B1.
- **Status:** ready to implement. No engine, calculation, storage, or schema change.
- **Suggested branch:** `cursor/color-semantics`, from the latest `main`.
- **Order:** first wave, in parallel with `profile-chart-legibility.md`, which edits none of this brief's source files. Both edit `design.md` and change the `plan-results` and `cave-results` baselines, which cannot be merged as text: whichever lands second rebases, merges `design.md`, and renders those baselines again. `gas-budget-bars.md` and `tools-pressure-bar.md` start after this lands, because they edit `src/app/PlanResultView.tsx`, `src/app/ToolsPage.tsx`, and `src/styles/results.css`. Every brief also shares `tests/ui/visual.spec.ts`, `documentation/flows.md`, `documentation/tests.md`, and `CHANGELOG.md`.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **Tools:** `ResultDetails` in `src/app/ToolsPage.tsx` gives the primary value `tone="safe"` in every calculator, whatever the value: MOD, Best Mix, PPO₂, END, gas density, SAC/RMV, gas duration, cylinder gas, and Emergency Gas required gas. `calculatePPO2` returns no status, so PPO₂ 2.13 bar (air at 300 ft) renders green, and so does gas density 8.19 g/L at 330 ft. CNS shows warning at 100% or more and safe below.
- **Plan Review:** the "Safety status" tile shows "Calculated" in safe green. The "Bailout status" tile shows the raw value ("calculated", lower case) in safe green.
- **Cave Review:** the "Aggregate cave status" tile shows "No calculation errors" in safe green, although its detail says "Calculation status only; not a safety or field-validation claim". The "Limiting resource" tile shows "none" in safe green.
- **Status pills** (`src/styles/controls.css`): Plan and Cave "Current" and Tools "Live result" use `--bf-safe`.
- **Completion cue:**
  - `PlanPage` announces "Plan calculation complete" after every successful calculation, including a plan whose `safetyStatus` is `"unsafe"`. The default draft at 45 minutes is one: its back-gas cylinder crosses its reserve at 42:53 (`RESERVE_CROSSED`).
  - `CavePage` announces "Cave calculation contains safety errors" with the same accent border draw as a success.
  - `CompletionNotice` in `src/ui/index.tsx` has no tone.

## The rule

The safe color marks only a sufficiency status the calculation itself returned:
- a gas-ledger or Emergency Gas `sufficient` flag;
- a Cave scenario's `safe` flag;
- the sign of the Cave reserve margin.

Every other measured value or label is neutral text. Danger stays for unsafe, insufficient, and error states. Warning stays where it marks a status today, such as CNS at or above 100%, an older engine, or a changed source.

## Requirements

1. **Tools.** The primary value of every calculator uses the default tone. Emergency Gas keeps its "Margin" and "Cylinder check" tones, which come from `sufficient`. CNS uses the default tone below 100% and warning at or above 100%. This is a deliberate exception: the percentage is measured against the NOAA single-exposure limit for that PPO₂ (linearly interpolated between table rows, a Barefoot policy), so 100% is that limit rather than a new threshold.
2. **Plan Review.** "Safety status" and "Bailout status" use the default tone for "Calculated" and danger for "Unsafe". The bailout value is capitalized the same way as the primary one.
3. **Cave Review.**
   - "Aggregate cave status" uses the default tone for "No calculation errors" and danger for "Unsafe or unavailable".
   - "Limiting resource" uses the default tone for "none" and keeps warning otherwise.
   - "Reserve margin" and "Scenario status" keep their tones.
4. **Pills.** "Current" and "Live result" become a neutral pill: `--bf-text` label, `--bf-line-strong` border, and an `--bf-accent` dot. They mean the result matches the inputs, not that it is safe. Their text and live-region behavior stay unchanged. "Updating" and the blocked states keep their current colors and pulse.
5. **Completion tone.** Give `CompletionNotice` an optional `tone` (`"default"` or `"danger"`). Danger draws the border in `--bf-danger` instead of `--bf-accent`; the copy keeps text colors.
   - A Plan calculation whose `safetyStatus` is `"unsafe"` announces "Plan calculated with safety errors", with "Review the diagnostics before saving or using this plan.", in the danger tone.
   - Cave's existing "Cave calculation contains safety errors" uses the danger tone.
   - Saves, Tank Bank, and Tool notices are unchanged. Reduced motion still shows the finished border at once.
6. Use existing tokens only. Add no colors, gradients, or motion.

## Out of scope

- Thresholds for PPO₂, gas density, or END. Judging those values needs a versioned policy with sources, which is separate scientific work.
- The Saved Plans engine tile, which `saved-plan-cards.md` owns.
- The profile chart, its tokens, and its styles, which `profile-chart-legibility.md` owns.
- Any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- `src/app/ToolsPage.tsx` (the tones in `ResultDetails` only)
- `src/app/PlanResultView.tsx` (the two status tiles only)
- `src/app/CavePage.tsx` (the two tiles and the tone on its completion call)
- `src/app/PlanPage.tsx` (the completion call only)
- `src/ui/index.tsx` (`CompletionNotice` only)
- `src/styles/controls.css` (the pill rules), `src/styles/results.css` (the completion danger variant)
- a new `tests/ui/color-semantics.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `design.md`, `documentation/tools.md`, `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Playwright, in the new spec file:
  - PPO₂ at 300 ft and gas density at 330 ft show the primary metric with `data-tone="default"`.
  - An insufficient Emergency Gas case keeps `data-tone="danger"` on Margin.
  - Plan Review's "Safety status" is `data-tone="default"` for the default draft.
  - The default draft at 45 minutes announces "Plan calculated with safety errors" in the danger tone. Expose the tone as `data-tone` on the notice.
  - The unsafe nested-scenario Cave case announces "Cave calculation contains safety errors" in the danger tone.
- Keep the existing "Plan calculation complete" and "Cave calculation complete" assertions; they cover plans without errors.
- Visual: `tools-result`, `tools-emergency`, `plan-results`, and `cave-results` change on phone, tablet, and desktop. Follow the baseline rules in `AGENTS.md`, and inspect all images before committing.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `design.md`: state the rule above next to the existing sentence on semantic colors.
- `documentation/tools.md`: result tones.
- `documentation/flows.md`: the completion copy for a plan with safety errors.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Green now appears only where a calculation reports sufficient gas or a safe scenario. Tools results, Current and Live result labels, and the Calculated status are neutral, so PPO₂ 2.13 bar no longer shows as green, and a plan calculated with safety errors says so in red." Do not bump the version.

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
