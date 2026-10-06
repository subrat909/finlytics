import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:8025";
const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");

/** A unique, deliberately mixed-case address; the app must store and show it lowercased. */
export function uniqueEmail(prefix: string): string {
  return `E2E.${prefix}.${String(Date.now())}${String(Math.floor(Math.random() * 1e6))}@Finlytics.Test`;
}

interface MailpitSearch {
  messages?: { ID: string }[];
}

interface MailpitMessage {
  Text?: string;
}

/** Polls mailpit's API for the newest message to `email` and returns the magic link in it. */
export async function readMagicLink(email: string): Promise<string> {
  const query = encodeURIComponent(`to:"${email}"`);
  let link: string | undefined;
  await expect
    .poll(
      async () => {
        const search = (await (
          await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=1`)
        ).json()) as MailpitSearch;
        const id = search.messages?.[0]?.ID;
        if (id === undefined) return undefined;
        const message = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as MailpitMessage;
        link = /https?:\/\/\S+\/api\/auth\/callback\/email\?\S+/.exec(message.Text ?? "")?.[0];
        return link;
      },
      { message: `a magic link for ${email} in mailpit`, timeout: 20_000 },
    )
    .toBeDefined();
  return link ?? "";
}

/** Signs in through the email magic link and lands on `expectedPath`. */
export async function signInWithMagicLink(page: Page, email: string, startPath = "/dashboard"): Promise<void> {
  await page.goto(startPath);
  await expect(page).toHaveURL(/\/login\?callbackUrl=/);
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page).toHaveURL(/\/verify/);
  await expect(page.getByRole("heading", { level: 1, name: "Check your email" })).toBeAttached();
  await page.goto(await readMagicLink(email.toLowerCase()));
  await expect(page).toHaveURL(new RegExp(`${startPath}$`));
}

/**
 * Console errors, uncaught exceptions and CSP violations, collected for a final assertion. CSP violations come from
 * `securitypolicyviolation` events (they carry the source file), reported through a binding rather than the console,
 * which Next.js 16 forwards to the dev server's terminal. The only ones ignored come from Next.js's development overlay
 * (next-devtools), which injects unnonced styles and doesn't exist in production builds.
 */
export async function collectProblems(page: Page): Promise<string[]> {
  const problems: string[] = [];
  await page.exposeBinding("__e2eReportCsp", (_source, report: string) => {
    if (!report.includes("next-devtools")) problems.push(`csp-violation: ${report}`);
  });
  await page.addInitScript(() => {
    const scope = window as unknown as { __e2eAxeRunning?: boolean; __e2eReportCsp: (report: string) => void };
    document.addEventListener("securitypolicyviolation", (event) => {
      // axe-core (test tooling, evaluated by axeViolations) inserts unnonced styles while it measures.
      if (scope.__e2eAxeRunning) return;
      const target = event.target instanceof Element ? event.target.outerHTML.slice(0, 120) : "";
      scope.__e2eReportCsp(
        `${event.effectiveDirective} from ${event.sourceFile || "(inline)"}:${String(event.lineNumber)} ${target}`,
      );
    });
  });
  page.on("console", (message) => {
    // The browser's own CSP messages duplicate the events above, without the source.
    if (message.type() === "error" && !message.text().includes("Content Security Policy")) {
      problems.push(`console: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return problems;
}

interface AxeViolation {
  id: string;
  impact: string | null;
  nodes: { target: string[] }[];
}

/** axe-core in the real page (colour contrast included). Evaluated, not injected, so the CSP doesn't block it. */
export async function axeViolations(page: Page): Promise<string[]> {
  await page.evaluate(AXE_SOURCE);
  const violations = await page.evaluate(async () => {
    const scope = window as unknown as {
      axe: { run: (context: Document) => Promise<{ violations: unknown[] }> };
      __e2eAxeRunning?: boolean;
    };
    scope.__e2eAxeRunning = true;
    try {
      return (await scope.axe.run(document)).violations;
    } finally {
      // CSP violation events are dispatched asynchronously: let axe's settle before listening again.
      await new Promise((resolve) => setTimeout(resolve, 50));
      scope.__e2eAxeRunning = false;
    }
  });
  return (violations as AxeViolation[]).map(
    (violation) =>
      `${violation.id} (${String(violation.impact)}): ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`,
  );
}

/** Whether any stylesheet has a rule whose selector contains `fragment` (nested @media rules included). */
export async function hasCssRule(page: Page, fragment: string): Promise<boolean> {
  return page.evaluate((needle) => {
    const visit = (rules: CSSRuleList): boolean =>
      Array.from(rules).some((rule) => {
        if (rule instanceof CSSStyleRule && rule.selectorText.includes(needle)) return true;
        return "cssRules" in rule && rule.cssRules instanceof CSSRuleList ? visit(rule.cssRules) : false;
      });
    return Array.from(document.styleSheets).some((sheet) => {
      try {
        return visit(sheet.cssRules);
      } catch {
        return false;
      }
    });
  }, fragment);
}
