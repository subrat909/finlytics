import { vi } from "vitest";

/** One request the app made through `apiRequest` (fetch). */
export interface ApiCall {
  method: string;
  path: string;
  body: unknown;
}

export interface ApiRoute {
  method?: string;
  /** Exact path (with query) or a pattern. */
  path: string | RegExp;
  respond: (call: ApiCall) => Response | Promise<Response>;
}

/** A problem+json response, as the api sends it. */
export function problem(status: number, code: string, extra: Record<string, unknown> = {}): Response {
  return new Response(
    JSON.stringify({ type: "about:blank", title: code, status, code, requestId: "req-12345678", ...extra }),
    { status, headers: { "content-type": "application/problem+json" } },
  );
}

/**
 * Stubs `fetch` with a small router: the first route whose method and path match answers; anything else is a 404
 * problem. Returns the recorded calls.
 */
export function mockApi(routes: ApiRoute[]): ApiCall[] {
  const calls: ApiCall[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const path = typeof input === "string" ? input : input instanceof URL ? input.pathname + input.search : input.url;
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const call = { method, path, body };
    calls.push(call);
    const route = routes.find(
      (candidate) =>
        (candidate.method ?? "GET") === method &&
        (typeof candidate.path === "string" ? candidate.path === path : candidate.path.test(path)),
    );
    return Promise.resolve(route ? route.respond(call) : problem(404, "NOT_FOUND"));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}
