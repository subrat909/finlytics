import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { Reflector } from "@nestjs/core";
import { describe, expect, it } from "vitest";

import type { Env } from "../../../config/env.schema";
import { Public } from "../../decorators/public";
import { ForbiddenError } from "../../problem-json/domain-errors";
import { CsrfGuard, csrfVerdict } from "../csrf.guard";
import type { CsrfRequest } from "../csrf.guard";

const ALLOWED = new Set(["http://localhost:3000", "https://app.finlytics.in"]);
const mutation = (overrides: Partial<CsrfRequest>): CsrfRequest => ({
  method: "PATCH",
  hasSessionCookie: true,
  origin: undefined,
  secFetchSite: undefined,
  ...overrides,
});

describe("csrfVerdict", () => {
  it("allows allowlisted Origin and same-origin mutations", () => {
    expect(csrfVerdict(mutation({ origin: "https://app.finlytics.in" }), ALLOWED)).toBe("allow");
    expect(csrfVerdict(mutation({ secFetchSite: "same-origin" }), ALLOWED)).toBe("allow");
    expect(csrfVerdict(mutation({ secFetchSite: "none" }), ALLOWED)).toBe("allow");
  });

  it("rejects cross-site and same-site-without-Origin mutations with FORBIDDEN", () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      expect(csrfVerdict(mutation({ method, origin: "https://evil.example" }), ALLOWED), method).toBe("reject");
    }
    expect(csrfVerdict(mutation({ origin: "null" }), ALLOWED)).toBe("reject");
    expect(csrfVerdict(mutation({ origin: "https://app.finlytics.in.evil.example" }), ALLOWED)).toBe("reject");
    expect(csrfVerdict(mutation({ secFetchSite: "cross-site" }), ALLOWED)).toBe("reject");
    expect(csrfVerdict(mutation({ secFetchSite: "same-site" }), ALLOWED)).toBe("reject");
  });

  it("allows mutations with neither Origin nor Sec-Fetch-Site", () => {
    expect(csrfVerdict(mutation({}), ALLOWED)).toBe("allow");
  });

  it("ignores safe methods and cookie-less requests", () => {
    for (const method of ["GET", "head", "OPTIONS"]) {
      expect(csrfVerdict(mutation({ method, origin: "https://evil.example" }), ALLOWED), method).toBe("allow");
    }
    expect(csrfVerdict(mutation({ hasSessionCookie: false, origin: "https://evil.example" }), ALLOWED)).toBe("allow");
  });
});

describe("CsrfGuard", () => {
  const config = {
    get: (key: keyof Env) => (key === "NODE_ENV" ? "test" : ["http://localhost:3000"]),
  } as unknown as ConfigService<Env, true>;

  const Routes = (): void => undefined; // a controller stand-in
  const mutate = (): void => undefined;
  // A function declaration: like a controller class it has a prototype, which @Public()'s ApiExtension reads.
  function publicMutate(): void {}
  Public()(publicMutate);

  const context = (handler: () => void, headers: Record<string, string>, cookies: Record<string, string>) =>
    ({
      getHandler: () => handler,
      getClass: () => Routes,
      switchToHttp: () => ({ getRequest: () => ({ method: "POST", headers, cookies }) }),
    }) as unknown as ExecutionContext;

  const guard = new CsrfGuard(new Reflector(), config);
  const sessionCookie = { "authjs.session-token": "t".repeat(43) };

  it("rejects a cross-site mutation that carries the session cookie", () => {
    expect(() => guard.canActivate(context(mutate, { origin: "https://evil.example" }, sessionCookie))).toThrow(
      ForbiddenError,
    );
    expect(guard.canActivate(context(mutate, { origin: "http://localhost:3000" }, sessionCookie))).toBe(true);
    expect(guard.canActivate(context(mutate, { origin: "https://evil.example" }, {}))).toBe(true);
  });

  it("ignores public routes", () => {
    expect(guard.canActivate(context(publicMutate, { origin: "https://evil.example" }, sessionCookie))).toBe(true);
  });

  it("reads a repeated header as one value", () => {
    const repeated = {
      getHandler: () => mutate,
      getClass: () => Routes,
      switchToHttp: () => ({
        getRequest: () => ({
          method: "POST",
          headers: { "sec-fetch-site": ["same-origin", "cross-site"] },
          cookies: sessionCookie,
        }),
      }),
    } as unknown as ExecutionContext;

    expect(() => guard.canActivate(repeated)).toThrow(ForbiddenError);
  });
});
