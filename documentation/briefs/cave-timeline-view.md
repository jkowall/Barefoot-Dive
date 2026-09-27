# Brief: Cave timeline view — route, triggers, and access on one axis

- **Source:** product direction after 0.6.0 and the Cave clarity PRs (scenario triggers, route clarity). The diver wants an overall **timeline view** for Cave, not only denser forms. Form clarity (per-scenario triggers, access table, named ceiling failure, entered-vs-gas-derived limits) is separate and lands in those PRs first.
- **Status:** ready to design/implement after the stacked Cave clarity work is on `main`. No engine, calculation, cave-layer, storage, or schema change in the first cut unless a later revision explicitly adds one.
- **Suggested branch:** `cursor/cave-timeline-view`, from the latest `main` after [#25](https://github.com/jkowall/Barefoot-Dive/pull/25) (scenario triggers) and [#26](https://github.com/jkowall/Barefoot-Dive/pull/26) (route clarity) merge. Both edit `CavePage.tsx`, `layout.css`, and Cave visual baselines; rebase onto whichever lands last.
- **Order:** land after both Cave clarity PRs. Do not stack a large visual surface on an unmerged clarity branch unless those PRs are abandoned.

Read `AGENTS.md` first. It is binding, including the verification matrix, the visual baseline rules, the instrument-dark design system, and the git policy. Cave output stays experimental and pending qualified cave-diver review.

## Intent

Give Cave one readable **timeline composition** that answers, without scrolling through every leg editor:

1. How far (and optionally how long) the route runs.
2. Where each leg sits on that axis (depths, propulsion, stage drop/recover).
3. Where each enabled failure scenario turns (its trigger).
4. Which cylinders are carried / dropped / recovered along the route (aligned with the existing access table semantics).

This is a **route timeline**, not continuous GF / PPO₂ / tissue / cylinder-pressure scrubber traces. Those remain the separate roadmap Later item on the emitted profile scrubber and need their own brief, production contracts, and scientific review.

## Current behavior

After the clarity PRs:

- Setup lists legs as stacked editors and a read-only cylinder-access table.
- Failure scenarios have per-scenario trigger controls and model lines.
- Review shows aggregate metrics, a scenario selector, and the usual Plan profile graphs for base and selected scenario plans.
- There is still no single distance- or time-axis view of the penetration route itself. The existing profile scrubber shows the calculated depth-vs-runtime plan, which is a different object (events/stops), not the cave route geometry.

Out of scope in the earlier route-clarity brief (preserve that split): “A route view on a distance axis and a table of all scenarios at once.” This brief is that route view.

## Requirements

### First cut (must ship together)

1. **One timeline panel** in Cave Setup (and mirror a read-only copy in Review when a calculation is current). Place it where it clarifies the route — above or beside the leg editors, not as a decorative hero.
2. **Axis:** primary axis is **distance from the entrance** (metres canonical; display follows depth/distance preference as other Cave distance fields do). Optionally show a secondary time scale derived from each leg’s duration; if both are shown, distance remains the layout axis so unequal swim/scooter speeds do not distort geometry.
3. **Legs as segments** on the axis: label, depth range (start→end), propulsion, and stage action when not `none`. Segments must be keyboard-focusable and map 1:1 to the existing leg editors (focus/scroll the matching editor on activate).
4. **Scenario triggers as markers** on the same axis for every **enabled and applicable** scenario (same applicability rules as the scenario-triggers module). Marker label uses the existing scenario display name. Selecting a marker focuses that scenario’s trigger controls in Setup, or selects that scenario in Review.
5. **Cylinder events on the axis** (drop / recover only), derived only from `routeCylinders`, `routeStageCylinder`, and existing access helpers — no new access rules. Carried vs not-carried for every cylinder on every leg stays in the table; the timeline does not replace the table.
6. **Style** with tokens only (`src/styles/tokens.css`). Flat instrument-dark: no gradients, glows, shadows, or decorative dive imagery. Motion only for focus/selection clarification; honor `prefers-reduced-motion`. Do not animate safety-critical numbers.
7. **Accessibility:** timeline is a navigable structure (list or graphics with text equivalents). Every marker and segment has an accessible name. Pointer is not required.

### Explicit non-goals (this brief)

- Continuous GF, PPO₂, tissue, CNS, or cylinder-pressure traces on the Plan/Cave profile scrubber.
- Editing the route by dragging on the timeline (read-only first cut; editors remain authoritative).
- Changing `src/cave`, `src/engine`, `src/gas`, `src/domain`, `src/calculations`, or `src/storage`.
- Replacing Setup leg editors, the access table, or Review profile graphs.
- Claiming procedure or decompression safety from the timeline.

## Owned paths (expected)

- New pure layout/model helper(s), for example `src/app/caveTimeline.ts` (+ tests), building view-model segments/markers from `RouteDraft[]`, scenario triggers, and route cylinder helpers
- New presentational component, for example `src/app/CaveTimeline.tsx` (+ focused tests)
- `src/app/CavePage.tsx` (placement in Setup and Review only)
- `src/styles/layout.css` and/or a small dedicated style file imported from the existing CSS entry pattern
- `tests/ui/cave-timeline.spec.ts`
- `tests/ui/visual.spec.ts` and the Cave baselines it changes
- `documentation/architecture.md`, `documentation/flows.md`, `documentation/tests.md`, `CHANGELOG.md` (Unreleased; do not bump version)

## Tests

- Vitest: segment geometry (cumulative distance, depth labels), trigger marker positions match the scenario-trigger module’s distance/depth interpolation, stage drop/recover markers only when `routeStageCylinder` resolves, no markers for inapplicable scenarios.
- Playwright: timeline visible in Setup; markers appear when a scooter leg enables scooter failure; activating a leg segment moves focus to that editor; Review shows the same route geometry for a current calculation.
- Visual: phone/tablet/desktop Cave Setup and calculated Cave baselines. Follow `AGENTS.md` baseline rules (`mouse.move(0,0)` before capture; inspect all three; restore unchanged PNGs).

## Documentation and changelog

- Flows: where the timeline sits and that editors remain the source of edits.
- Architecture: one sentence for the model helper and component.
- Tests: coverage note.
- CHANGELOG Unreleased, user-facing, for example: “Cave Setup and Review show the penetration route on a distance timeline with leg segments, failure-scenario trigger markers, and stage drop/recover marks, alongside the existing cylinder-access table.”

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

## Follow-on (separate briefs later)

1. Drag-to-adjust trigger distance on the timeline (still session-only; must keep ≥1 s partial-leg rule).
2. Continuous exposure traces on the calculated profile scrubber (roadmap Later; scientific contracts required).
3. A compact “all scenarios” strip that reuses timeline markers without duplicating Review’s scenario plans.
