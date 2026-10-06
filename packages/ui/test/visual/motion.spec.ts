/**
 * The skeleton shimmer, with motion allowed: the `motion` project (playwright.visual.config.ts). The screenshot projects
 * emulate reduced motion, where the shimmer never runs, so only this project sees it.
 *
 * A tinted skeleton (surface-3 on a surface-2 row: the option chain's ATM row, the table header) must keep its tint at
 * every point of the animation. The shimmer is a translucent band over the skeleton's own background; an opaque
 * gradient (as it once was, surface-2 to surface-3) repaints most of the skeleton in its row's colour.
 *
 * Pixels, not computed styles: the test pauses every animation at points across one cycle, takes a screenshot, decodes
 * it in the page (a canvas), and compares each tinted skeleton's centre line with its row's background.
 */
import { expect, test } from "@playwright/test";

const STORIES = ["components-pageloader--chain", "components-pageloader--table"];
const THEMES = ["light", "dark"];

/** The shimmer's cycle (theme.css, --animate-shimmer) and how many evenly spaced points of it are checked. */
const CYCLE_MS = 1600;
const PHASES = 8;

/** Skip this many pixels at each end of a skeleton: its rounded ends blend into the row. */
const END_INSET = 4;

interface Region {
  /** The skeleton's centre line: y, and x from x0 to x1 inclusive. */
  readonly y: number;
  readonly x0: number;
  readonly x1: number;
  /** A pixel of the row's own background, in its left padding at the same height. */
  readonly rowX: number;
}

test.describe.configure({ mode: "parallel" });

for (const storyId of STORIES) {
  for (const theme of THEMES) {
    test(`${storyId} ${theme}: tinted skeletons keep their tint under the shimmer`, async ({ page }) => {
      await page.goto(`/iframe.html?id=${storyId}&viewMode=story&globals=theme:${theme}`);
      await expect(page.locator('body[data-design-checked="true"]')).toBeAttached({ timeout: 15_000 });

      const tinted = page.locator('[data-slot="skeleton"].bg-surface-3');
      await expect(tinted.first()).toBeVisible();
      expect(
        await tinted.first().evaluate((skeleton) => getComputedStyle(skeleton).animationName),
        "motion is allowed in this project, so the shimmer runs",
      ).toBe("shimmer");

      const regions: Region[] = await tinted.evaluateAll(
        (skeletons, inset) =>
          skeletons.flatMap((skeleton) => {
            // The row: the nearest ancestor that paints a background.
            let row = skeleton.parentElement;
            while (row && getComputedStyle(row).backgroundColor === "rgba(0, 0, 0, 0)") row = row.parentElement;
            const box = skeleton.getBoundingClientRect();
            if (!row || box.width <= 4 * inset || box.top < 0 || box.bottom > window.innerHeight) return [];
            return [
              {
                y: Math.round(box.top + box.height / 2),
                x0: Math.ceil(box.left + inset),
                x1: Math.floor(box.right - inset),
                rowX: Math.round(row.getBoundingClientRect().left + inset),
              },
            ];
          }),
        END_INSET,
      );
      expect(regions.length, "tinted skeletons in the viewport").toBeGreaterThan(0);

      for (let phase = 0; phase < PHASES; phase += 1) {
        const time = (CYCLE_MS / PHASES) * phase;
        await page.evaluate(async (currentTime) => {
          for (const animation of document.getAnimations()) {
            animation.pause();
            animation.currentTime = currentTime;
          }
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }, time);
        const png = (await page.screenshot({ animations: "allow" })).toString("base64");

        const matchingRow = await page.evaluate(
          async ({ screenshot, lines }) => {
            const image = new Image();
            image.src = `data:image/png;base64,${screenshot}`;
            await image.decode();
            const canvas = document.createElement("canvas");
            canvas.width = image.width;
            canvas.height = image.height;
            const context = canvas.getContext("2d", { willReadFrequently: true });
            if (!context) throw new Error("no 2d canvas context");
            context.drawImage(image, 0, 0);

            return lines.flatMap(({ y, x0, x1, rowX }) => {
              const [r, g, b] = context.getImageData(rowX, y, 1, 1).data;
              const line = context.getImageData(x0, y, x1 - x0 + 1, 1).data;
              let same = 0;
              for (let offset = 0; offset < line.length; offset += 4) {
                if (line[offset] === r && line[offset + 1] === g && line[offset + 2] === b) same += 1;
              }
              const rgb = `rgb(${String(r)}, ${String(g)}, ${String(b)})`;
              return same > 0 ? [`skeleton at y=${String(y)}: ${String(same)} pixels in the row's colour ${rgb}`] : [];
            });
          },
          { screenshot: png, lines: regions },
        );
        expect(matchingRow, `${String(time)} ms into the shimmer`).toEqual([]);
      }
    });
  }
}
