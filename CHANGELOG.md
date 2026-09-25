# Changelog

## Unreleased

- Tank Bank no longer becomes unreadable because of one malformed stored cylinder. Valid cylinders load in Tank Bank, Plan, Cave, and Tools; each invalid record is quarantined and listed in a Tank Bank notice with its stored position, name or id, and failing fields. Quarantined records keep their exact stored text through later edits and are never offered for planning. Records must now match every declared field type, including the gas mix, so a record with, for example, a text O₂ fraction is quarantined instead of loaded; every record the app writes already meets this, and Tank Bank now refuses to save one that does not.
- A Tank Bank that cannot be read at all (unsupported schema version, corrupt data, or an old unversioned list with an invalid record) now says so instead of showing an empty bank, disables adding and saving cylinders, and leaves the stored data untouched. A search or filter with no match now says so instead of reporting an empty Tank Bank. Saved Plans reads are unchanged, and the storage schema version stays 1.

## [0.5.0] - 2026-09-24

Calculation engine `barefoot-dive-engine-0.3.0`. It includes the arrival-ceiling re-check first built as engine 0.2.1, which was never released.

- Open-circuit gas use now charges the bottom RMV until the first stop in new plans. Since engine 0.1.0 the ledger charged the climb from the bottom to the first stop, and a whole no-stop ascent, at the deco RMV. That understates bottom-gas use: at 20 and 15 L/min a 45 m Tx18/45 dive was short 52 L (2.2 bar on a 24 L twinset, 1.6% of its bottom gas) and an 80 m dive 141 L (3.3%). A short no-stop dive, where the whole ascent moves, was short about 5%. The engine takes the rule as an opt-in field (`decoRmvFrom: "first-stop"`); plans without it, including every saved plan, keep the engine 0.1.0 rule. A gas switch made on arrival at the first stop counts as part of the stop. Decompression and cylinder reserves are unchanged. With the bottom RMV at or above the deco RMV, the usual setting, a reserve crossing can only move earlier, and gas-only thirds and sixths reserves and every gas-only minimum to carry rise with the added use; a higher deco RMV reverses those directions. CCR bailout keeps charging only stops at the bailout deco RMV, and cave plans keep the original rule until cave turn limits are reviewed with the new one.
- Plan Setup has a "Bottom RMV until first stop" switch for open-water OC plans, on by default; turning it off restores the original rule. A plan on the new rule says so in its diagnostics (`DECO_RMV_FROM_FIRST_STOP`), and an open-water OC plan on the original rule shows a note under its gas ledger. The default draft (40 m for 25 minutes on Tx18/45) now uses 43 L more bottom gas. Recalculating a saved plan keeps the rule it was saved with; enter it again in Setup to use the new one.
- Every ascent leg now re-checks its arrival ceiling. Before, only low-setpoint legs did, so a leg could arrive above the GF-low ceiling when the fast compartments took up helium faster than they released nitrogen. This happens after a switch from a nitrogen-loaded loop or gas to a helium-bearing one, most often on a CCR bailout. The first stop now moves one grid step deeper until the arrival clears, and a stop is held until the next leg's arrival clears. For example, a 60 m legacy CCR bailout onto Tx12/60 now stops first at 33 m instead of 27 m under a 29.1 m ceiling.
- Affected schedules change in both directions. First stops only move deeper, but the gradient-factor line is anchored at the first stop, so the shallower stops use higher gradient factors, and many changed plans surface sooner. Exploratory comparisons against engine 0.2.0 saw changes from 55 minutes shorter to 217 minutes longer. An open-circuit dive on air at 40 m with Tx30/30 deco now stops first at 27 m instead of 24 m and surfaces about 6 minutes sooner. Mostly bailout plans changed, along with open-circuit plans that switch from a nitrogen gas to a helium-bearing one, and event and cave ascents with the same pattern. The seven legacy fixture digests are unchanged. Saved plans from engine 0.2.0 show the older-engine notice, and recalculating creates a new revision.
- Known limitation: the scheduler does not look ahead through a stop. After a bailout from a nitrogen-rich loop to a lean, helium-heavy gas, the ceiling can deepen past a held stop by several metres for several minutes, and no diagnostic is shown.

## [0.4.0] - 2026-09-23

