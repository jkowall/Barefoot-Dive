# Variables and secrets

| Name/source | Used by | Scope | Sensitivity |
| --- | --- | --- | --- |
| `package.json` version (`0.1.0`) | App/build metadata | Client | Informational |
| `ENGINE_VERSION` | Plan metadata and stale-snapshot detection | Client | Informational |
| ZH-L16C model/coefficient/convention metadata | Plan metadata | Client | Audit metadata |
| `wrangler.jsonc` | Cloudflare Worker name, static asset directory, and custom domains | Build/deployment | Non-sensitive |
| Cloudflare Workers Builds generated API token | Cloudflare build and deployment service | Cloudflare account only | Secret; never committed or bundled |
| `localStorage` keys `barefoot-dive:tank-bank` and `barefoot-dive:saved-plans` | Tank Bank and saved snapshots | Device-local | User planning data |
| `localStorage` key `barefoot-dive:preferences` | Independent depth, pressure, and cylinder-capacity display preferences | Device-local | Non-sensitive |

No `VITE_*` secrets or runtime credentials are required. Do not add credentials, account identifiers, network endpoints, analytics keys, subscriptions, or signing material to the client bundle. Changes to calculation assumptions must update engine/convention metadata and the reference-validation record.

Tools inputs are session-local and ephemeral. Tank Bank selections are copied as snapshots; manual detachment is explicit and does not alter the Tank Bank record. Emergency Gas results retain the entered schedule, assumptions, exact-input signature, and optional OC or required CCR single-cylinder snapshot. The UI suppresses a result while its signature does not match the current draft and automatically replaces it after the debounce. Best Mix/END policy identifiers and SAC/RMV input mode are result metadata, not hidden global settings.

Cylinder calculations always retain canonical physical water volume in litres and pressure in bar. Imperial UI fields convert that pair to rated surface ft³ at working pressure; metric UI fields expose water-volume litres directly. PSI inputs and displays use whole numbers; bar inputs step by 0.1 and bar displays use one decimal. New input is normalized to that presentation resolution before exact canonical conversion, while rendering or switching units does not rewrite an existing canonical pressure. A displayed pressure is always accompanied by its cylinder-capacity context in planning results.

Pressure semantics are explicit: ambient and PPO2 use absolute pressure, cylinder pressure is gauge pressure, and gas-use calculations use gauge-pressure deltas.
