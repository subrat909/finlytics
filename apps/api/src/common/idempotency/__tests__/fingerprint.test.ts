import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { canonicalJson, requestFingerprint } from "../fingerprint";

const ORDER = { method: "POST", url: "/v1/orders" };

describe("request fingerprints", () => {
  it("fingerprints bodies regardless of key order", () => {
    const a = { qty: 1, legs: [{ strike: 24000, type: "CE" }], meta: { b: 2, a: 1 } };
    const b = { meta: { a: 1, b: 2 }, legs: [{ type: "CE", strike: 24000 }], qty: 1 };

    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(canonicalJson(a)).toBe('{"legs":[{"strike":24000,"type":"CE"}],"meta":{"a":1,"b":2},"qty":1}');
    expect(requestFingerprint({ ...ORDER, body: a })).toBe(requestFingerprint({ ...ORDER, body: b }));
  });

  it("tells apart bodies, array orders, methods and request targets", () => {
    const base = requestFingerprint({ ...ORDER, body: { legs: [1, 2] } });

    expect(requestFingerprint({ ...ORDER, body: { legs: [2, 1] } })).not.toBe(base);
    expect(requestFingerprint({ ...ORDER, body: { legs: [1, 2], extra: null } })).not.toBe(base);
    expect(requestFingerprint({ ...ORDER, method: "PUT", body: { legs: [1, 2] } })).not.toBe(base);
    expect(requestFingerprint({ ...ORDER, url: "/v1/orders?dry=1", body: { legs: [1, 2] } })).not.toBe(base);
    expect(requestFingerprint({ ...ORDER, method: "post", body: { legs: [1, 2] } })).toBe(base);
    expect(requestFingerprint({ ...ORDER, body: "1" })).not.toBe(requestFingerprint({ ...ORDER, body: 1 }));
  });

  it("keeps no body, null and an empty object apart", () => {
    const fingerprints = [undefined, null, {}, []].map((body) => requestFingerprint({ ...ORDER, body }));

    expect(new Set(fingerprints).size).toBe(4);
    expect(fingerprints[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJson(undefined)).toBe("");
  });

  it("canonicalises any JSON value to text that parses back to it", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        // Object keys are re-ordered, nothing else changes; -0 is JSON's 0.
        expect(JSON.parse(canonicalJson(value))).toEqual(JSON.parse(JSON.stringify(value)));
      }),
    );
  });

  it("ignores undefined members the way JSON does", () => {
    expect(canonicalJson({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalJson([1, undefined])).toBe("[1,null]");
  });
});
