# Brief: Include in plan switches in Plan Review

- **Source:** tester feedback item #21: make the deco and bailout on/off switch available in Review, so a diver looking at lost gas can see the effect of using or losing a cylinder.
- **Status:** ready to implement. No engine, calculation, storage, or schema change.
- **Suggested branch:** `cursor/review-gas-switches`, from the latest `main`.
- **Order:** land this before the Tank Bank switch depth work (item #18, brief `tank-bank-switch-depth.md` in this folder); both edit `src/app/PlanPage.tsx`.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `5004378`.

- Deco gases (open circuit) and bailout gases (CCR) have an "Include in plan" checkbox in Setup only. It is `GasEditor` in `src/app/PlanPage.tsx` with the `switchable` prop, and it writes `GasDraft.enabled`, where `undefined` means included. `activeGasDrafts` in `src/app/planning.ts` leaves switched-off gases out of the calculation.
- Since 0.5.2, a switch recalculates like any other edit, including for a gas sourced from Tank Bank; there is no explicit update prompt.
- `PlanPage` renders `PlanResultView` (`src/app/PlanResultView.tsx`) only while the workspace status is `current`. Any edit moves the status to `updating`, and the effect that checks `reviewAvailable` sends the view back to Setup. A switch placed in Review without changing that rule would throw the diver back to Setup on every click.
- A switched-off gas has no row in the gas ledger, because it is not part of the calculated plan.
- Setup and Review are never rendered at the same time (`session.view === "setup" ? … : …`).

## Requirements

1. In Plan Review, list every deco gas (OC) or bailout gas (CCR) in the draft, switched on or off, each with an "Include in plan" switch. Put deco gases with the Primary gas ledger and bailout gases with the Bailout gas ledger. A switched-off gas stays listed, with its switch off and the text "Not in plan". If one "Gases in this plan" group above the Primary profile reads better on phone, use it instead; decide from the phone, tablet, and desktop screenshots and say which you chose in the PR.
2. The switch writes the same `GasDraft.enabled` field through the same draft update as Setup. Add no new state. Prefer a small pure helper in `src/app/planning.ts` (for example `withGasIncluded(draft, key, included)`) with unit tests over inline array edits.
3. After a switch in Review, Review stays open while the plan recalculates:
   - `updating`: show the switches and the existing status text ("Inputs changed. Recalculating automatically; previous results are hidden."), never the previous result.
   - `needs-attention`, for example every bailout gas switched off: show the switches and the calculation diagnostics, so the diver can switch a gas back on from Review.
   - `source-changed`, `source-unavailable`, and `cylinder-shared` keep today's behavior and return to Setup, where their controls are.
   - Opening Review from Setup still requires `current`.
   - This rule also applies when a Tools patch changes the draft while Plan was left in Review; the existing Tools-to-Plan smoke tests must still pass.
4. Never show a superseded result beside edited inputs (AGENTS.md): no metrics, profile, runtime table, or ledger from the previous input while the status is not `current`. Save stays unavailable until the result is current.
5. Switching a gas off and back on returns a byte-identical result, because the input signature is the same.
6. The accessible name is `Include <gas name> in plan`, as in Setup. Space toggles the switch, and focus stays on it across the recalculation.
7. Plan only. Cave Review, a reopened Saved Plan, and nested Cave scenario output (`PlanResultView` with `compact`) show no switches. Pass the switches in through an optional prop that only `PlanPage` sets.
8. Style with the existing controls and tokens (the `bf-check` checkbox used in Setup, or `ToggleField`). Add no colors and no new motion, and never animate a number.

## Out of scope

- A side-by-side lost-gas comparison (one derived plan per missing gas, with deltas). That is ROADMAP "Later candidates: open-water planning depth" item 3.
- Travel-gas and dil-out switches in Review.
- Any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- `src/app/PlanPage.tsx`, `src/app/PlanResultView.tsx`
- `src/app/planning.ts` (the helper only) and `src/app/planning.test.ts`
- the `src/styles/` section file the new markup belongs to, most likely `results.css`
- a new `tests/ui/review-gas-switches.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest: the helper switches a deco gas and a bailout gas off and on, treats an unknown key as a no-op, and leaves every other gas and field untouched. If the Review-stays-open rule is extracted into a pure function, test each status there.
- Playwright, in the new spec file (the `smoke-desktop` project runs every spec except `visual.spec.ts`):
  - OC default plan (EAN50 and oxygen deco gases): calculate, open Review, and switch oxygen off. Review stays open and shows Updating with no result, then a result with a longer runtime; Save is unavailable until then. Switch oxygen back on and the runtime returns to its original value.
  - CCR plan: switch a bailout gas off and on from the Bailout gas ledger. Switch every bailout gas off: Review shows the diagnostics and the switches, and switching one back on recovers.
  - Keyboard: toggle with Space, and check that focus stays on the switch.
  - Cave Review and a reopened Saved Plan show no switches.
- Visual: the `calculated plan output visual baseline` case (`plan-results-*.png`) changes on phone, tablet, and desktop. Follow the baseline rules in `AGENTS.md`, and inspect all three images before committing.

## Documentation and changelog

- `documentation/flows.md`: Review can switch deco and bailout gases in or out, and what the diver sees while it recalculates.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Plan Review lists each deco gas, and each CCR bailout gas, with an Include in plan switch, so you can see the plan without a gas without going back to Setup. Review stays open while the plan recalculates." Do not bump the version.

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