Calculation engine `barefoot-dive-engine-0.2.0`.

- CCR low and high setpoints: the loop is closed at the low setpoint from the surface, switches up at the switch-up depth, and switches down when leaving a separate switch-down depth on ascent. The high setpoint is held for any stop at the switch-down depth, and a switch-down depth between stops or shallower than the last stop is applied mid-leg without adding a stop. The high setpoint is never held shallower than the loop can reach it (3.6 m for 1.3 bar at sea level): a shallower switch-down depth, including 0, is moved to that depth with a warning, so no stop or no-stop limit takes credit for a setpoint the loop cannot hold. A leg that switches down is re-checked on arrival, and the stop is moved deeper or held on the high setpoint if the low setpoint would cross the ceiling. Imperial entries within half a foot of the 3 m grid snap to it, so 20 ft is 6 m. New CCR plans default to 0.7 bar low, 1.3 bar high, and 6 m (20 ft) switch-up and switch-down. A hypoxic diluent is accepted on the loop with a flush warning instead of the open-circuit diluent error.
- Dil-out: a CCR diluent can join the bailout gases. A dedicated bailout with the same mix is used first, and the diluent is used when it is the richest or only breathable gas. The bailout ledger starts the diluent cylinder at its full volume minus a required, diver-entered estimate of loop, ADV, flush, wing, and suit use (plus any modeled open-circuit diluent breathing before the trigger); its reserve stays on the full volume. Cave loop-failure scenarios use the same bailout set and gas order, CCR cave turn limits no longer subtract loop breathing on the diluent cylinder, the diluent cylinder's turn pressure is never below what its exit and reserve require, and the penetration-limit search scales the entered diluent use with the route.
- Gas-only planning: open-water plans can enter gases without cylinders. The ledger shows used volume, the reserve, and the minimum volume to carry for each gas (thirds 1.5×, sixths 3×, custom volume added, or per-gas rock bottom) in ft³ or L, marked "Not checked (gas only)". A fixed minimum-pressure reserve is rejected with a one-click switch to thirds, per-gas max PPO₂ still limits switches, and Cave always plans with cylinders. A gas left with no reserve (for example a travel gas under rock bottom) is flagged. Switching a Tank Bank-sourced gas to Gas only carries its mix, name, and max PPO₂ into the plan.
- Bailout checks: at least one bailout gas must be switch-eligible at the target depth (switch depths now count) and at the surface, and the bailout gases together must cover every depth in between; the first uncovered band is reported. A bailout gas above the bottom PPO₂ limit at the trigger depth is flagged.
- Hypoxic legs: an open-circuit ascent leg that would end on a hypoxic gas now switches mid-leg, without a stop, to the travel or other eligible gas at the deepest safe depth. Some trimix plans with a travel gas previously breathed the bottom mix to the surface below 0.16 bar PPO₂ without a warning, or failed with a 48-hour decompression limit. Any plan that would still breathe a hypoxic open-circuit gas is now rejected. A stop that would otherwise run to the 48-hour limit on a lean gas now moves shallower to where a richer gas is usable and finishes there, with a warning; a CCR plan whose bailout still cannot finish decompression is rejected instead of shown as calculated.
- Plans without the new fields keep the legacy open-circuit diluent above the activation depth, and their CCR and non-hypoxic OC schedules are unchanged; a fixture test guards seven such inputs against engine 0.1.0 output. They can gain the new diluent and bailout-trigger warnings, and can be rejected or rerouted by the new bailout, hypoxic-leg, and stop checks. Recalculating an older saved plan always creates a new revision and leaves the historical revision untouched.
- CNS and OTU are not accumulated by the planner; the low setpoint and the modeling above change PPO₂ exposure without a planner exposure total.

## [0.3.0] - 2026-09-22

