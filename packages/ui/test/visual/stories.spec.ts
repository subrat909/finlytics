/**
 * One screenshot per story and theme, taken from the static Storybook build, then axe with colour contrast on.
 * - Themes: `?globals=theme:light|dark` sets the toolbar theme. Stories tagged `visual-single-theme` set
 *   <html data-theme> themselves (ThemeToggle), so they're captured once.
 * - Forced colours: stories tagged `visual-forced-colors` are captured once more with `forced-colors: active` emulated
 *   (Windows contrast themes), after a check that every checked radio still looks different from its unchecked ones.
 * - Sizes: the `desktop` project at 1280 px, and `mobile-360` again for stories tagged `responsive` (@responsive).
 * - Stability: the preview sets body[data-design-checked] after the story has rendered, run its play function and
 *   passed the design checks; fonts are self-hosted and awaited; motion is reduced, animations and the caret off.
 * - Errors: Storybook's afterEach runs even when a play function fails (the failure is only logged), so any console
 *   error or page error fails the test too, and a half-played story can never become a baseline.
 * Update baselines only inside the pinned image: `pnpm test:visual -- --update-snapshots`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import type { AxeResults, RunOptions } from "axe-core";

interface IndexEntry {
  readonly type: "story" | "docs";
  readonly id: string;
  readonly title: string;
  readonly name: string;
  readonly tags?: readonly string[];
}

const STORYBOOK_INDEX = fileURLToPath(new URL("../../storybook-static/index.json", import.meta.url));
const AXE_SCRIPT = createRequire(import.meta.url).resolve("axe-core/axe.min.js");

const index = JSON.parse(readFileSync(STORYBOOK_INDEX, "utf8")) as { entries: Record<string, IndexEntry> };
const stories = Object.values(index.entries).filter((entry) => entry.type === "story");

/** Text that pulls in every font subset the stories use (Latin, ₹, ▲ ▼, en dash and ellipsis). */
const FONT_SAMPLE = "Aa ₹1,234.50 ▲▼ – … 0123456789";

const AXE_OPTIONS: RunOptions = {
  // Stories aren't pages: landmarks are the app's job. Everything else, colour contrast included, stays on.
  rules: { region: { enabled: false } },
};

test.describe.configure({ mode: "parallel" });

/**
 * Opens a story and waits until it has rendered, run its play function and passed the design checks, with its fonts
 * loaded. Fails if the story logged an error: a failed play function is only logged.
 */
async function openStory(page: Page, storyId: string, globals: string): Promise<void> {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  page.on("pageerror", (error) => {
    errors.push(`page error: ${error.message}`);
  });

  await page.goto(`/iframe.html?id=${storyId}&viewMode=story${globals}`);
  await expect(
    page.locator('body[data-design-checked="true"]'),
    "the story rendered, ran its play function and passed the design checks (open it in Storybook to see why not)",
  ).toBeAttached({ timeout: 15_000 });
  expect(errors, "the story logged no errors (a failed play function is only logged)").toEqual([]);
  await page.evaluate(async (sample) => {
    await Promise.all([
      document.fonts.load(`400 16px "Inter Variable"`, sample),
      document.fonts.load(`600 16px "Inter Variable"`, sample),
      document.fonts.load(`400 16px "JetBrains Mono Variable"`, sample),
    ]);
    await document.fonts.ready;
  }, FONT_SAMPLE);
}

/** A screenshot of the story: the whole page for full-screen stories, otherwise the story's root element. */
async function expectStoryScreenshot(page: Page, name: string): Promise<void> {
  const fullscreen = await page.locator("body.sb-main-fullscreen").count();
  if (fullscreen > 0) await expect(page).toHaveScreenshot(name, { fullPage: true });
  else await expect(page.locator("#storybook-root")).toHaveScreenshot(name);
}

interface RadioPaint {
  readonly name: string;
  readonly checked: boolean;
  readonly background: string;
  readonly color: string;
}

