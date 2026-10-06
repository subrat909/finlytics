/**
 * Phase 0.6 demo, end to end: email magic-link sign-in (mailpit) → dashboard → `GET /v1/me` through the same-origin
 * rewrite shows the same user → the sidebar collapses without re-mounting the page → the theme switches and saves →
 * ⌘K navigates → sign out. Every page is also checked with axe (colour contrast included) and for console errors and
 * CSP violations.
 */
import { MeSchema } from "@finlytics/shared";
import { expect, test } from "@playwright/test";

import { axeViolations, collectProblems, hasCssRule, signInWithMagicLink, uniqueEmail } from "./support";

const SESSION_COOKIE = "authjs.session-token";

test("signs in with a magic link, uses the shell, and signs out", async ({ page, context }) => {
  const problems = await collectProblems(page);
  const email = uniqueEmail("shell");
  const normalised = email.toLowerCase();

  // Signed out: a protected page sends you to /login, which passes axe.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in to Finlytics" })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);

  // The magic link lands on the dashboard; /v1/me (through the rewrite) is the same, normalised user.
  const meResponse = page.waitForResponse((response) => new URL(response.url()).pathname === "/v1/me");
  await signInWithMagicLink(page, email);
  const me = MeSchema.parse(await (await meResponse).json());
  expect(me.email).toBe(normalised);
  const accountCard = page.locator('[data-slot="account-card"]');
  await expect(accountCard).toContainText(normalised);
  await expect(accountCard).toHaveAttribute("data-user-id", me.id);
  await expect(page.getByRole("heading", { name: /Connect a broker to see your portfolio/ })).toBeVisible();

  // The session cookie follows the contract (docs/06): HttpOnly, SameSite=Lax, Path=/, no Domain attribute.
  const cookie = (await context.cookies()).find((candidate) => candidate.name === SESSION_COOKIE);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/", domain: "localhost" });
  expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // Light and dark both pass axe with contrast on.
  expect(await axeViolations(page)).toEqual([]);

  // The design system's own classes reach the app's CSS (@source in @finlytics/ui/globals.css).
  expect(await hasCssRule(page, "forced-color-adjust-none")).toBe(true);

  // Sidebar: `[` collapses it to 64 px with a width transition; the page content is the same DOM node throughout.
  const sidebar = page.locator('[data-slot="sidebar"]');
  const toggle = page.locator('[data-slot="sidebar-toggle"]');
  const main = page.locator("main#main-content");
  await expect(sidebar).toHaveCSS("width", "256px");
  await expect(sidebar).toHaveCSS("transition-property", "width");
  await accountCard.evaluate((element) => {
    (element as HTMLElement & { e2eMarker?: string }).e2eMarker = "kept";
  });
  const mainNode = await main.elementHandle();
  await page.locator("body").click({ position: { x: 900, y: 600 } });
  await page.keyboard.press("BracketLeft");
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-slot="app-content"]')).toHaveCSS("margin-left", "64px");
  await expect(page.getByRole("link", { name: "Charts" })).toBeVisible(); // still named while collapsed
  expect(await page.evaluate((node) => node === document.getElementById("main-content"), mainNode)).toBe(true);
  expect(await accountCard.evaluate((element) => (element as HTMLElement & { e2eMarker?: string }).e2eMarker)).toBe(
    "kept",
  );
  // Collapsed survives a reload with no flash: the server renders it from the cookie.
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await toggle.click();
  await expect(sidebar).toHaveCSS("width", "256px");

  // Theme: Dark applies at once and is saved to the account (PATCH /v1/me/settings through the rewrite, CSRF passes).
  const themeGroup = page.getByRole("radiogroup", { name: "Theme" });
  const saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/me/settings" && response.request().method() === "PATCH",
  );
  await themeGroup.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await saved).status()).toBe(200);
  expect(await axeViolations(page)).toEqual([]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await themeGroup.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // ⌘K / Ctrl+K: jump to a section; the shell stays.
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.getByRole("combobox").fill("option chain");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/option-chain$/);
  await expect(page.getByRole("heading", { level: 1, name: "Option Chain" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Option Chain" })).toHaveAttribute("aria-current", "page");

  // Sign out: the session row and cookie are gone; the api answers 401 and the app sends you to /login again.
  await page.getByRole("button", { name: /Account menu for/ }).click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await context.cookies()).some((candidate) => candidate.name === SESSION_COOKIE)).toBe(false);
  expect((await page.request.get("/v1/me")).status()).toBe(401);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fdashboard$/);

  expect(problems.filter((problem) => !problem.includes("401 (Unauthorized)"))).toEqual([]);
});

test("works at 360 px: no horizontal scroll, navigation in a sheet", async ({ page }) => {
  const problems = await collectProblems(page);
  await page.setViewportSize({ width: 360, height: 740 });
  await signInWithMagicLink(page, uniqueEmail("mobile"));
  await expect(page.locator('[data-slot="account-card"]')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBe(0);
  await expect(page.locator('[data-slot="sidebar"]')).toBeHidden();

  await page.getByRole("button", { name: "Open navigation" }).click();
  const sheet = page.getByRole("dialog", { name: "Navigation" });
  await expect(sheet).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await sheet.getByRole("link", { name: "Watchlists" }).click();
  await expect(page).toHaveURL(/\/watchlists$/);
  await expect(sheet).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Watchlists" })).toBeVisible();

  expect(problems).toEqual([]);
});
