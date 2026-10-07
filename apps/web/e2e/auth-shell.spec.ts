/**
 * The shell, end to end: email magic-link sign-in (mailpit) → dashboard (with the status bar) → `GET /v1/me` through
 * the same-origin rewrite is the same user → the sidebar collapses from the top bar's toggle and `[` without re-mounting the page →
 * ⌘K goes to Settings → the theme and the density switch and save → sign out. Every page is also checked with axe
 * (colour contrast included) and for console errors and CSP violations.
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

  // The magic link lands on the dashboard; /v1/me (through the rewrite, with the session cookie) is the same,
  // normalised user, and the shell's account menu names them.
  await signInWithMagicLink(page, email);
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
  const me = MeSchema.parse(await (await page.request.get("/v1/me")).json());
  expect(me.email).toBe(normalised);
  await expect(page.getByRole("button", { name: `Account menu for ${normalised}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: /Connect a broker to see your portfolio/ })).toBeVisible();
  await expect(page.getByRole("contentinfo", { name: "Status bar" })).toBeVisible();
  // The navbar: market status and the notifications bell; no live ticker.
  await expect(page.locator('[data-slot="market-status"]')).toBeVisible();
  await page.getByRole("button", { name: /^Notifications/ }).click();
  const bell = page.getByRole("dialog", { name: "Notifications" });
  await expect(bell).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bell).toBeHidden();

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
  const pageHeader = page.locator('[data-slot="page-header"]').first();
  await pageHeader.evaluate((element) => {
    (element as HTMLElement & { e2eMarker?: string }).e2eMarker = "kept";
  });
  const mainNode = await main.elementHandle();
  await page.locator("body").click({ position: { x: 900, y: 600 } });
  await page.keyboard.press("BracketLeft");
  await expect(sidebar).toHaveCSS("width", "64px");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator('[data-slot="app-content"]')).toHaveCSS("margin-left", "64px");
  await expect(sidebar.getByRole("link", { name: "Charts", exact: true })).toBeVisible(); // still named while collapsed
  expect(await page.evaluate((node) => node === document.getElementById("main-content"), mainNode)).toBe(true);
  expect(await pageHeader.evaluate((element) => (element as HTMLElement & { e2eMarker?: string }).e2eMarker)).toBe(
    "kept",
  );
  // Collapsed survives a reload with no flash: the server renders it from the cookie.
  await page.reload();
  await expect(sidebar).toHaveAttribute("data-collapsed", "true");
  await toggle.click();
  await expect(sidebar).toHaveCSS("width", "256px");

  // The top bar holds the sidebar toggle and the search, and no theme switch any more (it's in Settings).
  const topbar = page.locator('[data-slot="topbar"]');
  await expect(topbar.locator('[data-slot="sidebar-toggle"]')).toBeVisible();
  await expect(topbar.getByRole("button", { name: /^Search sections and actions/ })).toBeVisible();
  await expect(page.getByRole("radiogroup", { name: "Theme" })).toHaveCount(0);

  // ⌘K / Ctrl+K: jump to Settings; the shell (and its <main>) stays.
  const mainBeforeNavigation = await main.elementHandle();
  await page.keyboard.press("ControlOrMeta+KeyK");
  const palette = page.getByRole("dialog", { name: "Command palette" });
  await expect(palette).toBeVisible();
  await page.getByRole("combobox").fill("settings");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { level: 1, name: "Settings" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "Settings", exact: true })).toHaveAttribute("aria-current", "page");
  expect(await page.evaluate((node) => node === document.getElementById("main-content"), mainBeforeNavigation)).toBe(
    true,
  );

  // Theme: Dark applies at once and is saved to the account (PATCH /v1/me/settings through the rewrite, CSRF passes).
  const themeGroup = page.getByRole("radiogroup", { name: "Theme" });
  let saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/me/settings" && response.request().method() === "PATCH",
  );
  await themeGroup.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect((await saved).status()).toBe(200);
  await expect(page.getByText("Saved to your account.", { exact: true })).toBeVisible();
  expect(await axeViolations(page)).toEqual([]);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await themeGroup.getByRole("radio", { name: "Light" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  // Density: Compact tightens the spacing scale at once, is saved, and is server-rendered after a reload (no flash).
  const densityGroup = page.getByRole("radiogroup", { name: "Density" });
  saved = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/v1/me/settings" && response.request().method() === "PATCH",
  );
  await densityGroup.getByRole("radio", { name: "Compact" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  expect((await saved).status()).toBe(200);
  await expect(sidebar).toHaveCSS("width", "224px"); // w-64 at 87.5% spacing
  const html = await (await page.request.get("/settings")).text();
  expect(html).toMatch(/<html[^>]*data-density="compact"/);
  await page.reload();
  await expect(densityGroup.getByRole("radio", { name: "Compact" })).toBeChecked();
  await densityGroup.getByRole("radio", { name: "Comfortable" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  await expect(sidebar).toHaveCSS("width", "256px");

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
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();

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
