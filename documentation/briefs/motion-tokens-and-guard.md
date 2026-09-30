# Brief: Motion tokens, complete reduced-motion coverage, and a guard against animated values

- **Source:** views and motion plan (audit of 0.5.2 on 2026-09-26, rechecked against 0.8.0 on 2026-09-30; decisions confirmed by Jonah on 2026-09-30). Proposals B3 and B6.
- **Status:** ready to implement once its order allows. Nothing outside `src/styles` and tests changes. The only visible change is for people who ask for reduced motion: four controls that still transition for them stop doing so.
- **Suggested branch:** `cursor/motion-tokens-and-guard`, from the latest `main`.
- **Order:** last. Start after every other brief in this set has landed (`color-semantics.md`, `profile-chart-legibility.md`, `gas-budget-bars.md`, `saved-plan-cards.md`, `runtime-leave-column.md`, `tools-pressure-bar.md`, `ccr-bailout-comparison.md`), because this one touches every stylesheet and checks the motion they add.

Read `AGENTS.md` first. It is binding, including the motion rules (motion clarifies state, never animates or counts through a safety-critical number, and honors `prefers-reduced-motion`), the token rule, and the git policy.

## Current behavior

References are to `main` at `ee16534` (0.8.0).

- **Tokens.** `src/styles/tokens.css` defines two durations, `--bf-motion-fast` (120ms) and `--bf-motion` (200ms). Literals remain elsewhere:
  - The completion cue in `src/styles/results.css` hard-codes 220ms and 120ms edge durations, delays of 40, 260, 380, and 600ms, a 360ms copy delay, and `cubic-bezier(.2, .8, .2, 1)`.
  - The updating-dot pulse in `src/styles/controls.css` hard-codes 800ms.
- **Reduced motion.** The block in `src/styles/motion.css` lists selectors one by one.
  - It misses four that transition: `.bf-profile__event-list button` (`src/styles/profile.css`); `.bf-cave-timeline__segment > button` and `.bf-cave-timeline__event-list button` (both `src/styles/layout.css`, added in 0.7.0); and the save dialog's name field, `.bf-dialog__input input` (`src/styles/controls.css`), which sits outside the listed `.bf-field-group__control` inputs.
  - It names `.bf-panel` and `.bf-cylinder`, which no longer transition.
- **Tests.** Nothing tests that values never animate. The smoke suite covers the completion border, and reduced motion only for the completion cue and for scrolling a newly added editor into view.

## Requirements

1. **Tokens for every duration and easing.** Add `--bf-motion-draw` (220ms), `--bf-motion-pulse` (800ms), `--bf-ease-draw` (`cubic-bezier(.2, .8, .2, 1)`), `--bf-completion-delay` (40ms), and `--bf-completion-copy-delay` (360ms).
   - Define the other edge delays as tokens too, with `calc()` inside `tokens.css` from these and `--bf-motion-fast`: `--bf-completion-delay-right` (delay + draw = 260ms), `--bf-completion-delay-bottom` (right + fast = 380ms), and `--bf-completion-delay-left` (bottom + draw = 600ms). `results.css` then uses bare `var()` values.
   - Replace every time literal and easing curve outside `tokens.css` with a token.
   - Every timing stays exactly as it is today.
2. **Reduced motion that cannot miss an element.** Inside `@media (prefers-reduced-motion: reduce)`, replace the selector list with one rule for every element and pseudo-element: `transition: none !important; animation: none !important;`. It holds no time literal, and `!important` is needed because a universal selector otherwise loses to the class rules that declare transitions. Keep the rules that show the completion cue finished (edges at full scale, copy fully opaque), so the border and its copy still appear at once. Smooth scrolling is handled in script with `matchMedia` and stays as is.
3. **A guard in Vitest.** Add a test that reads `src/styles/*.css`. It fails when a time literal (a number followed by `ms` or `s` and a word boundary, so `calc(100svh - 2rem)` in `src/styles/controls.css` does not match) or `cubic-bezier(` appears outside `tokens.css`, or when a `transition` or `animation` declaration uses a duration or delay that is not a `var(--bf-…)` motion token. Read the stylesheets with Vite `?raw` imports (for example `import.meta.glob("./*.css", { query: "?raw", import: "default", eager: true })`), as `src/platform/runtimeFloor.test.ts` does. Do not import `node:fs`: the app type check (`tsconfig.json`) leaves Node types out on purpose.
4. **A guard in Playwright.** Add a new spec with two cases.
   - With default motion: after calculating the default draft, `document.getAnimations()` targets only the completion cue (`.bf-completion-notice__edge`, `.bf-completion-notice__copy`) and status dots. After scrubbing the profile, switching a Cave scenario, and opening Saved Plans, no animation or running transition targets an element inside the profile, a metric tile, a table, a gas budget bar, or a thumbnail.
   - With `reducedMotion: "reduce"`: after the same steps, `document.getAnimations()` is empty. The computed `transition-duration` is `0s` on a button, a navigation item, a profile event button, a Cave timeline segment, and the save dialog's name field.
5. **No other visible change.** On macOS, `npm run test:visual` must pass with no baseline change. If a baseline changes, stop and report it rather than updating it. A Linux agent cannot compare the maintained `-darwin` baselines, so it says in its pull request that the macOS run is still to do.

## Out of scope

- New motion of any kind, and any change to what animates today.
- Any change under `src/app`, `src/ui`, or the scientific modules.

## Owned paths

- `src/styles/tokens.css` (the motion block), `src/styles/motion.css`, `src/styles/results.css` (the completion timing), `src/styles/controls.css` (the pulse timing), and any stylesheet that still holds a time literal once the other briefs have landed
- a new `src/styles/motion.test.ts`
- a new `tests/ui/motion-guard.spec.ts`
- `design.md` (the motion rules), `documentation/tests.md`, `CHANGELOG.md`

## Tests

The two guards above. Run the existing completion-motion and reduced-motion smoke cases unchanged.

## Documentation and changelog

- `design.md`: every duration and easing comes from `tokens.css`; the completion cue and status dots are the only animations; values never animate; reduced motion turns off all transitions and animations.
- `documentation/tests.md`: the two guards.
- `CHANGELOG.md`, one user-facing line under `## Unreleased`, for example: "With reduced motion turned on, the profile's event list, the Cave route timeline, and the save dialog's name field no longer animate." Do not bump the version.

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
