import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import packageJson from "./package.json" with { type: "json" };

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(packageJson.version) },
  test: {
    exclude: ["tests/ui/**", "node_modules/**", "dist/**"],
  },
  plugins: [
    react(),
    VitePWA({
      injectRegister: null,
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "icon-maskable.svg"],
      manifest: {
        name: "Barefoot Dive",
        short_name: "Dive",
        description: "Offline-first technical dive planning for OC and CCR divers.",
        theme_color: "#08111f",
        background_color: "#08111f",
        display: "standalone",
        icons: [
          { src: "icon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" }
        ]
      }
    })
  ]
});
