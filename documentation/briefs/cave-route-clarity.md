# Brief: Cave route clarity: a named ceiling failure, labeled limits, and a cylinder access table

- **Source:** cave audit of 0.5.2 (2026-09-27). A route that rises above its decompression ceiling fails with a message that points at an internal event index, the gas-derived maximums do not say they stretch every leg, and nothing shows which cylinders the diver carries on which leg.
- **Status:** ready to implement. No engine, calculation, cave-layer, storage, or schema change.
- **Suggested branch:** `cursor/cave-route-clarity`, from the latest `main`.
- **Order:** land after `cave-scenario-triggers.md`. Both edit `src/app/CavePage.tsx` and `src/styles/layout.css` and change the `cave-*.png` and `cave-results-*.png` baselines. That brief is deleted when its work lands, so check `main` rather than this folder. The Plan Review gas switches and Tank Bank switch depth work shares only `tests/ui/visual.spec.ts`, `documentation/architecture.md`, `documentation/flows.md`, `documentation/tests.md`, and `CHANGELOG.md` with this brief.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy. Cave output stays experimental and pending qualified cave-diver review.

## Current behavior

References are to `main` at `d509a7b`.

- **Ceiling failure.** When an explicit route leg rises above the calculated ceiling, `calculateEventDivePlan` (`src/engine/planner.ts`) fails the plan with `EXPOSURE_CEILING_VIOLATION`. It flags strictly ascending events only. The diagnostic carries:
  - `runtimeSeconds`;
  - `depthM` and `actual`, the leg's end depth;
  - `limit`, the ceiling;
  - `field: "events.<n>.endDepthM"`, an index into the cave layer's internal event list.

  Cave Setup appends the field, so the diver reads "An explicit ascent or exit leg crosses above the calculated decompression ceiling. (events.5.endDepthM)". Example: set the Cave plan's maximum depth to 21 m (69 ft) and enter three legs, carrying every cylinder:
  - entrance, 0 to 9 m, 60 m, 3 min, fins;
  - scooter, 9 to 18 m, 700 m, 12 min, scooter;
  - tunnel, 18 to 21 m, 250 m, 10 min, fins.

  The calculation fails at 50:00: the exit of the entrance leg ends at 0 ft under a 1.40 m ceiling (5 ft rounded deeper), and it is the only leg that ends at 0 ft. A failed calculation never replaces the session's `calculated` result, so the route that failed is the current Cave input (in Needs attention its signature equals `attemptedInputSignature`).
- **Gas-derived limits.** Cave Review's "Maximum penetration distance" and "Maximum turn time" show the smaller of the diver's entered limit and the gas-derived limit (`calculateCavePlanInternal` in `src/cave/index.ts`).
  - The gas-derived value scales every leg's duration and distance by one factor until a recalculated candidate has a cylinder that no longer keeps its reserve, or an error diagnostic (`gasLimits`; "proportionally scaled copies of the entered route" in `documentation/calculation-model.md`).
  - Candidates are calculated without failure scenarios (`scenarios: []`), so the maximum says nothing about whether the scenarios pass at that distance.
  - Neither the tiles nor the Setup fields ("0 = gas-derived") say any of this.
  - With the example's entrance leg starting at 6 m instead of 0, the calculation succeeds and the maximum reads "7513 ft", reached by stretching the entrance and scooter legs as well as the last one.
- **Cylinder access.** Access and stages are set per leg: a checkbox per cylinder and a Stage action select in `RouteEditor` (`src/app/CavePage.tsx`). Nothing shows the whole route at once. A leg the diver never edited carries every plan cylinder, so by default the deco cylinders ride to maximum penetration.

## Requirements

### Ceiling failure

1. When the Cave calculation fails with `EXPOSURE_CEILING_VIOLATION`, Setup's calculation diagnostics show the leg, its end depth, the runtime, and the ceiling instead of today's text and the `(events.<n>.endDepthM)` suffix. For example: "The exit of leg “entrance” ends at 0 ft at 50:00, above the 5 ft decompression ceiling there." Print these with the helpers in `src/app/helpers.ts`:
   - the ceiling rounded deeper, with `formatDepthBound(limit, units, "lower")`;
   - the end depth with `formatDepth`;
   - the runtime with `formatDuration`.
2. Find the leg from the current Cave input, the one whose calculation failed, in a pure, unit-tested helper (for example in `src/app/caveDiagnostics.ts`). An ascending penetration leg ends at its `endDepthM`; the exit of a leg whose depth increases ends at the leg's `startDepthM`. Name the leg only when exactly one of those ends at the diagnostic's `depthM`, and that depth is not one where the cave layer splits legs:
   - the bottom-gas switch depth, when an OC plan uses a travel gas (`ocBottomSwitchDepth(dive)` from `src/domain/validation.ts`);
   - a CCR plan's switch-up depth, `dive.setpointActivationDepthM`;
   - a CCR plan's switch-down depth, `switchDownDepth(dive)` from `src/domain/validation.ts`.

   Otherwise write "An explicit route leg ends at …" with the same numbers.