- Replaced the layered gradient visual system with a flat "instrument dark" system: near-neutral navy surfaces, hairline dividers, one cyan accent, and a token file (`src/styles/tokens.css`) that every color, size, and duration in the stylesheet references. The stylesheet is now split into sectioned files under `src/styles/`.
- Bundled IBM Plex Sans and IBM Plex Mono locally and precached them for offline use; measured values (metrics, readouts, tables, pressure and depth inputs) now use tabular monospace numerals.
- Added functional navigation icons to the desktop rail and mobile bottom bar, moved Settings to the bottom of the desktop rail (the topbar gear remains on phones and tablets), and reduced the footer to one row.
- Replaced hero page headers with a compact title row; decorative eyebrows were removed and only safety-bearing labels (experimental, unsafe, before-you-plan) keep a colored eyebrow.
- Flattened the Plan and Cave context strip, tightened field density on pointer devices (44 px targets remain on touch screens), and laid out gas and route editors in fixed two, three, or four column grids with one note per panel instead of repeated per-field hints.
- Presented result metrics as flat ruled tiles instead of boxed cards, flattened the profile chart palette, and made runtime and gas-ledger tables denser with striped rows.
- Grouped consecutive identical stop rows in the runtime schedule table (for example one 15-minute oxygen stop row instead of fifteen one-minute rows). This is presentation only: the profile graph, the profile data table, and every calculated value are unchanged.
- Folded the runtime and gas-ledger tables of nested Cave base and scenario plans behind disclosures so Cave Review no longer repeats two full table sets; the charts, aggregate status, and diagnostics stay visible.
- Presented the Tools library as a list with mode tags, consolidated the duplicate page-local button and field components onto the shared controls, and refreshed Tank Bank and Saved Plans cards, filters, and dialogs to the same system.
- Regenerated the phone, tablet, and desktop visual baselines for the new system.
- Runtime schedule: the Runtime column now shows whole minutes; the Time column, the profile graph, and the profile data table keep exact mm:ss values.
- Gas ledger: used, reserve, and remaining gas follow the cylinder-capacity preference (ft³ or L), and cylinders are described by rated ft³ capacity when the imperial preference is active; remaining pressure keeps the PSI/bar preference. The Cave reserve margin uses the same unit.
- Deco and bailout gases have an "Include in plan" switch so a gas can be removed from a calculation (lost or not carried) without deleting its entry; excluded gases and their cylinders are left out of the resolved plan input.
- Plan Setup order: Decompression and gas policies now sits above the gas cylinders.
- Cave thirds and cave sixths reserve policies lock each ad hoc cylinder's minimum-pressure field to the policy fraction of the starting pressure (one third or two thirds); when an entered minimum is higher, the field shows that value and says it governs. Reserve arithmetic is unchanged: the effective reserve was already the larger of the policy reserve and the cylinder minimum.
- SAC/RMV inputs in Plan (bottom, deco, bailout, bailout deco, rock-bottom stressed rate) follow the cylinder-capacity preference (ft³/min or L/min) with canonical L/min retained.
- The bottom-gas switch depth is shown only when a travel gas is in use.
- The overfilled-cylinder message is a clearer warning: the plan proceeds with the entered starting pressure.

## [0.2.2] - 2026-08-24

- Added a responsive application footer with the canonical app and calculation-engine versions plus GitHub, changelog, roadmap, validation, license, and issue links.

## [0.2.1] - 2026-08-23

- Labeled the independently versioned scientific component as the “Calculation engine” in Settings so its identifier is not confused with the app release.
- Replaced the profile's unexplained ceiling-dot field with one directly labeled checkpoint for the inspected segment and added color-matched phase/travel-duration summaries across Plan, CCR bailout, Cave base/scenario, and reopened Saved Plan graphs.

## [0.2.0] - 2026-08-23

