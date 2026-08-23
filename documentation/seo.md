# Static metadata and indexing

Barefoot Dive exposes one public application entry point at `/`. `index.html` supplies a fixed title, description, theme color, and icon links. The Vite PWA manifest repeats the public product description and install-icon set. Local Tank Bank, Saved Plan, Tool, Plan, and Cave data never enters page metadata.

| Surface | Metadata source | Public-data boundary |
| --- | --- | --- |
| Browser entry point | `index.html` | Fixed product name and description |
| Installed PWA | `vite.config.ts` manifest | Fixed product name, description, colors, and public icons |
| Cloudflare custom domains | Built `dist/` assets | Serves the same static metadata on `barefootdive.app` and `www.barefootdive.app` |

The app has no public content routes, user-generated pages, dynamic metadata, structured data, sitemap, prerendering, or crawler-specific response path. A future public sharing or content route requires a separate metadata and privacy design before implementation.

Release verification runs `npm run build`, inspects `dist/index.html` and `dist/manifest.webmanifest`, then checks the title, description, icons, and response headers on both custom domains after deployment.
