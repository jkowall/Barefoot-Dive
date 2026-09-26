import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  test: {
    // .claude/ holds local agent worktrees, each with its own sources and node_modules.
    exclude: ["tests/ui/**", "node_modules/**", "dist/**", ".claude/**"],
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      registerType: "autoUpdate",
      workbox: { globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"] },
      includeAssets: [
        "logo.png",
        "logo-32.png",
        "logo-64.png",
        "logo-180.png",
        "logo-192.png",
        "logo-512.png",
        "logo-512-maskable.png",
      ],
      manifest: {
        name: "Barefoot Dive",
        short_name: "Dive",
        description: "Offline-first technical dive planning for OC and CCR divers.",
        theme_color: "#08111f",
        background_color: "#08111f",
        display: "standalone",
        icons: [
          { src: "logo-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "logo-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "logo-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ]
      }
    })
  ]
});
