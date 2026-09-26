# Brief: Switch depth on Tank Bank cylinders

- **Source:** tester feedback item #18: add the switch depth as a value attached to individual gases in Tank Bank.
- **Status:** ready to implement after [review-gas-switches.md](review-gas-switches.md) merges; both edit `src/app/PlanPage.tsx`. No engine, calculation, or storage-schema change.
- **Suggested branch:** `cursor/tank-bank-switch-depth`, from the latest `main`.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy.

## Current behavior

References are to `main` at `5004378`.

- Tank Bank records can already carry an optional `gas.switchDepthM`, in metres. `src/storage/schema.ts` validates it as a finite number, and `toDraft` in `src/app/TankBankPage.tsx` keeps an existing value when a record is edited. The form has no field for it, so no record gets one from the UI.
- In Plan and Cave, `bankGasAndCylinder` in `src/app/planning.ts` uses the gas draft's `switchDepthM` when the draft has one and the record's otherwise.
- New deco gases start at 21 m (`newGas` in `src/app/PlanPage.tsx`), so a record's value never reaches them, and choosing an oxygen cylinder keeps 21 m and fails the PPO₂ check. New bailout gases start with no switch depth, so a record's value would reach the calculation while the field shows 0.
- The cylinder-source select in `GasEditor` (`src/app/PlanPage.tsx`) sets only `cylinderId`. Cave uses the same `PlannerEditor` and `GasEditor`.
- Tank Bank "Use" (`useCylinder` in `src/App.tsx`) starts a new plan with the record as the bottom gas. A bottom gas's switch depth is the travel-to-bottom switch, so "Use" is out of scope.

## Requirements

1. **Form field.** Add an optional "Switch depth" field to the Tank Bank form for records whose role is `deco` or `bailout`. Match Plan's entry rules: whole-foot display, and a feet entry aligned onto the stop grid, so 20 ft stores the 6 m stop. `DepthField` in `src/app/controls.tsx` (`bound="max-ppo2"`, `gridM={PLAN_STOP_INCREMENT_M}`) has those rules but no blank state. Add an optional variant that reuses `resolveDepthEntry` from `src/app/helpers.ts`, so blank means no switch depth, rather than re-implementing the conversion.
2. **Validation.** The depth must be zero or deeper and no deeper than the MOD at the record's maximum PPO₂. Compute the MOD with the same `calculateMOD` call that the card's MOD metric uses (`mod` in `TankBankPage`); add no new formula. Show that MOD in the field's hint.
3. **Saving.** Deco and bailout records store the value as `gas.switchDepthM`, in metres. Saving a record with any other role removes a stored `gas.switchDepthM`, so it never reaches a bottom, travel, diluent, or stage gas unseen. Existing records keep their value until they are edited. There is no storage schema or codec change, because the field already exists and is validated; if you find you need one, stop and ask.
4. **Selection.** When a deco or bailout gas's cylinder source changes to a record with a switch depth, set the gas draft's `switchDepthM` to that value in the same update. Put this in a pure, unit-tested helper in `src/app/planning.ts`. A record without a switch depth leaves the draft's value unchanged, and choosing "Ad hoc plan cylinder" (detaching) keeps it.
5. **The plan owns the value after selection.** Editing the switch depth in Plan never writes to Tank Bank. A later Tank Bank edit never overwrites the draft's value; it still triggers the existing explicit "Update plan" prompt for the record's new revision.
6. **Show what is calculated.** When a deco or bailout draft has no switch depth of its own and its selected record has one, the field shows the record's value, because that is what the calculation uses.
7. **Cave.** Cave gets the same behavior through the shared editor. Confirm it with a test.
8. **Cards.** Tank Bank cards may show the switch depth next to MOD (for example "Switch 20 ft"), formatted with `formatDepth` from `src/app/helpers.ts`.

## Out of scope

- Deriving a switch depth from the MOD automatically. An explicit "Use MOD" button is acceptable; filling the field silently is not.
- Tank Bank "Use", bottom and travel gases, and the Tools.
- Any change under `src/engine`, `src/gas`, `src/domain`, `src/calculations`, `src/cave`, or `src/storage`.

## Owned paths

- `src/app/TankBankPage.tsx`, and a Tank Bank test file if the form logic is extracted
- `src/app/controls.tsx` (the optional depth field only)
- `src/app/PlanPage.tsx` (the source-select handler and the switch-depth field value only)
- `src/app/planning.ts` (the helper only) and `src/app/planning.test.ts`
- `src/styles/pages.css`, if the form or card needs it
- a new `tests/ui/tank-bank-switch-depth.spec.ts`
- `tests/ui/visual.spec.ts` and any snapshots that change
- `documentation/flows.md`, `documentation/architecture.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest:
  - Selection helper: deco and bailout gases take the record's value; a record without one leaves the draft's value; other roles are untouched; detaching keeps the value; a later record revision does not change the draft.
  - Form mapping: a deco record round-trips its switch depth in metres; changing its role to bottom removes it; a feet entry of 20 ft stores 6 m; a depth deeper than the MOD is rejected.
  - Storage: a record with `gas.switchDepthM` round-trips through `src/storage` unchanged. This is a test only, with no storage code change.
- Playwright, in the new spec file, with depths in feet:
  - Create an Oxygen deco cylinder with a 20 ft switch depth. In Plan, add a deco gas and choose that cylinder: the switch depth reads 20 ft, and the plan calculates with no PPO₂ error.
  - Choosing the same cylinder for a Cave deco gas fills in 20 ft.
  - Editing the cylinder's switch depth in Tank Bank shows the explicit update prompt in Plan and leaves the plan's value unchanged.
  - A switch depth deeper than the MOD shows the form error.
- Visual: update any Tank Bank or Plan Setup case whose rendering changes, following the baseline rules in `AGENTS.md`.

## Documentation and changelog

- `documentation/flows.md`: choosing a Tank Bank cylinder fills a deco or bailout gas's switch depth once, and the plan owns it afterward.
- `documentation/architecture.md`: `gas.switchDepthM` on Tank Bank records is now user-editable for deco and bailout records.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Tank Bank deco and bailout cylinders can store a switch depth. Choosing one for a Plan or Cave gas fills in that switch depth, so an oxygen cylinder set to 20 ft plans at the 6 m stop instead of the 21 m default. The plan's value can still be changed, and changing it never changes the cylinder." Do not bump the version.

## Verification

```bash
npm run check
npm run test:ui
npm run test:visual
git diff --check
```

## Git and pull request

- Sign every commit (`git commit -S`), open one pull request against `main`, and delete this brief in that pull request.
- Merging stays with Jonah. A merge to `main` deploys barefootdive.app.
