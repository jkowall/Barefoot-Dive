# Variables and secrets

| Name/source | Used by | Runtime scope | Source and rotation | Risk |
| --- | --- | --- | --- | --- |
| `package.json` version (`0.4.0`) | Vite build, Settings/footer display, and web/source release metadata | Client | Repository release edit; change for an app release | Stale release identification if package and documentation diverge |
| Android `versionName`/`versionCode` and iOS `MARKETING_VERSION`/`CURRENT_PROJECT_VERSION` (`1.0`/`1`) | Native package metadata | Native builds | Native project files; change and increment for an authorized native release | Store rejection or version drift if marketing versions and build counters diverge |
| `ENGINE_VERSION` | Plan metadata, Settings/footer display, and stale-snapshot detection | Client | Canonical export from `src/engine/planner.ts`; change only with scientific engine behavior | False stale-plan warnings or mislabeled calculation history |
| ZH-L16C model/coefficient/convention metadata | Plan metadata | Client | Versioned source constants; change with the corresponding model or policy | Calculation output loses an auditable model identity |
| `wrangler.jsonc` | Cloudflare Worker name, asset directory, and custom domains | Build/deployment | Repository configuration; review with deployment changes | A bad route or asset path can publish the wrong bundle |
| Cloudflare Workers Builds generated API token | Cloudflare build and deployment service | Cloudflare account only | Cloudflare-managed secret; rotate after exposure or access changes | Grants deployment access; never commit or bundle it |
| `localStorage` keys `barefoot-dive:tank-bank` and `barefoot-dive:saved-plans` | Tank Bank and saved snapshots | Device-local | Created by the app; removed when the user or platform clears storage | Contains local planning data with no cloud backup |
| `localStorage` key `barefoot-dive:preferences` | Depth, cylinder-pressure, and cylinder-capacity display preferences; capacity also selects surface-gas and RMV units | Device-local | Created by the app; removed when the user or platform clears storage | Reset changes presentation defaults, not canonical saved values |

No `VITE_*` secrets or runtime credentials are required. Do not add credentials, account identifiers, network endpoints, analytics keys, subscriptions, or signing material to the client bundle. Changes to calculation assumptions must update engine/convention metadata and the reference-validation record.

Tools inputs are session-local and ephemeral. Tank Bank selections are copied as snapshots; manual detachment is explicit and does not alter the Tank Bank record. Emergency Gas results retain the entered schedule, assumptions, exact-input signature, and optional OC or required CCR single-cylinder snapshot. The UI suppresses a result while its signature does not match the current draft and automatically replaces it after the debounce. Best Mix/END policy identifiers and SAC/RMV input mode are result metadata, not hidden global settings.

Cylinder calculations always retain canonical physical water volume in litres and pressure in bar. Imperial UI fields convert that pair to rated surface ft³ at working pressure; metric UI fields expose water-volume litres directly. PSI inputs and displays use whole numbers; bar inputs step by 0.1 and bar displays use one decimal. New input is normalized to that presentation resolution before exact canonical conversion, while rendering or switching units does not rewrite an existing canonical pressure. A displayed pressure is always accompanied by its cylinder-capacity context in planning results.

Pressure semantics are explicit: ambient and PPO2 use absolute pressure, cylinder pressure is gauge pressure, and gas-use calculations use gauge-pressure deltas.
