import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createNonce } from "../csp";

describe("createNonce", () => {
  it("returns 128 random bits as base64, different every time", () => {
    const nonce = createNonce();
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(createNonce()).not.toBe(nonce);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("allows scripts and style elements only with the nonce in production", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc", dev: false });
    const directives = Object.fromEntries(
      policy.split("; ").map((directive) => {
        const [name = "", ...values] = directive.split(" ");
        return [name, values.join(" ")];
      }),
    );
    expect(directives).toMatchObject({
      "default-src": "'self'",
      "script-src": "'self' 'nonce-abc' 'strict-dynamic'",
      "style-src": "'self' 'nonce-abc'",
      "style-src-attr": "'unsafe-inline'",
      "object-src": "'none'",
      "base-uri": "'none'",
      "frame-ancestors": "'none'",
      "connect-src": "'self'",
    });
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("unsafe-eval");
  });

  it("adds 'unsafe-eval' and skips the https upgrade in development", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc", dev: true });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic' 'unsafe-eval'");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });
});
