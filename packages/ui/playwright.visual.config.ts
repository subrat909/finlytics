import { defineConfig } from "@playwright/test";

/**
 * Visual regression (plan D15, PR8): every story in light and dark, plus 360 px for the `responsive` ones and forced
 * colours for the `visual-forced-colors` ones, against committed baselines. Run it through `pnpm test:visual`
 * (scripts/visual.mjs), which runs it inside the pinned Playwright image: baselines are only valid in that one Linux
 * environment. The `motion` project takes no screenshots: it checks the skeleton shimmer with motion allowed.
 */
const PORT = 6007;
const isCI = Boolean(process.env["CI"]);

export default defineConfig({
  testDir: "test/visual",
  testMatch: "**/*.spec.ts",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: 0,
  reporter: isCI ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]] : [["list"]],
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Exact colours: baselines and runs share one pinned environment, and Playwright's default per-pixel threshold
      // (0.2 in YIQ) would pass a one-step token change such as #4f46e5 → #4338ca. The ratio below is the allowance.
      threshold: 0,
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${String(PORT)}`,
    browserName: "chromium",
    colorScheme: "light",
    deviceScaleFactor: 1,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    reducedMotion: "reduce",
  },
  projects: [
    { name: "desktop", testMatch: "stories.spec.ts", use: { viewport: { width: 1280, height: 800 } } },
    {
      name: "mobile-360",
      testMatch: "stories.spec.ts",
      grep: /@responsive/,
      use: { viewport: { width: 360, height: 780 } },
    },
    // Motion allowed, so the shimmer runs (the screenshot projects reduce motion for stable pixels).
    {
      name: "motion",
      testMatch: "motion.spec.ts",
      use: { viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" },
    },
  ],
  webServer: {
    command: `node test/visual/serve.mjs ${String(PORT)}`,
    url: `http://127.0.0.1:${String(PORT)}/index.json`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