3. Change no other diagnostic, and do not change the diagnostic object itself. A failure scenario can end with the same code inside a calculated result, where `collectCaveDiagnostics` prefixes the scenario's name and its route stops at the trigger; leave those messages as they are.

### Gas-derived limits

4. Under "Maximum penetration distance" and "Maximum turn time" in Cave Review, say which limit applies. Show "Entered limit" when a value the diver entered equals the shown value (within 1e-6). Otherwise show "Gas-derived: every leg scaled together; failure scenarios not rechecked". Compare these values from the current Cave input:
   - distance: `maximumPenetrationDistanceM`;
   - time: `turnTimeSeconds` and `maximumPenetrationTimeSeconds`.
5. The Setup hints for the gas-derived maximum distance and time say, in one line, how the value is found: "Gas-derived: the whole route is scaled until a cylinder no longer keeps its reserve or the recalculated plan has an error. Failure scenarios are not rechecked at that limit."

### Cylinder access table

6. Add a read-only "Cylinder access by leg" table to the Penetration route panel in Setup, above the legs. Rows are plan cylinders (name and gas). Columns are legs in route order (label, distance, and depth range, in the display preferences).
7. Each cell says one of: carried, not carried, dropped at the end of this leg, recovered on this leg, shared (locked), or not set. Use text with an optional symbol; a symbol never carries meaning alone. Derive every state from `routeCylinders`, `routeCylinderAccess`, `routeStageCylinder`, and `unsetRouteCylinders` in `src/app/caveRoute.ts`, and add no new access rule.
8. One line under the table: "The exit runs the legs in reverse; a stage dropped on a leg is picked up when the exit reaches it." (`reverseLeg` in `src/cave/index.ts` swaps drop and recover and keeps the leg's access.)
9. The per-leg checkboxes stay the controls; the table has no inputs. Give it a caption, column headers, and row headers, and let it scroll sideways on a phone like the other tables (`bf-scroll-table`).
10. Style with the existing table styles and tokens. Add no colors and no motion.

## Out of scope

- Any change under `src/cave`, `src/engine`, `src/gas`, `src/domain`, `src/calculations`, or `src/storage`. That includes leg ids on engine diagnostics, per-cylinder turn pressures, rechecking failure scenarios at the gas-derived limit, and a limit that extends only the last leg.
- A route view on a distance axis and a table of all scenarios at once.
- `src/app/caveRoute.ts` (read it; add no rule), `src/app/PlanPage.tsx`, `src/app/PlanResultView.tsx`, and `src/app/planning.ts`.

## Owned paths

- `src/app/CavePage.tsx` (Cave diagnostic rendering, the two Review tiles, the two Setup hints, and the table's placement)
- `src/app/caveDiagnostics.ts` and a test file for the ceiling helper
- a new component for the table, for example `src/app/CaveAccessTable.tsx`, with a test for its cell states
- `src/styles/layout.css` (the Cave route rules)
- a new `tests/ui/cave-route-clarity.spec.ts`
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `documentation/architecture.md` (one sentence for the new component and helper), `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest, ceiling helper:
  - It names the entrance exit for the route in Current behavior.
  - It names no leg when two legs end at the violation depth, when the depth falls between leg ends, or when it equals a split depth (a travel-gas plan's bottom-gas switch depth, or a CCR switch-up or switch-down depth).
  - It prints the ceiling rounded deeper, in feet and in metres.
  - One end-to-end case runs `calculateCavePlan` on that route and passes its diagnostic to the helper, so a change in the cave layer shows up here.
- Vitest, the entered-or-gas-derived choice, if you extract it.
- Vitest, table states: an unedited leg (all carried), an unticked cylinder, a stage drop, a stage recovery, a cylinder shared by two gases, and a gas added after the leg was edited (not set).
- Playwright, in the new spec file:
  - The route in Current behavior shows the named message and no "events." text.
  - The limit tiles read "Gas-derived: every leg scaled together; failure scenarios not rechecked" by default, and "Entered limit" after entering a maximum distance below the gas-derived one.
  - The table lists every cylinder and leg, and follows unticking a cylinder and adding a stage drop.
  - The table is exposed as a table with its headers.
- Visual: the Cave Setup (`cave-*.png`) and calculated Cave (`cave-results-*.png`) baselines change on phone, tablet, and desktop, and the route-leg element baselines may shift. Follow the baseline rules in `AGENTS.md`, and inspect all three images before committing.

## Documentation and changelog

- `documentation/flows.md`, Cave flow: the access table, the named ceiling failure, and how the maximum distance and time are labeled.
- `documentation/architecture.md`: the new component and helper.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Cave Setup shows which cylinders you carry on each leg, a route that rises above its decompression ceiling names the leg, its end depth, and the ceiling, and the maximum penetration distance and time say whether they come from your entry or from scaling every leg." Do not bump the version.

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
