import { createHash } from "node:crypto";
import { connect, createServer } from "node:net";
import { defineConfig } from "@playwright/test";

const chrome = process.env.PLAYWRIGHT_CHROME_EXECUTABLE
  ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : undefined);

// Parallel worktrees must never test, or shut down, each other's preview server. Each checkout
// prefers a port in 4200-4999 derived from its path and moves to the next port when that one
// answers or another run has reserved it, so a hash collision or any other listener gets a fresh
// server instead of an error. The runner records its choice in PLAYWRIGHT_PORT, which its workers
// inherit. Setting PLAYWRIGHT_PORT pins a port. PLAYWRIGHT_REUSE_SERVER=1 tests a preview already
// running on the preferred port and skips the build, so use it only for this checkout's current
// build.
const FIRST_PORT = 4200;
const PORT_COUNT = 800;
const RESERVATION_OFFSET = 1000;
const reuseExistingServer = process.env.PLAYWRIGHT_REUSE_SERVER === "1";

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

// A run reserves its port by listening on port + 1000 until it exits. Binding is atomic, so two
// runs that both find the same port free cannot both reserve it during the build, and the
// operating system releases the reservation when the run exits or crashes.
function reserve(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const holder = createServer((socket) => socket.destroy());
    holder.once("error", () => resolve(false));
    holder.listen(port + RESERVATION_OFFSET, "127.0.0.1", () => { holder.unref(); resolve(true); });
  });
}

async function previewPort(): Promise<number> {
  const pinned = process.env.PLAYWRIGHT_PORT;
  if (pinned !== undefined) {
    const value = Number(pinned);
    if (!/^\d+$/.test(pinned) || value < 1024 || value > 65535) {
      throw new Error(`PLAYWRIGHT_PORT must be a whole number from 1024 to 65535, not "${pinned}".`);
    }
    return value;
  }
  const offset = createHash("sha256").update(import.meta.dirname).digest().readUInt16BE(0) % PORT_COUNT;
  if (reuseExistingServer) return FIRST_PORT + offset;
  for (let step = 0; step < PORT_COUNT; step += 1) {
    const candidate = FIRST_PORT + (offset + step) % PORT_COUNT;
    if (!await answers(candidate) && await reserve(candidate)) return candidate;
  }
  throw new Error(`Every preview port from ${FIRST_PORT} to ${FIRST_PORT + PORT_COUNT - 1} is in use or reserved; set PLAYWRIGHT_PORT.`);
}

const port = await previewPort();
process.env.PLAYWRIGHT_PORT = String(port);
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
    reuseExistingServer,
    timeout: 120_000,
  },
});
