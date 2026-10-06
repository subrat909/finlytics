/**
 * Phase 1 market data, end to end (plan 1.4–1.6): a watchlist gets an instrument from the search, its price moves with
 * the paper feed over the realtime socket, its chart renders on a canvas; and the brokers page validates the Dhan
 * form. Needs the api with `APP_ROLE=http,gateway,feed,worker` and the paper feed always on (playwright.config.ts),
 * and the dev instrument seed (`pnpm db:seed`). Every page is checked with axe and for console errors and CSP
 * violations (the socket's origin must be in `connect-src`).
 */
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { axeViolations, collectProblems, signInWithMagicLink, uniqueEmail } from "./support";

/** A new user may start with no watchlist: create one, then return the search for the open list. */
async function openWatchlist(page: Page) {
  const tabs = page.getByRole("tablist", { name: "Watchlists" });
  const empty = page.getByRole("heading", { name: /Create your first watchlist/ });
  await expect(tabs.or(empty)).toBeVisible();
  if (await empty.isVisible()) {
    await page.getByRole("button", { name: "New watchlist" }).click();
    const dialog = page.getByRole("dialog", { name: "New watchlist" });
    await dialog.getByLabel("Name").fill("E2E");
    await dialog.getByRole("button", { name: "Create watchlist" }).click();
    await expect(dialog).toBeHidden();
  }
  await expect(tabs).toBeVisible();
  return page.getByRole("combobox", { name: /^Add to / });
}

test("adds an instrument to a watchlist, sees its price move live, and opens its chart", async ({ page }) => {
  const problems = await collectProblems(page);
  await signInWithMagicLink(page, uniqueEmail("watchlist"), "/watchlists");
  await expect(page.getByRole("heading", { level: 1, name: "Watchlists" })).toBeVisible();

  // Search the instrument master (dev seed) and add the first match with the keyboard.
  const search = await openWatchlist(page);
  await search.fill("NIFTY");
  const firstOption = page.getByRole("option").first();
  await expect(firstOption).toBeVisible();
  const added = page.waitForResponse(
    (response) =>
      /\/v1\/watchlists\/[^/]+\/items$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST",
  );
  // The first result is active as the list opens; ArrowDown/ArrowUp move, Enter picks.
  await search.press("ArrowDown");
  await search.press("ArrowUp");
  await expect(search).toHaveAttribute("aria-activedescendant", (await firstOption.getAttribute("id")) ?? "");
  await search.press("Enter");
  expect((await added).status()).toBeLessThan(300);

  // The row shows a price, then the paper feed moves it over the socket (no reload, no polling).
  const row = page.locator('[data-slot="watchlist-row"]').first();
  const price = row.locator('[data-slot="price-cell-value"]');
  await expect(price).toHaveText(/\d/, { timeout: 20_000 });
  await expect(page.locator('[data-slot="feed-status"]')).toContainText("Live", { timeout: 20_000 });
  const first = await price.textContent();
  await expect
    .poll(async () => price.textContent(), { timeout: 20_000, message: "the price changes live" })
    .not.toBe(first);
  await expect(row.locator('[data-slot="price-cell"]')).toHaveAttribute("data-direction", /up|down|flat/);
  expect(await axeViolations(page)).toEqual([]);

  // At 360 px the rows are cards and nothing scrolls sideways.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.reload();
  await expect(row.locator('[data-slot="price-cell-value"]')).toHaveText(/\d/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0,
  );
  await page.setViewportSize({ width: 1280, height: 720 });

  // The symbol opens its chart: Lightweight Charts draws on canvases.
  await row.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/charts\?key=/);
  const chart = page.locator('[data-slot="lightweight-chart"]');
  await expect(chart.locator("canvas").first()).toBeVisible({ timeout: 20_000 });
  const box = await chart.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThan(200);
  await page.getByRole("radio", { name: "15 minutes" }).click();
  await expect(page).toHaveURL(/tf=M15/);
  await expect(chart.locator("canvas").first()).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  expect(problems).toEqual([]);
});

test("the brokers page explains an empty Dhan access token", async ({ page }) => {
  const problems = await collectProblems(page);
  await signInWithMagicLink(page, uniqueEmail("brokers"), "/brokers");
  await expect(page.getByRole("heading", { level: 1, name: "Brokers" })).toBeVisible();

  await page.getByRole("button", { name: "Add a broker" }).first().click();
  await page.getByRole("dialog", { name: "Add a broker" }).getByRole("button", { name: /Dhan/ }).click();
  const dialog = page.getByRole("dialog", { name: "Connect Dhan" });
  await dialog.getByLabel("Client ID").fill("1000012345");
  await dialog.getByRole("button", { name: "Connect Dhan" }).click();

  const token = dialog.getByLabel("Access token");
  await expect(dialog.getByText("Paste the access token from the Dhan dashboard")).toBeVisible();
  await expect(token).toHaveAttribute("aria-invalid", "true");
  await expect(token).toHaveAccessibleDescription(/Paste the access token from the Dhan dashboard/);
  expect(await axeViolations(page)).toEqual([]);

  // Escape closes the wizard and returns focus to the button that opened it.
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Add a broker" }).first()).toBeFocused();

  expect(problems).toEqual([]);
});
