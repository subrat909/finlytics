import type { OpenAPIObject } from "@nestjs/swagger";
import { describe, expect, it } from "vitest";

import { documentConventions, DOCS_CSP, isDocsPath } from "../openapi";

const REF = "#/components/schemas/ProblemDetailsDto";

function document(): OpenAPIObject {
  return {
    openapi: "3.1.0",
    info: { title: "t", version: "v1" },
    paths: {
      "/health/live": {
        get: { responses: { "200": { description: "ok" } }, "x-finlytics-public": true } as never,
      },
      "/v1/me": {
        get: { responses: { "200": { description: "me", headers: { etag: { schema: { type: "string" } } } } } },
        parameters: [],
      },
    },
  };
}

describe("OpenAPI conventions", () => {
  it("adds the problem default response and x-request-id to every response, keeping existing headers", () => {
    const result = documentConventions(document(), REF);
    const me = result.paths["/v1/me"]?.get;

    expect(me?.responses["default"]).toEqual({
      description: expect.any(String) as string,
      content: { "application/problem+json": { schema: { $ref: REF } } },
      headers: { "x-request-id": expect.any(Object) as object },
    });
    const ok = me?.responses["200"] as { headers?: Record<string, unknown> } | undefined;
    expect(Object.keys(ok?.headers ?? {})).toEqual(["etag", "x-request-id"]);
    expect(me?.security).toBeUndefined();
  });

  it("turns the @Public() marker into security: [] and removes it", () => {
    const live = documentConventions(document(), REF).paths["/health/live"]?.get;

    expect(live?.security).toEqual([]);
    expect(live).not.toHaveProperty("x-finlytics-public");
  });

  it("recognises the docs paths only", () => {
    expect(["/docs", "/docs/", "/docs/json", "/docs/swagger-ui.css?v=1"].map(isDocsPath)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(["/docsx", "/v1/docs", "/", "/health/live"].map(isDocsPath)).toEqual([false, false, false, false]);
  });

  it("keeps the docs CSP to what Swagger UI needs", () => {
    expect(DOCS_CSP).toContain("default-src 'none'");
    expect(DOCS_CSP).toContain("frame-ancestors 'none'");
    expect(DOCS_CSP).not.toMatch(/unsafe-eval|\*|https?:/);
  });
});
