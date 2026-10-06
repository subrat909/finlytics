import { ProblemDetailsSchema, problemTypeUrl } from "@finlytics/shared";
import type { FastifyReply } from "fastify";
import { describe, expect, it, vi } from "vitest";

import type * as ToProblemModule from "../../problem-json/to-problem";
import { sendProblem } from "../problem-details.filter";

// A mapping that produces an invalid problem (a stack trace in `detail`, an unknown member): only a future bug could.
vi.mock("../../problem-json/to-problem", async (importOriginal) => {
  const original = await importOriginal<typeof ToProblemModule>();
  return {
    ...original,
    toProblem: () => ({
      problem: {
        ...original.fallbackProblem("req-12345678"),
        detail: "Error: boom\n    at handler (/app/src/x.ts:1:1)",
        sql: "SELECT 1",
      },
      headers: { "retry-after": "5" },
      log: { level: "error", message: "boom", fields: {} },
    }),
  };
});

describe("sendProblem fallback", () => {
  it("falls back to a minimal INTERNAL problem when a built problem fails validation", () => {
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const send = vi.fn<(body: unknown) => unknown>();
    const reply = {
      sent: false,
      status: vi.fn(() => reply),
      headers: vi.fn(() => reply),
      removeHeader: vi.fn(() => reply),
      send,
    };

    sendProblem(logger, { id: "req-12345678", url: "/v1/me" }, reply as unknown as FastifyReply, new Error());

    expect(send).toHaveBeenCalledWith({
      type: problemTypeUrl("INTERNAL"),
      title: "Internal error",
      status: 500,
      code: "INTERNAL",
      requestId: "req-12345678",
    });
    // The failed problem's headers (Retry-After) are dropped with it.
    expect(reply.headers).toHaveBeenCalledWith({
      "content-type": "application/problem+json; charset=utf-8",
      "cache-control": "no-store",
      "x-request-id": "req-12345678",
    });
    expect(logger.error).toHaveBeenCalledWith(
      { issues: expect.arrayContaining([{ path: "detail", code: "invalid_format" }]) as unknown },
      "problem failed its schema; sending INTERNAL",
    );
    expect(ProblemDetailsSchema.safeParse(send.mock.calls[0]?.[0]).success).toBe(true);
  });
});
