import { describe, expect, it } from "vitest";

import { redactSecrets } from "../redact";

describe("redactSecrets", () => {
  it("removes the call's own secret values, longest first", () => {
    expect(redactSecrets("token abcdef123 and abcdef123456 here", ["abcdef123", "abcdef123456"])).toBe(
      "token [REDACTED] and [REDACTED] here",
    );
  });

  it("ignores secret values too short to search for", () => {
    expect(redactSecrets("id 12345 seen", ["12345"])).toBe("id 12345 seen");
  });

  it("removes token-shaped text it wasn't told about", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl";
    expect(redactSecrets(`Authorization: Bearer ${jwt}`)).toBe("Authorization: Bearer [REDACTED]");
    expect(redactSecrets(`got ${jwt} back`)).toBe("got [REDACTED] back");
    expect(redactSecrets("Basic dXNlcjpwYXNzd29yZA==")).toBe("Basic [REDACTED]");
    expect(redactSecrets("url?access_token=abc123&x=1")).toBe("url?access_token=[REDACTED]&x=1");
    expect(redactSecrets('{"accessToken": "zzz", "refresh_token":"yyy"}')).toBe(
      '{"accessToken": "[REDACTED]", "refresh_token":"[REDACTED]"}',
    );
    expect(redactSecrets("client_secret=s3cr3t; api-key: k3y")).toBe("client_secret=[REDACTED]; api-key: [REDACTED]");
  });

  it("keeps broker error codes and ordinary text", () => {
    expect(redactSecrets('{"errorCode":"UDAPI100050","message":"Invalid token used"}')).toBe(
      '{"errorCode":"UDAPI100050","message":"Invalid token used"}',
    );
  });

  it("makes one line without control or bidirectional characters", () => {
    expect(redactSecrets("a\r\nb\tc‮d\u0000")).toBe("a b c d");
  });

  it("truncates to the limit without splitting a surrogate pair", () => {
    expect(redactSecrets("abcdef", [], 4)).toBe("abc…");
    expect(redactSecrets("ab😀cd", [], 4)).toBe("ab…");
    expect(redactSecrets("x".repeat(600))).toHaveLength(500);
  });
});
