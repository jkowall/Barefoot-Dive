import { createHash } from "node:crypto";
import { defineConfig } from "@playwright/test";

const chrome = process.env.PLAYWRIGHT_CHROME_EXECUTABLE
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);

// Parallel worktrees must never test, or shut down, each other's preview server. Each checkout
// builds and serves on its own port in 4200-4999, derived from its path; PLAYWRIGHT_PORT pins a
// port, and PLAYWRIGHT_REUSE_SERVER=1 allows testing a server that is already running there.
const port = Number(process.env.PLAYWRIGHT_PORT) ||
  4200 + createHash("sha256").update(import.meta.dirname).digest().readUInt16BE(0) % 800;
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  retries: 0,
  reporter: "line",
  outputDir: "test-results/playwright",
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    browserName: "chromium",
    launchOptions: chrome ? { executablePath: chrome } : undefined,
    locale: "en-US",
    timezoneId: "America/New_York",
    colorScheme: "dark",
  },
  projects: [
    {
      name: "smoke-desktop",
      testIgnore: /visual\.spec\.ts/,
      use: { viewport: { width: 1440, height: 1024 } },
    },
    {
      name: "visual-phone",
      testMatch: /visual\.spec\.ts/,
      use: { viewport: { width: 375, height: 812 } },
    },
    {
      name: "visual-tablet",
      testMatch: /visual\.spec\.ts/,
      use: { viewport: { width: 768, height: 1024 } },
    },
    {
      name: "visual-desktop",
      testMatch: /visual\.spec\.ts/,
      use: { viewport: { width: 1440, height: 1024 } },
    },
  ],
  webServer: {
    command: `npm run build && npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: process.env.PLAYWRIGHT_REUSE_SERVER === "1",
    timeout: 120_000,
  },
});
