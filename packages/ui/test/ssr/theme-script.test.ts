/**
 * ThemeProvider on a real server (Node, no window): the pre-paint script must be executable, carry the CSP nonce and
 * stay out of Cloudflare Rocket Loader's reach. The jsdom tests can't see this, because jsdom has a window.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ThemeProvider } from "../../src/components/theme-provider";

describe("ThemeProvider on the server", () => {
  it("renders an executable pre-paint script with the nonce, kept from Rocket Loader", () => {
    const html = renderToString(
      createElement(ThemeProvider, { defaultTheme: "dark", nonce: "nonce-123", children: createElement("main") }),
    );
    const script = /<script\b[^>]*>/.exec(html)?.[0] ?? "";

    expect(script).toContain('data-cfasync="false"');
    expect(script).toContain('nonce="nonce-123"');
    expect(script).not.toMatch(/\btype=/);
    expect(html).toContain("finlytics-theme");
    expect(html).toContain("data-theme");
  });

  it("renders no nonce attribute when none is given", () => {
    const html = renderToString(createElement(ThemeProvider, { children: createElement("main") }));

    expect(/<script\b[^>]*>/.exec(html)?.[0]).not.toContain("nonce=");
  });
});
