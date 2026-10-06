/**
 * OpenAPI at /docs (plan D12, US9): the document lists every route with the shared conventions, Swagger UI gets its
 * own CSP, and in production neither exists.
 */
import { PROBLEM_JSON_MEDIA_TYPE, ProblemDetailsSchema } from "@finlytics/shared";
import { describe, expect, it } from "vitest";

import { DOCS_CSP } from "../../src/bootstrap/openapi";

import { createTestApp, json, PRODUCTION_ENV } from "./app";

interface Operation {
  readonly security?: unknown[];
  readonly responses: Record<
    string,
    { headers?: Record<string, unknown>; content?: Record<string, { schema?: { $ref?: string } }> }
  >;
  readonly parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
  readonly requestBody?: { content: Record<string, { schema: { $ref: string } }> };
}

interface Document {
  readonly openapi: string;
  readonly security: unknown[];
  readonly paths: Record<string, Record<string, Operation>>;
  readonly components: { securitySchemes: Record<string, unknown>; schemas: Record<string, Record<string, unknown>> };
}

const PROBLEM_REF = "#/components/schemas/ProblemDetailsDto";
const STRICT_API_CSP = "default-src 'none';frame-ancestors 'none';base-uri 'none';form-action 'none'";

describe("OpenAPI", () => {
  it("documents every route with ProblemDetails as the default response and the session cookie scheme", async () => {
    const { app, request, close } = await createTestApp({}, { listen: true });
    const routes = new Set<string>();
    app
      .getHttpAdapter()
      .getInstance()
      .addHook("onRoute", (route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) routes.add(`${method} ${route.url}`);
      });
    try {
      await app.init();
      const response = await request({ method: "GET", url: "/docs/json" });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      const document = json(response) as unknown as Document;
      expect(document.openapi).toBe("3.1.0");

      // Every route Nest serves is documented (Fastify's HEAD twins, CORS preflight and the docs themselves aside).
      const served = [...routes].filter(
        (route) => !route.startsWith("HEAD ") && route !== "OPTIONS *" && !/^[A-Z]+ \/docs/.test(route),
      );
      const documented = Object.entries(document.paths).flatMap(([path, item]) =>
        Object.keys(item).map((method) => `${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`),
      );
      expect(served.length).toBeGreaterThan(5);
      expect(new Set(documented)).toEqual(new Set(served));
      expect(documented).toEqual(
        expect.arrayContaining(["GET /health/live", "GET /health/ready", "GET /v1/me", "GET /v1/me/settings"]),
      );
      expect(documented).toContain("PATCH /v1/me/settings");

      // The session cookie everywhere, except public routes.
      expect(document.components.securitySchemes["session"]).toEqual({
        type: "apiKey",
        in: "cookie",
        name: "authjs.session-token",
        description: expect.any(String) as string,
      });
      expect(document.security).toEqual([{ session: [] }]);
      for (const [path, item] of Object.entries(document.paths)) {
        for (const [method, operation] of Object.entries(item)) {
          const where = `${method} ${path}`;
          const isPublic = path.startsWith("/health/") || /^\/v1\/__test__\/(slow|boom|db|bigint|guarded)/.test(path);
          if (isPublic) expect(operation.security, where).toEqual([]);
          else expect(operation.security, where).toBeUndefined();
          expect(operation.responses["default"]?.content?.[PROBLEM_JSON_MEDIA_TYPE]?.schema?.$ref, where).toBe(
            PROBLEM_REF,
          );
          for (const [status, documentedResponse] of Object.entries(operation.responses)) {
            expect(documentedResponse.headers, `${where} ${status}`).toHaveProperty("x-request-id");
          }
        }
      }
      expect(response.body).not.toContain("x-finlytics-public");

      // The problem schema is the strict shared contract.
      const problem = document.components.schemas["ProblemDetailsDto"];
      expect(problem?.["additionalProperties"]).toBe(false);
      expect(problem?.["required"]).toEqual(["type", "title", "status", "code", "requestId"]);

      // @Idempotent() documents its header; the settings patch documents its strict body.
      const idempotent = document.paths["/v1/__test__/idempotent"]?.["post"];
      expect(idempotent?.parameters).toEqual([
        expect.objectContaining({
          name: "idempotency-key",
          in: "header",
          required: true,
          schema: { type: "string", pattern: "^[A-Za-z0-9_-]{16,128}$" },
        }),
      ]);
      const patch = document.paths["/v1/me/settings"]?.["patch"];
      expect(patch?.requestBody?.content["application/json"]?.schema.$ref).toBe(
        "#/components/schemas/UserSettingsPatchDto",
      );
      expect(document.components.schemas["UserSettingsPatchDto"]?.["additionalProperties"]).toBe(false);
    } finally {
      await close();
    }
  });

  it("serves Swagger UI at /docs under its own CSP, keeps the strict CSP elsewhere, and serves no YAML", async () => {
    const { request, close } = await createTestApp();
    try {
      const page = await request({ method: "GET", url: "/docs" });
      const bundle = await request({ method: "GET", url: "/docs/swagger-ui-bundle.js" });
      const api = await request({ method: "GET", url: "/health/live" });
      const yaml = await request({ method: "GET", url: "/docs-yaml" });

      expect(page.statusCode).toBe(200);
      expect(page.headers["content-type"]).toMatch(/^text\/html/);
      expect(page.body).toContain("swagger-ui-init.js");
      expect(page.headers["content-security-policy"]).toBe(DOCS_CSP);
      expect(page.headers["x-frame-options"]).toBe("DENY");
      expect(bundle.statusCode).toBe(200);
      expect(bundle.headers["content-security-policy"]).toBe(DOCS_CSP);
      expect(DOCS_CSP).not.toMatch(/unsafe-eval|\*/);
      expect(api.headers["content-security-policy"]).toBe(STRICT_API_CSP);
      expect(yaml.statusCode).toBe(404);
    } finally {
      await close();
    }
  });

  it("answers 404 for /docs and /docs/json in production mode", async () => {
    const { request, close } = await createTestApp({ ...PRODUCTION_ENV });
    try {
      for (const url of ["/docs", "/docs/", "/docs/json", "/docs/swagger-ui-init.js", "/docs/swagger-ui.css"]) {
        const response = await request({ method: "GET", url });

        expect(response.statusCode, url).toBe(404);
        expect(ProblemDetailsSchema.parse(json(response)).code, url).toBe("NOT_FOUND");
      }
    } finally {
      await close();
    }
  });
});
