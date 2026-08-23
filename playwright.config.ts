import { defineConfig } from "@playwright/test";

const chrome = process.env.PLAYWRIGHT_CHROME_EXECUTABLE
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);

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
    baseURL: "http://127.0.0.1:4173",
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
    command: "npm run preview -- --host 127.0.0.1",
    url: "http://127.0.0.1:4173",
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
