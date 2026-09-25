# Tools library and workspace

The `0.5.0` checkout implements Tools as a task-oriented library and focused calculator workspace. Passing regression tests establish implementation behavior, not operational safety or field validation. The live source and verification record remain authoritative.

## Library

| Category | Capabilities |
| --- | --- |
| Gas & depth | MOD, Best Mix, PPO2, END, Gas Density |
| Consumption & cylinders | SAC / RMV, Gas Duration, Cylinder Gas |
| Emergency & exposure | Emergency Gas: Rock Bottom / Minimum Gas and Simplified Bailout; CNS |

The eleven named capabilities are MOD, Best Mix, END, Gas Density, PPO2, SAC / RMV, Gas Duration, Rock Bottom / Minimum Gas, Cylinder Gas, CNS, and Simplified Bailout. “Rock Bottom” and “Minimum Gas” are names for the same Emergency Gas mode, not two additional calculators.

## Focused workspace

The workspace keeps the selected task, inputs, result, warnings, and next action together on a responsive phone, tablet, and desktop layout. Simple tools calculate live as inputs change and show their assumptions. Only supported results offer a precise Plan action, and every patch requires a before/after confirmation; a result never silently mutates a plan.

Inputs in the Tools workspace are per-session and ephemeral. Each tool retains its own canonical inputs while the user switches tools or primary workspaces. Reloading the app resets them. They are not a saved plan, a Tank Bank record, or a cloud backup.

## Simple calculations and Emergency Gas

MOD, Best Mix, END, Gas Density, PPO2, SAC / RMV, Gas Duration, Cylinder Gas, and CNS are simple calculations. Their results are live, local decision support and should make stale assumptions visible when an input or policy version changes.

Emergency Gas is different. It requires an explicit entered schedule. Rock Bottom / Minimum Gas is always OC and requires an explicit team size. Simplified Bailout is always CCR, uses a team multiplier of one, and requires one cylinder. OC can calculate required surface-gas volume without cylinder context; pressure and sufficiency output requires an entered or snapshotted cylinder and an explicit reserve, including an intentional zero. It is not a generated decompression plan, a generated bailout plan, or a substitute for the planner’s CCR bailout output. The one entered stressed RMV applies to every entered segment, ascent and stop alike; the planner’s bottom and deco RMV phases do not apply here. A valid current schedule recalculates automatically after a 250 ms pause. While an update is pending, the prior answer and Plan action are hidden or disabled so edited inputs are never presented beside an outdated result. Invalid current inputs replace the answer with diagnostics. The result retains the exact calculated assumptions separately from the editable form.

## Tank Bank and snapshots

Tank Bank is the source for analyzed gas and cylinder records, but selecting a Tank Bank item in Tools creates a session snapshot. Later Tank Bank edits do not silently rewrite the current calculation. The user can manually detach the session from Tank Bank and continue with entered values; the UI makes that detachment visible. Any Plan operation applies an explicit patch, and later plan saving records the resolved plan gas/cylinder values in its immutable snapshot.

The exact allowed patches are narrow:

- Best Mix may patch only the OC bottom-gas name, oxygen fraction, and helium fraction; an incompatible or unavailable cylinder assignment is cleared, and the confirmation says the bottom gas then uses the ad hoc cylinder values shown in Plan Setup.
- SAC / RMV may patch the SAC/RMV target only.
- OC Rock Bottom / Minimum Gas may patch the OC rock-bottom assumptions only.

Other tool results remain informational until a separately specified plan action exists. No tool result may overwrite decompression settings, CCR setpoints, schedule events, or unrelated gases/cylinders.

## Conventions and units

Best Mix and END use versioned policy identifiers for PPO2 and narcotic assumptions. END requires both actual oxygen and helium fractions. Best Mix returns every active constraint so boundary cases are not mislabeled. They are live calculations, so a policy change immediately replaces the result. SAC / RMV supports both a direct measured-surface-gas input and a cylinder gauge-pressure-drop input; the mode and all source values remain visible in the result. The cylinder-capacity preference also selects surface-gas and RMV presentation: rated ft³ and ft³/min for imperial, or litres and L/min for metric. Switching display units does not rewrite the canonical Tool draft or result.

Pressure semantics are explicit: ambient pressure is absolute bar, cylinder pressure is gauge bar, and gas consumption/reserve calculations use pressure deltas. PSI is a display/input conversion for gauge cylinder pressure; PPO2 and ambient calculations remain absolute bar. MOD, Best Mix, PPO2, END, Gas Density, SAC / RMV, Gas Duration, and Emergency Gas depth values follow the Feet/Meters preference. Canonical storage retains every unit distinction even in imperial display mode.

## Evidence boundary

Tool unit tests and planner parity tests are regression evidence only. Independent fixtures, reference comparison, analyzer-first gas verification, and qualified-diver review are required before safety, compatibility, or planner-parity claims. Emergency Gas arithmetic must not be described as a validated bailout procedure.
