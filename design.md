# Barefoot Dive product specification

Barefoot Dive is a planning-first sibling product to Barefoot Blender for technical OC and CCR divers. The current client-only implementation is an offline PWA plus Capacitor shells. Calculations stay local and pure; there is no remote calculation path.

## Brand identity

The Barefoot Dive mark uses the illustrated rope-badge language of Barefoot Blender while depicting technical dive planning: a barefoot diver with twin open-circuit cylinders reviews a stepped profile in a cave. The full warm-white artwork is stored at `assets/logo.png`; `assets/logo-transparent.png` is the background-free production cutout used to create dark-field launcher and splash variants.

Browser and PWA derivatives live in `public/` at 32, 64, 180, 192, and 512 pixels, with a separately padded 512-pixel maskable icon. The iOS app icon, Android legacy and adaptive launchers, and native splash images use the same cutout on the application navy (`#08111f`). Native icons retain the platform mask rather than baking rounded corners into the artwork.

The application uses a layered dark-slate visual system with restrained cyan depth cues, elevated primary surfaces, explicit keyboard focus, and stronger metric grouping. Navigation, page headers, forms, and results share the same surface hierarchy. Motion is reserved for state transitions and completion feedback; safety-critical values remain static.

## Current implemented product

The planner supports square open-water OC and constant-setpoint CCR profiles, travel and deco gas selection, diluent and bailout semantics, GF-based decompression, and integrated gas/reserve accounting. CCR bailout is calculated from the exact tissue/depth/runtime trigger state selected by the user. The same production calculation functions power all 11 tools: MOD, Best Mix, END, gas density, PPO2, SAC/RMV, gas duration, rock bottom, cylinder gas, CNS, and simplified bailout.

Plan is one top-level workspace with distinct Setup and Review views. Setup contains the editable profile, gas, cylinder, decompression, consumption, and reserve assumptions; Review contains only the result that matches those current inputs. The first calculation is explicit. After that first result, direct valid edits recalculate after a short pause. While an update is pending, or while the current inputs are invalid, the previous numeric result and Save action are not shown. The Plan draft and its latest matching result remain available while the user moves among primary workspaces during the current app session.

Tank Bank records selected in Plan are resolved into explicit calculation snapshots. A later Tank Bank revision is surfaced as an available update but never silently replaces the calculated Plan snapshot; the diver must choose to update before Plan recalculates against the revised record. Global Settings remains limited to display and local preferences rather than Plan assumptions.

The Tools UI is organized into Gas & depth, Consumption & cylinders, and Emergency & exposure tasks. Each calculator opens a focused responsive workspace with a visible live-result state. Emergency Gas is explicit and separate: Rock Bottom / Minimum Gas and Simplified Bailout check an entered schedule, optionally against one OC cylinder and always against one CCR bailout cylinder; they do not generate a decompression or bailout plan. Its result updates after a short debounce, with an updating indicator and no superseded answer left beside edited inputs. Tool inputs are ephemeral per-session values. Tank Bank selections are snapshots that can be manually detached, and Plan application is limited to the exact patches documented in [`documentation/tools.md`](documentation/tools.md). Across workspaces, active-navigation markers and short page/result transitions clarify movement without animating safety-critical values. Completed calculation runs, local saves, and confirmed Plan transfers trace a one-shot border around explicit completion copy; successful Plan and Cave calculations bring that result into view. The cue describes state completion without implying that a result is safe. Reduced-motion preferences render the completed border immediately and use an immediate rather than smooth result scroll.

Tank Bank stores explicit analyzed-cylinder records. Saved plans preserve immutable normalized inputs, resolved gases/cylinders, calculated output, warnings, engine/convention versions, revision lineage, and cave context where applicable.

Cave planning is an experimental route/event layer over the production engine. It supports penetration and exit legs, accessible-cylinder constraints, gas-derived turn limits, and lost-back-gas, lost-buddy, scooter-failure, stage-failure, and CCR-loop-failure scenarios. A ceiling-safe cave route must be explicitly modeled as route legs and checked against the calculated ceiling. This is not a cave-procedure or parity claim and remains pending qualified cave-diver review.

Cave calculation remains an explicit action. Changing a calculated cave draft hides the superseded numeric output and changes the action to `Update cave plan`; saving remains unavailable until the new result matches the current cave inputs.

## Scientific and safety boundary

The engine exposes a 16-compartment ZH-L16C coefficient set attributed to OSTC through DecoTengu, with gradient factors and deterministic stop scheduling. MultiDeco and Shearwater-named presets are experimental scheduling policies layered on the same model; their names do not claim compatibility or schedule parity.

Outputs are decision support, not a substitute for a dive computer, decompression procedure, gas analysis, bailout training, or qualified review. Analyzer-first input and final analyzer readings remain authoritative. No release claim should exceed the independent reference evidence recorded in `documentation/reference-validation.md`.

## Product constraints

- Local-only browser/native execution; no accounts, network service, analytics, subscriptions, provider credentials, or secrets.
- Local persistence uses `localStorage`; it is not backup or synchronization.
- Preserve auditable snapshots and explicit engine metadata when changing calculations.
- Keep the decompression and gas modules deterministic, unit-safe, and independent of React UI.
- The client-only web bundle may be published through Cloudflare; no signed or store-submitted native artifact is represented by this repository.

Later work may add arbitrary profiles, repetitive dives, additional setpoint transitions, OTU, IBCD evidence, and richer cave branching only with separate implementation and validation evidence.
