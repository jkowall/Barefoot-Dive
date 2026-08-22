# Web deployment

Barefoot Dive is deployed as an assets-only Cloudflare Worker. It remains a client-only application: calculations, Tank Bank records, and saved plans stay in the browser, and Cloudflare serves only the generated `dist/` bundle.

## Repository configuration

- `wrangler.jsonc` names the `barefoot-dive` Worker, serves `dist/`, and declares `barefootdive.app` plus `www.barefootdive.app` as Custom Domains.
- `public/_headers` applies the same security-header baseline as Barefoot Blender.
- Wrangler is pinned in `package.json`; `npm run check:deploy` validates the built upload without publishing it.
- `.github/workflows/ci.yml` runs `npm ci`, `npm run check`, and the Wrangler dry run for pull requests and `main` pushes. It does not deploy or hold Cloudflare credentials.

## Cloudflare Workers Builds

Cloudflare owns the deployment credential and connects directly to `jkowall/Barefoot-Dive`. The production settings are:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Root directory | `/` |
| Build command | `npm run check` |
| Deploy command | `npx wrangler deploy` |
| Non-production deploy command | `npx wrangler versions upload` |

A successful Cloudflare build from `main` promotes the resulting Worker version. Other branches create preview versions but do not replace production. No Cloudflare token, account identifier, or application secret belongs in the repository or client bundle.

## Verification

Repository validation:

```sh
npm ci
npm run check
npm run check:deploy
```

After Cloudflare reports a successful production deployment, verify both custom domains, the generated asset hashes, and the security headers from the public response. A successful deployment proves artifact delivery only. It does not establish decompression, gas, reserve, CNS, bailout, cave-procedure, or computer/planner parity.
