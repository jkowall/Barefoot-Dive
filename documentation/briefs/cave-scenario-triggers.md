# Brief: Cave failure scenarios that apply to the route, each with its own trigger

- **Source:** cave audit of 0.5.2 (2026-09-27). A new Cave plan reports "Unsafe or unavailable" because two of its four failure scenarios cannot run on the default route, every scenario shares one trigger point, and neither Setup nor Review says what a scenario models.
- **Status:** ready to implement. No engine, calculation, cave-layer, storage, or schema change: `calculateCavePlan` already accepts a separate target for each scenario request.
- **Suggested branch:** `cursor/cave-scenario-triggers`, from the latest `main`.
- **Order:** land this before `cave-route-clarity.md`. Both edit `src/app/CavePage.tsx` and `src/styles/layout.css` and change the `cave-*.png` and `cave-results-*.png` baselines. The Plan Review gas switches and Tank Bank switch depth work (briefs `review-gas-switches.md` and `tank-bank-switch-depth.md`, whose pull requests delete them) shares only `tests/ui/visual.spec.ts`, `documentation/architecture.md`, `documentation/flows.md`, `documentation/tests.md`, and `CHANGELOG.md` with this brief, so rebase on whichever lands first.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, and the git policy. Cave output stays experimental and pending qualified cave-diver review.

## Current behavior

References are to `main` at `d509a7b`.

- Every new Cave session enables all four open-circuit scenarios (`caveScenarioKinds` and `createInitialCaveWorkspaceSession` in `src/app/caveWorkspace.ts`): lost back gas, lost buddy, scooter failure, and stage failure. A CCR Cave plan has one, CCR loop failure.
- `CavePage` (`src/app/CavePage.tsx`) builds every request from one `targetLegId` and one optional `limits.scenarioTargetDistanceM`: the "Scenario trigger leg" and "Scenario trigger distance" fields under Turn limits and failure scenarios. A new leg becomes the trigger leg when it is added.
- `scenarioEvents` in `src/cave/index.ts` rejects scooter failure unless its target leg is scooter-propelled (`SCENARIO_TARGET_INVALID`) and stage failure unless its target leg drops or recovers a stage (`STAGE_FAILURE_TARGET_REQUIRED`). The default route is one fin leg with no stage, so both scenarios fail with those errors, `collectCaveDiagnostics` (`src/app/caveDiagnostics.ts`) adds them to the aggregate list, and a first calculation reads "Unsafe or unavailable" and "Cave calculation contains safety errors".
- A scenario turns at its trigger. `targetRoute` cuts the route there, so the legs beyond the trigger are not part of the scenario. The only time spent at the trigger is a gas switch, if the exit starts on another gas, and CCR loop failure's 1 s bailout event. A gas switch takes the convention's switch time: none in the Barefoot and MultiDeco presets, 5 s in the Shearwater preset (`src/engine/conventions.ts`), which Cave offers through the shared `PlannerEditor`.
- When a trigger distance is set, `targetRoute` picks the leg that contains that distance from the entrance and uses the named leg only to check that it exists. The scenario result still carries the named leg's id, so a distance outside the named leg calculates a different leg under the named leg's name.
- The shared trigger breaks realistic routes. Set the Cave plan's maximum depth to 21 m (69 ft) and enter three legs:
  - entrance, 6 to 9 m, 60 m, 3 min, fins, dropping the oxygen cylinder;
  - scooter, 9 to 18 m, 700 m, 12 min, scooter, dropping the EAN50 cylinder;
  - tunnel, 18 to 21 m, 250 m, 10 min, fins.

  Untick oxygen on the scooter and tunnel legs and EAN50 on the tunnel leg, or the cave layer rejects the route (`STAGE_ACCESS_AFTER_DROP`). Triggering every scenario at the end of the tunnel makes scooter and stage failure invalid again. Requesting both at the end of the scooter leg calculates them, as dives that turn there and leave the tunnel out.

What each scenario models, read from `scenarioEvents`:

| Scenario | What it models |
| --- | --- |
| Lost back gas (OC) | Turns at the trigger and exits without the bottom-gas cylinder, on other cylinders accessible on each exit leg. No teammate gas. Legs beyond the trigger are not included. |
| Lost buddy (OC) | Turns at the trigger; every exit leg takes twice as long. Legs beyond the trigger are not included. |
| Scooter failure (OC) | Turns at the trigger; exit legs ridden on a scooter take twice as long, a fixed factor rather than a swim-speed estimate. Fin and tow legs are unchanged. Legs beyond the trigger are not included. The trigger must be on a scooter leg. |
| Stage failure (OC) | Turns at the trigger and exits without the stage cylinder dropped or recovered on the trigger leg. Legs beyond the trigger are not included. The trigger must be on a leg with a stage. |
| CCR loop failure | Bails out to open circuit at the trigger, a 1 s event, and exits on the bailout gases accessible on each exit leg. Legs beyond the trigger are not included. |

