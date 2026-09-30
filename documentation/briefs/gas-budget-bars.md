# Brief: Gas budget bars in every gas ledger, status first

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30, including one bar per cylinder scaled to that cylinder). Proposal V3.
- **Status:** ready to implement once its order allows. No engine, gas-layer, calculation, storage, or schema change: every value and position comes from fields the gas ledger already emits.
- **Suggested branch:** `cursor/gas-budget-bars`, from the latest `main`.
- **Order:** second wave. Start after `color-semantics.md` (it edits `src/app/PlanResultView.tsx` and `src/styles/results.css`) and `profile-chart-legibility.md` (it edits `src/styles/tokens.css`) have landed. `runtime-leave-column.md`, `tools-pressure-bar.md`, and `ccr-bailout-comparison.md` start after this lands. `saved-plan-cards.md` can run at the same time; it shares no source file with this brief, but both edit `documentation/architecture.md`, `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md`, and `tests/ui/visual.spec.ts`, so whichever lands second rebases and merges them.

Read `AGENTS.md` first. It is binding, including the scientific invariants (expected consumption and reserve are separate quantities; every cylinder pressure keeps its cylinder context), the verification matrix, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **Where the ledger appears.** `PlanResultView` (`src/app/PlanResultView.tsx`) renders one `GasLedger` table (`src/ui/index.tsx`) per plan. That covers the primary plan, the CCR bailout plan, and each Cave base and scenario plan (folded into a "Gas ledger" disclosure in compact mode). Reopened Saved Plans render through `PlanResultView` in `src/App.tsx`.
  - `ledgerRow` builds the cells.
  - Cylinder plans show Gas, Used, Reserve, Remaining, and Status. Gas-only plans show Gas, Used, Reserve, Minimum to carry, and "Not checked (gas only)".
  - The starting pressure is not shown, and the cylinder description repeats in three cells.
- **Phone width.** The table is at least 35rem wide (`.bf-scroll-table table` in `src/styles/results.css`), so at 375 px it scrolls sideways and Remaining and Status start off-screen.
- **What the ledger emits.** `GasLedgerEntry` (`src/domain/types.ts`) carries `startingVolumeL` (already reduced by any dil-out deduction), `preBailoutDeductionL`, `totalUsedL`, `reserveL`, `remainingVolumeL`, `remainingPressureBar`, `startingPressureBar`, `cylinderWaterVolumeL`, `workingPressureBar`, `sufficient`, and, for gas-only plans, `gasOnly` and `requiredVolumeL`. When a cylinder crosses its reserve, it also carries `reserveCrossing` with `runtimeSeconds`, `depthM`, `expectedPressureBar`, and `requiredPressureBar`.
- **The ledger's model is linear.** Volume is water volume times gauge pressure (`src/gas/ledger.ts`), so a position along a cylinder's volume reads the same as a position along its gauge pressure.
- **Include switches.** Plan Review's switches (0.6.0) live in a separate "Gases in this plan" panel. A switched-off gas has no ledger entry.

## Requirements

1. **One row per ledger entry, status first.** Put the rows above each ledger table (the table stays as the text equivalent). Each row shows:
   - a status chip with icon and label: Sufficient, Short, or Not checked;
   - the cylinder name, its capacity, and its starting pressure;
   - Used, Reserve, and Left, the last with its pressure, formatted as today;
   - the bar.

   On phones the row stacks (chip and name, capacity, bar, then the three numbers), so the status is never off-screen.
2. **Bar geometry, one frame per cylinder.**
   - The frame is the full cylinder: `startingVolumeL + (preBailoutDeductionL ?? 0)`.
   - From the left, draw the pre-bailout deduction, if any, then `totalUsedL`.
   - The reserve zone is the last `reserveL` of the frame, drawn as a darker track with a reference tick at its boundary. The dil-out reserve stays on the full cylinder, as the ledger computes it.
   - The empty track between the end of use and the reserve boundary is the margin.
   - Use that reaches into the reserve zone is drawn in the danger color after a 2 px surface gap.
   - Label the end of use with the emitted `remainingPressureBar` ("1351 psi at surfacing").
   - If use exceeds the frame, stop the bar at the frame and label its end "exceeds the cylinder" with no pressure. The ledger does not clamp `remainingPressureBar`, so it can be negative there; the numbers row keeps the ledger's emitted Left value, as the table does.
   - Print no number the ledger does not emit: no margin value, and no reserve pressure except `reserveCrossing.requiredPressureBar` when the reserve is crossed.