/**
 * The colours every radio paints, per radio group: its background composited over its ancestors' (forced colours keep
 * a transparent background transparent, and the emulated Highlight is translucent), and its text colour. Compared as
 * paint, not as computed strings: `rgb(255, 255, 255)` and `rgba(255, 255, 255, 0)` on a white page look the same.
 */
async function radioPaint(page: Page): Promise<RadioPaint[][]> {
  return page.locator('[role="radiogroup"]').evaluateAll((groups) => {
    const channels = (color: string): number[] => (color.match(/[\d.]+/g) ?? []).map(Number);
    const paint = (element: Element | null): number[] => {
      if (!element) return [255, 255, 255];
      const [r = 0, g = 0, b = 0, alpha = 1] = channels(getComputedStyle(element).backgroundColor);
      const below = alpha < 1 ? paint(element.parentElement) : [0, 0, 0];
      return [r, g, b].map((channel, index) => Math.round(channel * alpha + (below[index] ?? 0) * (1 - alpha)));
    };
    return groups.map((group) =>
      [...group.querySelectorAll('[role="radio"]')].map((radio) => {
        const [r = 0, g = 0, b = 0] = channels(getComputedStyle(radio).color);
        return {
          name: radio.getAttribute("aria-label") ?? radio.textContent.trim(),
          checked: radio.getAttribute("aria-checked") === "true",
          background: `rgb(${paint(radio).join(", ")})`,
          color: `rgb(${[r, g, b].join(", ")})`,
        };
      }),
    );
  });
}

for (const story of stories) {
  const tags = story.tags ?? [];
  const themes = tags.includes("visual-single-theme") ? ["single"] : ["light", "dark"];

  for (const theme of themes) {
    test(`${story.id} ${theme}`, { tag: tags.includes("responsive") ? ["@responsive"] : [] }, async ({ page }) => {
      await openStory(page, story.id, theme === "single" ? "" : `&globals=theme:${theme}`);
      await expectStoryScreenshot(page, `${story.id}-${theme}.png`);

      await page.addScriptTag({ path: AXE_SCRIPT });
      const results = await page.evaluate(async (options) => {
        const { axe } = globalThis as unknown as {
          axe: { run: (context: Element, options: unknown) => Promise<AxeResults> };
        };
        const root = document.querySelector("#storybook-root") ?? document.body;
        return axe.run(root, options);
      }, AXE_OPTIONS);
      expect(
        results.violations.map(
          (violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
        ),
      ).toEqual([]);
    });
  }

  if (tags.includes("visual-forced-colors")) {
    // Forced colours replace author colours with the system palette, so a state shown only by a token fill (a checked
    // radio filled primary) disappears. No axe run here: contrast is the user's palette's business.
    test(`${story.id} forced-colors`, async ({ page }) => {
      await page.emulateMedia({ forcedColors: "active" });
      await openStory(page, story.id, "");
      expect(await page.evaluate(() => matchMedia("(forced-colors: active)").matches)).toBe(true);

      const groups = await radioPaint(page);
      expect(groups.length, "the story renders a radio group").toBeGreaterThan(0);
      for (const radios of groups) {
        const [checked, ...others] = radios.filter((radio) => radio.checked);
        expect(checked, "a radio is checked").toBeDefined();
        expect(others, "only one radio is checked").toEqual([]);
        for (const radio of radios.filter((candidate) => !candidate.checked)) {
          expect(radio.background, `"${radio.name}" is filled unlike the checked "${checked?.name ?? ""}"`).not.toBe(
            checked?.background,
          );
          expect(radio.color, `"${radio.name}" is coloured unlike the checked "${checked?.name ?? ""}"`).not.toBe(
            checked?.color,
          );
        }
      }

      await expectStoryScreenshot(page, `${story.id}-forced-colors.png`);
    });
  }
}
