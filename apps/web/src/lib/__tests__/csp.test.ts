import { describe, expect, it } from "vitest";

import { buildContentSecurityPolicy, createNonce, socketSources } from "../csp";

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

describe("realtime sources", () => {
  it("allows the realtime origin and its WebSocket twin in connect-src", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc", dev: true, realtimeOrigin: "http://localhost:4000" });
    expect(policy).toContain("connect-src 'self' http://localhost:4000 ws://localhost:4000;");
    expect(socketSources("https://rt.example.com")).toEqual(["https://rt.example.com", "wss://rt.example.com"]);
  });

  it("stays same origin without one, and never writes a malformed value into the policy", () => {
    expect(buildContentSecurityPolicy({ nonce: "abc", dev: false })).toContain("connect-src 'self';");
    expect(socketSources(undefined)).toEqual([]);
    expect(socketSources("not a url; script-src *")).toEqual([]);
    expect(socketSources("javascript:alert(1)")).toEqual([]);
    expect(socketSources("https://rt.example.com/path")).toEqual([]);
  });
});
