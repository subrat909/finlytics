import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (plan W15): Chromium against `next dev` and the built api, with the compose stack running
 * (postgres, redis, mailpit). Locally both servers are reused when already running (`pnpm dev`); CI starts them.
 * The api must be built first (turbo's `test:e2e` depends on `@finlytics/api#build`).
 */
const WEB_URL = "http://localhost:3000";
const API_URL = "http://127.0.0.1:4000";
const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: WEB_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node --env-file-if-exists=../../.env --enable-source-maps dist/main.js",
      cwd: "../api",
      url: `${API_URL}/health/ready`,
      // Every role (plan P1): the realtime gateway and the paper feed drive the live-price e2e, always on so it passes
      // outside market hours.
      env: { APP_ROLE: "http,gateway,feed,worker", MARKET_FEED_SOURCE: "paper", MARKET_FEED_ALWAYS_ON: "true" },
      reuseExistingServer: !CI,
      timeout: 60_000,
    },
    {
      command: "pnpm exec next dev --hostname localhost --port 3000",
      url: `${WEB_URL}/login`,
      // The browser's realtime socket goes to the api directly in development (`localhost`, so the session cookie goes).
      env: { NEXT_PUBLIC_RT_URL: "http://localhost:4000" },
      reuseExistingServer: !CI,
      timeout: 180_000,
    },
  ],
});
