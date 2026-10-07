import { Prisma } from "@finlytics/database";
import { ProblemDetailsSchema, REQUEST_ID_PATTERN } from "@finlytics/shared";
import { HttpException } from "@nestjs/common";
import fc from "fast-check";
import { ZodValidationException } from "nestjs-zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ConflictError, RateLimitedError, ServiceUnavailableError, ValidationError } from "../domain-errors";
import { toProblem } from "../to-problem";

/** Text with everything a hostile or careless message could hold: control characters, separators, any length. */
const anyText = fc.string({ unit: "binary", maxLength: 700 });

/** Fastify-like errors with real and invented codes. */
const fastifyError = fc
  .record({
    code: fc.oneof(
      fc.constantFrom(
        "FST_ERR_CTP_BODY_TOO_LARGE",
        "FST_ERR_CTP_INVALID_MEDIA_TYPE",
        "FST_ERR_CTP_INVALID_JSON_BODY",
        "FST_ERR_HANDLER_TIMEOUT",
        "FST_ERR_BAD_URL",
      ),
      fc.string().map((suffix) => `FST_${suffix}`),
    ),
    statusCode: fc.oneof(fc.integer({ min: 100, max: 599 }), fc.constant(undefined)),
    message: anyText,
  })
  .map(({ code, statusCode, message }) =>
    Object.assign(new Error(message), { name: "FastifyError", code, statusCode }),
  );

/** Prisma-like errors with any code and any meta. */
const prismaError = fc
  .record({ code: fc.string({ maxLength: 8 }), sqlState: fc.string({ maxLength: 6 }), message: anyText })
  .map(
    ({ code, sqlState, message }) =>
      new Prisma.PrismaClientKnownRequestError(message, {
        code,
        clientVersion: "7.10.0",
        meta: { driverAdapterError: { cause: { originalCode: sqlState } }, modelName: message },
      }),
  );

/** Request bodies with hostile keys and values, validated by a strict schema: real Zod issues. */
const zodValidation = fc
  .dictionary(anyText, fc.anything(), { maxKeys: 5 })
  .map((body) => z.strictObject({ value: z.string().max(3) }).safeParse(body))
  .filter((result) => !result.success)
  .map((result) => new ZodValidationException(result.error));

const thrown = fc.oneof(
  fc.anything(),
  anyText.map((message) => new Error(message)),
  fc
    .record({ status: fc.integer({ min: 100, max: 999 }), message: anyText })
    .map(({ status, message }) => new HttpException(message, status)),
  fc
    .tuple(anyText, fc.double())
    .map(([detail, retry]) => new ServiceUnavailableError(detail, { retryAfterSec: retry })),
  fc.tuple(fc.integer(), anyText).map(([retry, detail]) => new RateLimitedError(retry, detail)),
  anyText.map((detail) => new ConflictError(detail)),
  fc
    .array(fc.record({ path: anyText, message: anyText, code: fc.option(anyText, { nil: undefined }) }), {
      maxLength: 150,
    })
    .map(
      (errors) =>
        new ValidationError(
          undefined,
          errors.map(({ code, ...rest }) => (code === undefined ? rest : { ...rest, code })),
        ),
    ),
  fastifyError,
  prismaError,
  zodValidation,
);

describe("toProblem (property)", () => {
  it("always produces a problem that passes ProblemDetailsSchema", () => {
    fc.assert(
      fc.property(thrown, fc.option(anyText, { nil: undefined }), (error, url) => {
        const { problem, headers } = toProblem(error, { requestId: "req-12345678", url });

        const parsed = ProblemDetailsSchema.safeParse(problem);
        expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
        expect(problem.requestId).toMatch(REQUEST_ID_PATTERN);
        expect(headers["retry-after"]).toBe(
          problem.retryAfterSec === undefined ? undefined : String(problem.retryAfterSec),
        );
      }),
      { numRuns: 500 },
    );
  });
});