3. **Gas-only rows.** The frame is `requiredVolumeL`: use, then reserve, labeled "Expected use" and "Minimum to carry", with the Not checked chip.
4. **Crossing caption.** When `reserveCrossing` is present, add one line, for example "Crosses its 508 psi reserve at 42:53 · 131 ft". It is the same point as the reserve marker on the profile.
5. **Colors.** Add two tokens to `src/styles/tokens.css`: `--bf-chart-used: #7a8aa3` for use, and `--bf-chart-used-prior: #56657a` for the pre-bailout deduction. The track is `--bf-surface-3`, the reserve zone `--bf-line`, the boundary tick `--bf-text-faint`, and use inside the reserve `--bf-danger`. The dataviz checks pass:
   - the two fills as an ordinal pair: monotone, lightness steps of at least 0.06, with the darker fill (`#56657a`, nearest the surface) at 3.04:1 and the lighter (`#7a8aa3`) at 5.15:1 on `#10171f`;
   - use against danger: CVD ΔE 9.4 and normal-vision ΔE 19.0, with the surface gap.

   Status still carries an icon and a label; color is never the only signal.
6. **A pure model.** Compute positions in a pure presentation model (for example `src/ui/gasBudgetModel.ts`) from the emitted fields, as fractions of the frame. Add no other arithmetic, and no formula from `src/gas`.
7. **Accessibility.** Each bar is `role="img"` with a name built from the same values, for example "Tx18/45 cylinder, short: used 172.4 ft³, reserve 29.7 ft³, 5.6 ft³ left at 95 psi, crosses its reserve at 42:53, 131 ft". No value is available only on hover.
8. **Everywhere the ledger appears.** Primary, CCR bailout, Cave base and scenario (inside their disclosures), and reopened Saved Plans, all through `PlanResultView`. Add no motion; bars render at their final size.

## Out of scope

- A margin or reserve-pressure field in the gas layer. Printing them would need a `src/gas` change with a scientific review.
- Pressure bars in Tools, which `tools-pressure-bar.md` covers after this lands and reuses this component.
- Any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- new `src/ui/gasBudgetModel.ts`, `src/ui/gasBudgetModel.test.ts`, and `src/ui/GasBudget.tsx`
- `src/ui/index.tsx` (the export only)
- `src/app/PlanResultView.tsx` (the ledger area only)
- `src/styles/results.css` (a gas budget section), `src/styles/tokens.css` (the two chart tokens)
- a new `tests/ui/gas-budget.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes or adds
- `design.md`, `documentation/flows.md`, `documentation/architecture.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest, model:
  - a sufficient cylinder (the default draft's back gas: 99.0 ft³ used, 29.7 ft³ reserve, 1351 psi left);
  - a short cylinder with a crossing (the default draft at 45 minutes: 172.4 ft³ used, 5.6 ft³ left at 95 psi, crossing at 42:53 and 131 ft);
  - use beyond the frame;
  - a gas-only row;
  - dil-out with its deduction and the reserve on the full cylinder;
  - a zero-volume guard.
- Playwright, in the new spec file:
  - At 375 px every row's status chip is inside the viewport without horizontal scrolling.
  - On the 45-minute draft, the crossing caption's runtime matches the profile's reserve marker.
  - Each bar's accessible name carries status, used, reserve, and left.
  - A switched-off gas shows no row.
- Visual:
  - Add a "gas budget" case for the default draft and the 45-minute draft on phone, tablet, and desktop.
  - `plan-results` changes; `cave-results` changes only if a ledger disclosure is open in that capture.
  - Follow the baseline rules in `AGENTS.md`.
- Baselines, the same contract in every brief of this set:
  - Playwright names them per operating system: `-darwin.png` on macOS, `-linux.png` on Linux (its default snapshot path; `playwright.config.ts` does not override it). CI runs `npm run test:ui` only, so nothing compares them automatically.
  - Every visual case has `-darwin` files, and only `plan`, `cave`, and `cave-results` also have `-linux` files. Render and inspect the `-darwin` files on macOS before merge.
  - Render only your own operating system's files, only for the cases you change or add, and never copy bytes between suffixes (commit `7b9fdea` shows Linux bytes under `-darwin` names failing by 2 to 3%). List in the pull request the files of those cases that still need a render on the other operating system.
  - On Linux, run `npm run test:visual -- --grep "<case title>"` for those cases. A full run fails every case without `-linux` files as missing and writes files for it; do not commit those.
  - At `ee16534`, 19 of 36 cases already fail on macOS because their `-darwin` files predate the 0.6.0 to 0.8.0 changes. A separate pull request refreshes them before this set starts; if they still fail, stop and report it rather than refreshing them here.

## Documentation and changelog

- `design.md`: the bar, its colors and validation numbers.
- `documentation/flows.md`: the rows above each ledger.
- `documentation/architecture.md`: the model and component.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Each gas ledger starts with one bar per cylinder: gas used, the reserve at the empty end, and what is left at surfacing, with the status first so it stays visible on a phone." Do not bump the version.

## Verification

```bash
npm run check
npm run test:ui
npm run test:visual
git diff --check
```

How reserves are drawn is safety-relevant. Before merge, get an independent read-only review of the bar geometry against `src/gas/ledger.ts`, including dil-out and gas-only entries.

## Git and pull request

- Sign every commit (`git commit -S`), open one pull request against `main`, and delete this brief in that pull request.
- Merging stays with Jonah; do not merge the pull request yourself.