- Licensed the project under the Apache License 2.0 and added SPDX package metadata.
- Added the illustrated Barefoot Dive identity across the in-app brand, browser icons, PWA install assets, iOS and Android launchers, and native splash screens.
- Added Cloudflare Workers static-asset hosting for `barefootdive.app` and `www.barefootdive.app`, automated `main` deployments through Workers Builds, deploy-package validation, and security headers.
- Replaced the generic Tools selector with a task-oriented library and focused, responsive calculator workspaces for all eleven named capabilities.
- Added per-tool ephemeral session inputs, field and cross-field diagnostics, typed result presenters, Tank Bank snapshots with manual detachment, and safe debounced live results for Emergency Gas.
- Added clearer Tools section hierarchy, live/updating/invalid status cues, active-navigation indicators, restrained page/result transitions, and reduced-motion behavior.
- Refined the shared visual system with layered workspace depth, stronger page and panel hierarchy, clearer result metrics, richer navigation and controls, and visible keyboard focus for segmented choices.
- Added one-shot border completion cues for Plan and Cave calculations, local snapshot and cylinder saves, and confirmed Tool-to-Plan transfers without animating safety-critical values; successful calculations bring the completed result into view.
- Split the top-level Plan and Cave workspaces into Setup and Review, with an explicit first calculation, debounced recalculation after later valid edits, and suppression of superseded results and saving while inputs are updating or invalid.
- Kept the current Plan and Cave drafts and matching results across primary-workspace navigation for the app session, surfaced Tank Bank source revisions for explicit Plan or Cave updates, and retained display/local preferences in Settings.
- Made Cave Review show one aggregate status and diagnostic list across the base plan and every enabled failure scenario, so an unsafe unselected scenario cannot sit behind a positive overall summary before saving.
- Added exact, confirmed Plan patches for Best Mix, one selected SAC/RMV target, and OC rock-bottom assumptions; unsupported calculators remain display-only.
- Added versioned trimix Best Mix and END narcotic policies, dual-input SAC/RMV, entered-schedule Emergency Gas, and distinct absolute, gauge, and pressure-delta types.
- Added source-backed literal Tools fixtures from NOAA, U.S. Navy, SSI, and the documented Subsurface convention option; these establish formula arithmetic only, not procedure or planner parity.
- Required explicit END oxygen, OC Emergency team size, and cylinder reserve; routed Emergency segments through the shared planner gas-integration primitive and exposed exact Best Mix active constraints.
- Made Tools depth, cylinder pressure, surface-gas volume, and RMV presentation follow Settings while retaining canonical metres, bar, litres, and L/min; strengthened the MOD Feet/Meters regression.
- Fixed Tank Bank card actions so multiple cylinders keep their Delete controls separated and clickable across responsive layouts.
- Scrolled newly added deco and bailout gas editors and Cave route legs into view without hiding them behind sticky workspace controls, and kept rapid route additions uniquely numbered.
- Kept long result metric values, including the calculated safety status, inside their cards at intermediate viewport widths.
- Added time-accurate interactive profile graphs with labeled runtime and depth measures, decompression bands, subdued endpoint ceiling checkpoints with a plain-language explanation, numbered and selectable gas/setpoint-switch and reserve-crossing details, a docked non-overlapping scrub readout, and accessible mouse, touch, and keyboard inspection across primary, CCR bailout, Cave base/scenario, and stored base-plan results.
- Displayed the app release and calculation-engine identifiers together in Settings so support reports can distinguish product changes from scientific engine changes.
- Used the planner's canonical engine identifier for Saved Plan stale-version checks.

## [0.1.0] - 2026-08-21

- Added the offline-first React/Vite PWA and Capacitor application shell.
- Added pure unit-safe technical calculations: ZH-L16C/GF planning, OC and constant-setpoint CCR profiles, travel/deco/diluent/bailout semantics, exact-trigger-state CCR bailout, and integrated gas/reserve accounting.
- Added all 11 production calculator tools: MOD, Best Mix, END, gas density, PPO2, SAC/RMV, gas duration, rock bottom, cylinder gas, CNS, and simplified bailout.
- Added Tank Bank and immutable saved-plan snapshots with revisions, lineage, engine/convention metadata, warnings, and cave context.
- Added independent imperial rated-capacity, metric water-volume, and pressure preferences while retaining canonical water-volume and bar calculations.
- Displayed and entered PSI as whole numbers across planning, cave, Tank Bank, and Tools while retaining canonical bar precision.
- Added pinned OC multigas, CCR, and CCR-bailout comparison envelopes against Abysner's published cross-planner profiles, with schedule differences documented rather than claimed as parity.
- Added experimental cave route and scenario modeling with per-cylinder turn context, recalculated gas-derived bounds, CCR bailout-ledger limits, and immutable cave-layer safety diagnostics. Cave ceiling-safe routes require explicit modeling and qualified cave-diver review.
- Documented compatibility presets as experimental settings presets, not MultiDeco or Shearwater parity claims.
- Added a sequenced roadmap separating validation gates, planned product expansion, and conditional connected capabilities.
- No signed or store-submitted native artifact is included.
