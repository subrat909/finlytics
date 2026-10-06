/**
 * OpenAPI (plan D12, US9): Swagger UI at `/docs` and the OpenAPI 3.1 document at `/docs/json`, only when
 * API_DOCS_ENABLED. Production never sets it (the environment schema rejects `true` there), so in production the
 * routes don't exist at all: an unauthenticated schema endpoint would map the attack surface for anyone.
 *
 * - One source for the contract: nestjs-zod DTOs (createZodDto over @finlytics/shared schemas) drive validation,
 *   serialization and these docs; `cleanupOpenApiDoc` turns them into OpenAPI 3.1 schemas.
 * - Built lazily, on the first request for it, then cached.
 * - Every operation documents `default` → `application/problem+json` (ProblemDetails) and the `x-request-id` header on
 *   every response, and needs the `session` cookie unless the route is `@Public()` (`security: []`).
 * - JSON only. @nestjs/swagger would serve a YAML copy through js-yaml's `dump`; it isn't registered, so nothing here
 *   parses or emits YAML (docs/06 "Dependency audit exceptions" notes js-yaml).
 * - CSP: Swagger UI loads its own scripts and styles, uses inline styles and data: images; `/docs*` responses get that
 *   policy, every other response keeps the strict API policy (bootstrap/http-hardening.ts).
 */
import { HEADERS, ProblemDetailsSchema, PROBLEM_JSON_MEDIA_TYPE, SESSION_COOKIE_NAME } from "@finlytics/shared";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, getSchemaPath, SwaggerModule } from "@nestjs/swagger";
import type { OpenAPIObject } from "@nestjs/swagger";
import { cleanupOpenApiDoc, createZodDto } from "nestjs-zod";

import { PUBLIC_OPERATION_EXTENSION } from "../common/decorators/public";
import type { Env } from "../config/env.schema";

/** Where the docs live; outside `/v1`, like `/health`. */
export const DOCS_PATH = "docs";

/** Swagger UI's needs, and nothing more: its own files, inline styles, data: images, same-origin "try it out". */
export const DOCS_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/** The session cookie's security scheme name in the document. */
export const SESSION_SECURITY_SCHEME = "session";

/** RFC 9457 problems, documented once and referenced by every operation's `default` response. */
export class ProblemDetailsDto extends createZodDto(ProblemDetailsSchema) {}

const HTTP_METHODS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;

/** Whether a request target is part of the docs (`/docs`, `/docs/…`). */
export function isDocsPath(url: string): boolean {
  const path = url.split(/[?#]/, 1)[0] ?? "";
  return path === `/${DOCS_PATH}` || path.startsWith(`/${DOCS_PATH}/`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Adds what every operation shares: the `default` problem response, the `x-request-id` header on each response, and
 * `security: []` for `@Public()` operations (the document requires the session cookie everywhere else). Mutates
 * `document` and returns it.
 */
export function documentConventions(document: OpenAPIObject, problemSchemaRef: string): OpenAPIObject {
  const requestIdHeader = {
    description: "The request's correlation id; equal to `requestId` in a problem.",
    schema: { type: "string" },
  };
  for (const pathItem of Object.values(document.paths)) {
    for (const method of HTTP_METHODS) {
      const operation: unknown = pathItem[method];
      if (!isRecord(operation)) continue;
      const responses = isRecord(operation["responses"]) ? operation["responses"] : {};
      responses["default"] = {
        description: "A problem (RFC 9457): every 4xx and 5xx response",
        content: { [PROBLEM_JSON_MEDIA_TYPE]: { schema: { $ref: problemSchemaRef } } },
      };
      for (const response of Object.values(responses)) {
        if (!isRecord(response)) continue;
        const headers = isRecord(response["headers"]) ? response["headers"] : {};
        headers[HEADERS.requestId] = requestIdHeader;
        response["headers"] = headers;
      }
      operation["responses"] = responses;
      if (operation[PUBLIC_OPERATION_EXTENSION] === true) {
        operation["security"] = [];
        Reflect.deleteProperty(operation, PUBLIC_OPERATION_EXTENSION);
      }
    }
  }
  return document;
}

/** The OpenAPI 3.1 document for the app's routes. */
export function buildOpenApiDocument(app: NestFastifyApplication, env: Env): OpenAPIObject {
  const cookieName = SESSION_COOKIE_NAME[env.NODE_ENV];
  const config = new DocumentBuilder()
    .setOpenAPIVersion("3.1.0")
    .setTitle("Finlytics API")
    .setDescription(
      "The Finlytics HTTP api. Errors are application/problem+json (RFC 9457). Signed-in routes read the Auth.js " +
        "session cookie; mutations also pass a CSRF check (Origin / Sec-Fetch-Site). Conventions: docs/04 §7.",
    )
    .setVersion("v1")
    .addCookieAuth(
      cookieName,
      {
        type: "apiKey",
        in: "cookie",
        name: cookieName,
        description: "The Auth.js session cookie (set by the web app).",
      },
      SESSION_SECURITY_SCHEME,
    )
    .addSecurityRequirements(SESSION_SECURITY_SCHEME)
    .build();
  const scanned = SwaggerModule.createDocument(app, config, { extraModels: [ProblemDetailsDto] });
  const document = cleanupOpenApiDoc(scanned, { version: "3.1" });
  return documentConventions(document, getSchemaPath(ProblemDetailsDto));
}

/** Serves `/docs` and `/docs/json` when API_DOCS_ENABLED; does nothing otherwise. Call before `init()`. */
export function setupOpenApi(app: NestFastifyApplication, env: Env): void {
  if (!env.API_DOCS_ENABLED) return;
  SwaggerModule.setup(DOCS_PATH, app, () => buildOpenApiDocument(app, env), {
    jsonDocumentUrl: `${DOCS_PATH}/json`,
    raw: ["json"],
    customSiteTitle: "Finlytics API",
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook("onSend", (request, reply, payload, done) => {
      if (isDocsPath(request.url)) reply.header("content-security-policy", DOCS_CSP);
      done(null, payload);
    });
}
