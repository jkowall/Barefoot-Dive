import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

// The oldest runtime the bundle supports. Safari and iOS 15.4 match the iOS app's
// IPHONEOS_DEPLOYMENT_TARGET; Chrome, Edge, and Firefox keep Vite 8's baseline. Vite's default
// (iOS 16.4) let Lightning CSS write breakpoints in range syntax, which WebKit ignores before
// 16.4. src/platform/runtimeFloor.test.ts keeps this list and the Xcode target in step.
const RUNTIME_FLOOR = ["safari15.4", "ios15.4", "chrome111", "edge111", "firefox114"];

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  build: { target: RUNTIME_FLOOR, cssTarget: RUNTIME_FLOOR },
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
