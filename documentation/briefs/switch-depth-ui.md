# Brief: Tank Bank and Plan switch-depth UI: keep inherited switches when moving cylinders, clear stale form errors

- **Source:** follow-up to Tank Bank switch depth (PR #21) and the planner PPO₂ tolerance fix (`cursor/switch-depth-ppo2-tolerance-6991`). Two small UI bugs remain after the form MOD check and planner tolerance are aligned.
- **Status:** ready to implement. No engine, calculation, cave-layer, storage, or schema change.
- **Suggested branch:** `cursor/switch-depth-ui`, from the latest `main` (rebase if the PPO₂ tolerance PR has not merged yet; it shares only `CHANGELOG.md` and `documentation/tests.md`).
- **Order:** land after the planner PPO₂ tolerance work when that branch is open; otherwise land independently.

Read `AGENTS.md` first. It is binding, including the verification matrix and the git policy.

## Current behavior

References are to `main` after Tank Bank switch depth landed.

### Inherited switch depth dropped when moving cylinder sources

1. A deco or bailout Plan gas with `switchDepthM` undefined that selects a Tank Bank cylinder whose `gas.switchDepthM` is set shows that value in the switch-depth field (`displayedSwitchDepthM` in `src/app/PlanPage.tsx` falls back to `selected?.gas.switchDepthM`).
2. `bankGasAndCylinder` in `src/app/planning.ts` also inherits the bank record's switch depth when the draft's own value is undefined, so the calculation matches the display.
3. `withTankSourceSelection` copies a record's switch depth onto the draft when the newly selected record has one. When the newly selected record has none, it only changes `cylinderId` and leaves the draft's `switchDepthM` as-is (including `undefined`).
4. So a gas that was *displaying* an inherited switch from cylinder A (draft still `undefined`), then moved directly to cylinder B that has no stored switch depth, drops the displayed and calculated switch depth to empty / absent instead of keeping the value the diver was looking at.

Reproduction sketch:

- Create two Tank Bank deco cylinders: A with a switch depth (for example Oxygen at 20 ft / 6 m), B without a switch depth.
- On Plan, add or use a bailout/deco gas whose draft `switchDepthM` is undefined (new bailout row starts that way).
- Select A: the field shows A's switch depth. If the draft still has `switchDepthM` undefined (inherit mode after clearing the field, or any path that sets `cylinderId` without materializing the inherited value), the UI still shows A's depth.
- Change the cylinder source directly from A to B: the switch depth disappears.

Also cover the path where the diver clears the switch-depth field while A is selected (back to inherit mode), then moves to B: the inherited value must not vanish.

### Stale Tank Bank switch-depth form error

1. `TankBankPage` validates only on Save (`validateTankBankDraft` → `setErrors`). Errors clear only when beginning a new edit (`beginEdit`).
2. Changing O₂ (%), maximum PPO₂, or role updates the draft but does not revalidate or clear `errors`.
3. After a failed save with "Switch depth must not be deeper than the MOD…", raising max PPO₂, leaning the mix, clearing the switch depth, or changing role away from deco/bailout leaves the error on screen even though the draft would now pass.

## Requirements

1. **Materialize inheritance on cylinder change.** In `withTankSourceSelection` (`src/app/planning.ts`), when changing from one Tank Bank cylinder to another (or detaching), if the draft's `switchDepthM` is undefined and the previously selected record had `gas.switchDepthM`, copy that previous value onto the draft before applying the new selection rules. Then apply today's rules: a new record with a switch depth overwrites; a new record without one (or detach) keeps the draft value (now materialized). Bottom/travel/diluent roles still must not copy switch depths from records.
2. **Unit-test the move.** Extend `withTankSourceSelection` tests in `src/app/planning.test.ts`: deco/bailout draft with `switchDepthM` undefined, previous cylinder A with a switch depth, select B without one → draft keeps A's switch depth and B's `cylinderId`. Selecting B that has its own switch depth still takes B's. Detach after inherit materializes the previous value onto the ad hoc draft.
3. **Clear or revalidate Tank Bank errors on relevant edits.** In `src/app/TankBankPage.tsx`, when the editing draft's O₂, helium, maximum PPO₂, role, or switch depth changes, either clear `errors` or re-run `validateTankBankDraft` and set the result. Prefer revalidation so a still-invalid switch depth keeps showing the current message. Begin-edit still clears.
4. **Playwright or Vitest coverage for the stale error.** Prefer a focused Vitest/page-helper test if one exists for the form; otherwise extend `tests/ui/tank-bank-switch-depth.spec.ts`: enter a switch deeper than MOD, attempt save, raise max PPO₂ (or clear switch depth / change role) and assert the switch-depth error is gone without needing a successful save first.

## Out of scope

- Planner / domain PPO₂ comparison tolerance (`src/domain/validation.ts`, `src/engine/planner.ts`) — owned by the tolerance PR.
- Tank Bank MOD depth check math (`validateTankBankDraft` rejection thresholds), except calling it for live form feedback.
- Storage schema, Saved Plans, Tools, Cave route logic, visual baseline refreshes unless a Playwright case forces a visual path (prefer not).

## Owned paths

- `src/app/planning.ts` (`withTankSourceSelection` only)
- `src/app/planning.test.ts` (selection cases only)
- `src/app/TankBankPage.tsx` (error clear/revalidate on edit)
- `tests/ui/tank-bank-switch-depth.spec.ts` and/or a small Vitest if cleaner
- `documentation/tests.md`, `documentation/flows.md` (one sentence each if behavior is user-visible), `CHANGELOG.md`

## Tests

```bash
npm run check
npm run test:ui -- --grep "switch depth"
```

## Done when

1. Moving a deco/bailout gas from a Tank Bank cylinder that supplied an inherited switch depth to another cylinder (or detach) keeps that switch depth on the draft unless the new cylinder supplies its own.
2. Changing O₂, max PPO₂, role, or switch depth on the Tank Bank form updates or clears the switch-depth error without requiring another Save click to refresh stale text.
3. Acceptance commands pass. No version bump. Changelog notes both fixes under Unreleased.
4. This brief is deleted in the implementing pull request.
