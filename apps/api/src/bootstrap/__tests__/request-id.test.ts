import { describe, expect, it } from "vitest";

import { clientRequestId, clientRequestIdFrom, genReqId } from "../request-id";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("request ids", () => {
  it("generates every request id on the server, a new UUID each time", () => {
    const ids = new Set(Array.from({ length: 50 }, () => genReqId()));

    expect(ids.size).toBe(50);
    for (const id of ids) expect(id).toMatch(UUID);
  });

  it("keeps a well-formed inbound x-request-id as the client's correlation id", () => {
    for (const id of ["req-12345678", "3f2b8c1e-5d3a-4c2b-9e7f-0a1b2c3d4e5f", "a".repeat(128), "Trace.ID_01"]) {
      expect(clientRequestIdFrom(id)).toBe(id);
    }
    expect(clientRequestId({ headers: { "x-request-id": "edge-req-0001" } })).toBe("edge-req-0001");
  });

  it("drops a malformed, oversized or repeated x-request-id", () => {
    for (const id of [
      undefined,
      "",
      "short",
      "a".repeat(129),
      "has space 123",
      "line\nbreak123",
      "-leading-dash",
      ["a1234567", "b1234567"],
    ]) {
      expect(clientRequestIdFrom(id), String(id)).toBeUndefined();
    }
    expect(clientRequestId({ headers: {} })).toBeUndefined();
  });
});
