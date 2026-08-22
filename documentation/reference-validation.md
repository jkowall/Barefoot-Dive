# Reference validation and evidence boundary

## Primary sources used

- [DecoTengu model source](https://wrobell.dcmod.org/decotengu/_modules/decotengu/model.html): primary reference for the ZH-L16C/OSTC coefficient and tissue-model implementation lineage.
- [DecoTengu usage fixture](https://wrobell.dcmod.org/decotengu/usage.html): representative usage/profile conventions used to inform the implementation and fixtures.
- [Abysner comparison plans, pinned at `43823b9`](https://github.com/NeoTech-Software/Abysner/blob/43823b96cd2388aaf311f6969c26200cf5924365/readme.md#compared-to-other-planners): published OC multigas, CCR, and CCR-bailout schedules compared by that project with Subsurface and DIVESOFT.APP.
- [NOAA oxygen toxicity and inert gas narcosis slides](https://www.omao.noaa.gov/sites/default/files/documents/Inert%20Gas%20Narcosis%20and%20O2%20Toxicity_slides121316.pdf): source for the discrete single-exposure CNS limit table from PPO2 0.6 through 1.6 bar. Barefoot Dive's versioned policy linearly interpolates between those rows; the NOAA source is not claimed to specify interpolation. Inputs outside the source table are rejected.
- [NOAA Diving Medical Technician Formula Book `111816`](https://www.omao.noaa.gov/sites/default/files/documents/DMT%20Formula%20book%20111816.pdf), PDF page 4, “Air Requirement Formulas” 1-8: source for SAC, cylinder constant, RMV, depth consumption, available volume, total requirement, and duration arithmetic.
- [U.S. Navy Diving Manual Rev. 7 Change A, corrected digital file dated 2018-06-06](https://www.navsea.navy.mil/Portals/103/Documents/SUPSALV/Diving/US%20DIVING%20MANUAL_REV7_ChangeA-6.6.18.pdf), issued 2018-04-30, Volume 1 page 2-32, Table 2-9: source for the nitrogen-only equivalent-air-depth equation and `0.79` air-nitrogen reference. Volume 2 section 7-5 independently describes RMV, depth, capacity, pressure, and reserve as the governing air-supply variables. The current file is listed on NAVSEA's official [Diving Publications index](https://www.navsea.navy.mil/Home/SUPSALV/00C3-Diving/Diving-Publications/lang/en/).
- [SSI EMS `202110.6`, Equivalent Narcotic Depth](https://training.divessi.com/index.php?id=20109644): publishes both implemented END equations: nitrogen-only, and oxygen plus nitrogen narcotic. [Subsurface 4.9.4 release notes](https://github.com/subsurface/subsurface/blob/master/ReleaseNotes/ReleaseNotes.txt) independently document a selectable oxygen-narcotic convention; Barefoot does not claim Subsurface formula or output parity.

These sources document model lineage and a CNS method. They do not validate the complete Barefoot Dive product, a particular dive plan, a bailout procedure, a reserve policy, cave route safety, or parity with MultiDeco/Shearwater/dive computers.

## Committed comparison evidence

- `planner.test.ts` asserts the DecoTengu usage page's published ZH-L16C first stop, final stop, and 52-minute decompression total. It also pins the intermediate stops, first-compartment tissue pressures, and ceiling independently reproduced with DecoTengu 0.14.1; those additional values are repository regression fixtures, not values printed on the published usage page.
- `reference-comparison.test.ts` runs the production event engine against Abysner reference plan 2. Barefoot produces a 49-minute runtime inside the published 48–50 minute cross-planner range and 13 stop-minutes inside the published 12–14 minute range. Barefoot adds a one-minute 12 m stop; its final 6 m/11 minute stop matches Abysner.
- The same suite runs Abysner reference plan 6 with the published 0.7/1.2 CCR setpoints. Barefoot produces 39 minutes, inside the published 39–40 minute range, with three stop-minutes inside the published two-to-four-minute range. Its 9/6/3 m distribution differs from the compared planners.
- The suite runs reference plan 7's end-of-bottom CCR bailout through the same committed event/tissue state. Barefoot produces 51 minutes, inside the Abysner/Subsurface 51–52 minute range. DIVESOFT.APP's documented 60-minute disagreement remains an unresolved outlier and is not presented as parity.

These are transparent cross-implementation comparison envelopes, not exact input replicas and not an assertion that schedule distribution differences are interchangeable or safe. The pinned Abysner tables label plans 2, 6, and 7 as salt water, while the tests use Barefoot's documented sea-level 10 m/bar environment because the comparison table does not state its exact pressure conversion. Barefoot switch events are zero-duration; the published Abysner plan schedules include a one-minute gas/bailout switch, and other planners in the source omit or vary it. These differences are explicit reasons to compare only the broad published runtime and stop-minute envelopes. The normal public CCR editor remains constant-setpoint; the low/high setpoints above exercise the internal exposure-event model used by cave/scenario transformations.

## Tools formula fixtures

`src/calculations/referenceFixtures.ts` commits literal inputs, expected outputs, tolerances, provenance, assumptions, and hand derivations. `index.test.ts` passes those values through the production functions without using a production function to create the expected value. The fixture was independently audited by a read-only `gpt-5.6-sol` scientific-review agent on 2026-08-21; that is arithmetic review, not qualified-diver review.

The reference set includes:

- 60 m, PPO2 1.4 bar absolute, maximum END 30 m: Tx20/43 when oxygen and nitrogen are narcotic, and approximately Tx20/35 when nitrogen alone is narcotic. Both are round-tripped through END, and explicit Tx18/45 under nitrogen-only policy yields 22.7848101266 m.
- 600 surface litres over 10 minutes at 20 m, and a 12 L cylinder falling from 200 to 150 bar gauge over the same exposure: both produce 20 L/min at 3 bar absolute.
- A three-leg 30 m-to-surface emergency schedule: 224, 96, and 26 surface litres for one diver; 346 L total for CCR; and 692 L for an OC team of two. The fixtures cover schedule-only output, equal, sufficient, and insufficient cylinder margins, explicit zero reserve, required CCR cylinder context, and invalid route/team/reserve cases.

The arithmetic assumes a 1 bar absolute surface, 10 m/bar, surface litres referenced to 1 bar, a linear depth change within each moving segment, and the ideal linear cylinder-constant model `water volume × gauge-pressure delta`. The mean of segment start/end ambient pressure is time-weighted only because depth is assumed to change linearly with time. These fixtures do not cover real-gas compressibility, temperature/composition effects in a cylinder, procedure sufficiency, bailout training, or planner parity. No discrepancy with the cited equations is accepted; any future equation, reference-pressure, or cylinder-model change requires a new fixture version and explicit discrepancy record.

## Remaining evidence boundary

The repository also has deterministic unit tests for model transitions, validation, calculators, gas ledger/reserve crossings, cave scenarios, and immutable storage. Those tests are regression coverage, not independent field validation. The Tools fixtures above close their stated formula-arithmetic checks only. Broader multi-depth/mix profiles and independent altitude, reserve-policy, CNS-output, and cave vectors still need inputs, expected outputs, tolerances, reviewer identity, and unresolved-difference records before any stronger public validation or compatibility claim.

Compatibility presets are explicitly experimental. Cave planning is explicitly experimental; a ceiling-safe cave route must be explicitly modeled and checked, and cave output remains pending qualified cave-diver review. Analyzer readings and qualified diver review remain authoritative.