Every exit follows the legs in reverse to the entrance, then ascends. No scenario models a failure found on the way out, after the legs beyond the trigger.

## Requirements

1. **Applicable scenarios.** Offer scooter failure only while at least one leg is scooter-propelled, and stage failure only while at least one leg drops or recovers a stage whose cylinder is in the plan (`routeStageCylinder` in `src/app/caveRoute.ts` returns it). Otherwise show that checkbox disabled with its reason, for example "Needs a scooter leg" or "Needs a leg that drops or recovers a stage". Lost back gas, lost buddy, and CCR loop failure are always applicable; a CCR plan without a bailout gas must keep failing loop failure (`BAILOUT_GAS_REQUIRED`), never become "not applicable".
2. **Keep the diver's choice.** Leave `enabledScenarios` as the diver set it, so a scenario comes back when the route qualifies again, and request only scenarios that are both enabled and applicable. A request the UI does not send never reaches the aggregate status.
3. **Never drop one silently.** When an enabled scenario is not applicable, Review's Failure scenarios panel says so in one line, for example "Scooter failure is not calculated: the route has no scooter leg". Not applicable is neither sufficient nor unsafe.
4. **A trigger per scenario.** Replace the shared trigger leg and distance with a trigger point per scenario: a leg (the end of that leg) and an optional distance from the entrance. The distance must fall inside the chosen leg: at or before its end, and far enough past its start that the partial leg still lasts at least 1 s once rounded to whole seconds (`seconds()` rounds, and `targetRoute` rejects a zero-duration point with `SCENARIO_TARGET_INVALID`). The scooter failure list offers only scooter legs, and the stage failure list only legs with a stage. If a single "Trigger point" select with a custom-distance option reads better, use it; decide from the phone, tablet, and desktop screenshots and say which you chose in the pull request.
5. **Keep triggers valid.** Re-check every trigger whenever legs are edited, renamed, resized, added, or removed. A trigger the diver chose follows a leg rename (as `targetLegId` does in `updateRoute`). When its leg is removed or stops qualifying, it returns to the default. When a distance no longer falls inside its leg, it returns to the end of that leg. Say so beside the control until the diver changes it.
6. **Defaults, pending qualified cave-diver review.** Lost back gas, lost buddy, and CCR loop failure trigger at the end of the last leg, as today. Scooter failure triggers at the end of the farthest scooter leg, and stage failure at the farthest leg that drops or recovers a stage. Because a scenario turns at its trigger, these two defaults leave out the legs beyond that leg, and their lines say so.
7. **Say what each scenario models.** Show the table's full line under each scenario in Setup and, in Review, under the selected scenario's status. Include "Legs beyond the trigger are not included" wherever a line appears, together with the scenario's trigger point: leg, distance from the entrance, and depth, in the display preferences. Compute a trigger depth exactly as `targetRoute` interpolates it: the leg's start depth plus the distance's fraction of the leg's depth change. Keep the lines, labels, applicability rules, and defaults in one pure module, and add the table and the paragraph under it to the Cave section of `documentation/calculation-model.md`.
8. **Pin every line to behavior.** Add characterization tests that run `calculateCavePlan` and assert what each line claims. Use the default convention preset (`barefoot-zhl16c-v1`), whose gas switches take no time, and routes without a travel gas: a travel gas splits legs at its switch depth, and each part rounds to whole seconds separately.
   - Each scenario's plan goes no farther than its trigger and spends no time there, apart from loop failure's 1 s bailout at the trigger depth.
   - Lost buddy's exit legs last exactly twice their penetration legs.
   - Scooter failure doubles only scooter legs.
   - Lost back gas breathes no gas from the bottom-gas cylinder after the trigger.
   - Stage failure breathes no gas from the failed stage after the trigger.
   - A trigger depth computed by the module matches the depth where the scenario turns.

   If a test fails, the line is wrong: stop and report it rather than changing `src/cave`.
9. **Session only.** The per-scenario triggers live in the Cave session in `src/app/caveWorkspace.ts`, which is not persisted. Saved cave snapshots already store one request per scenario (`CavePlanInput.scenarios`), so the snapshot format, library recalculation, and reopening are unchanged.
10. **Context strip.** The scenario count in the Cave summary line counts the scenarios requested.
11. Style with the existing controls and tokens. Add no colors and no motion, and never animate a number.

## Out of scope

