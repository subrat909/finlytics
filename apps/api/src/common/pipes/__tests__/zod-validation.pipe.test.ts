import { createZodDto, ZodSchemaDeclarationException } from "nestjs-zod";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ValidationError } from "../../problem-json/domain-errors";
import { toValidationError, ZodValidationPipe } from "../zod-validation.pipe";

class NoteDto extends createZodDto(z.strictObject({ title: z.string().min(1) })) {}

describe("ZodValidationPipe", () => {
  const pipe = new ZodValidationPipe();

  it("parses a DTO-typed body", () => {
    expect(pipe.transform({ title: "hello" }, { type: "body", metatype: NoteDto })).toEqual({ title: "hello" });
  });

  it("turns an invalid body into a VALIDATION error with field errors", () => {
    let thrown: unknown;
    try {
      pipe.transform({ title: "", "x\ny": 1 }, { type: "body", metatype: NoteDto });
    } catch (error: unknown) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ValidationError);
    expect((thrown as ValidationError).fieldErrors).toEqual([
      { path: "title", message: expect.any(String) as string, code: "too_small" },
      { path: "x�y", message: "Unknown field.", code: "unrecognized_keys" },
    ]);
  });

  it("refuses a body, query or param that isn't declared with a DTO", () => {
    expect(() => pipe.transform({ title: "x" }, { type: "body", metatype: Object })).toThrow(
      ZodSchemaDeclarationException,
    );
    expect(() => pipe.transform("1", { type: "param", metatype: String, data: "id" })).toThrow(
      ZodSchemaDeclarationException,
    );
  });

  it("passes custom parameter decorators (@CurrentUser, @RequestMeta) through untouched", () => {
    const identity = { userId: "u1", sessionId: "s1", role: "USER" };

    expect(pipe.transform(identity, { type: "custom", metatype: Object })).toBe(identity);
  });

  it("rethrows errors that aren't Zod errors", () => {
    const boom = new Error("boom");
    expect(toValidationError(boom)).toBe(boom);
    expect(toValidationError("text")).toBeInstanceOf(Error);
  });
});