- Any change under `src/cave`, `src/engine`, `src/gas`, `src/domain`, `src/calculations`, or `src/storage`, including the twice-as-long factors, teammate gas, and how exit legs choose a gas.
- A failure found on the way out, after the legs beyond the trigger. The model has no such scenario; it is for the qualified cave-diver review.
- One stage-failure scenario per stage, a table of all scenarios at once, and a route view on a distance axis.
- `src/app/PlanPage.tsx`, `src/app/PlanResultView.tsx`, and `src/app/planning.ts`, which the Plan Review gas switches and Tank Bank switch depth work owns.

## Owned paths

- `src/app/CavePage.tsx` (the scenario controls, request building, the Failure scenarios panel, and the summary count)
- `src/app/caveWorkspace.ts` (session fields and defaults)
- a new pure module, for example `src/app/caveScenarios.ts`, with `src/app/caveScenarios.test.ts`
- `src/styles/layout.css` (the Cave route and scenario rules)
- a new `tests/ui/cave-scenarios.spec.ts`, and the `tests/ui/smoke.spec.ts` cases listed below
- `tests/ui/visual.spec.ts` and the snapshots it changes
- `documentation/architecture.md` (one sentence for the new module), `documentation/flows.md`, `documentation/calculation-model.md` (Cave section), `documentation/tests.md`, `CHANGELOG.md`

## Tests

- Vitest, for the new module:
  - Applicability: no scooter leg, a scooter leg, a stage drop, a stage recovery, and a stage whose gas has been switched off.
  - Defaults: the last leg, the farthest scooter leg, the farthest stage leg.
  - A rename, a removal, and a resize of the trigger leg.
  - A distance outside the chosen leg, and a leg edit that pushes a distance outside it.
  - CCR loop failure is always applicable.
  - The requests built from a session.
- Vitest, the characterization tests in requirement 8.
- Playwright, in the new spec file (the `smoke-desktop` project runs every spec except `visual.spec.ts`):
  - The default Cave plan calculates with "Cave calculation complete", without "Unsafe or unavailable", and shows scooter and stage failure disabled with their reasons.
  - Adding a scooter leg enables scooter failure, with its trigger on that leg.
  - On the three-leg route in Current behavior, all four scenarios are evaluated at their own triggers. Lost back gas is unsafe at the end of the tunnel (`BAILOUT_ACCESS_INVALID`: once both stages are dropped, the tunnel carries only back gas), so the aggregate reads "Cave calculation contains safety errors". Lost buddy, scooter failure, and stage failure are sufficient. Review shows each scenario's full line and trigger point.
  - A trigger distance outside its leg, or so close to the leg's start that the partial leg rounds to 0 s (1 ft past the start of the scooter leg), is refused, and a leg edit that moves a distance outside it returns the trigger to the end of the leg with a note.
  - The trigger controls work from the keyboard.
- Update the smoke cases that depend on today's invalid default:
  - "calculates CCR, cave, and the Tools library without a remote dependency" expects "Cave calculation contains safety errors" for the default Cave plan; it now completes.
  - "marks a saved cave snapshot unsafe when a nested failure scenario is invalid" relies on the invalid scooter failure. Rebuild it on a genuinely unsafe scenario: untick every cylinder except the bottom-gas cylinder on the leg, so lost back gas has no gas for the exit (`BAILOUT_ACCESS_INVALID`), and keep its saved-snapshot assertions.
- Visual: the Cave Setup (`cave-*.png`) and calculated Cave (`cave-results-*.png`) baselines change on phone, tablet, and desktop. Follow the baseline rules in `AGENTS.md`, and inspect all three images before committing.

## Documentation and changelog

- `documentation/flows.md`, Cave flow: applicability, a trigger per scenario, and the model lines.
- `documentation/calculation-model.md`, Cave section: the table and the paragraph under it.
- `documentation/architecture.md`: the new module.
- `documentation/tests.md`: the new coverage.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "Cave offers scooter failure only when the route has a scooter leg, and stage failure only when a leg drops or recovers a stage, so a new Cave plan is no longer marked unsafe for scenarios it cannot run. Each scenario has its own trigger point, and Setup and Review say what each one models, including that it turns at its trigger." Do not bump the version.

## Verification

```bash
npm run check
npm run verify:cave
npm run test:ui
npm run test:visual
git diff --check
```

Which scenarios are calculated, and where, is safety-relevant cave behavior. Before merge, get an independent read-only review of the applicability rules, trigger handling, defaults, and model lines against `src/cave/index.ts`.

## Git and pull request

- Sign every commit (`git commit -S`), open one pull request against `main`, and delete this brief in that pull request.
- Merging stays with Jonah; do not merge the pull request yourself.
