/**
 * The global validation pipe (plan D4, D15): nestjs-zod's pipe with `strictSchemaDeclaration`, so every `@Body()`,
 * `@Query()` and `@Param()` must be typed with a nestjs-zod DTO (`createZodDto` over a schema from
 * @finlytics/shared). An undeclared one is a 500 (ZodSchemaDeclarationException), caught by the first test of the
 * route, rather than an unvalidated input.
 *
 * Two adjustments:
 * - Custom parameter decorators (`@CurrentUser()`, `@RequestMeta()`) reach global pipes as `type: "custom"`; they
 *   carry server-made values, not input, so they are passed through instead of tripping the strict check.
 * - A ZodError becomes a ValidationError with react-hook-form field errors (`errors[]`), sanitised: Zod's message for
 *   unknown keys embeds the raw key.
 */
import { Injectable } from "@nestjs/common";
import type { ArgumentMetadata, PipeTransform } from "@nestjs/common";
import { createZodValidationPipe } from "nestjs-zod";

import { ValidationError } from "../problem-json/domain-errors";
import { fieldErrorsFromZod } from "../problem-json/field-errors";
import { zodIssues } from "../problem-json/known-errors";

/** nestjs-zod's `createValidationException`: a ZodError becomes a VALIDATION problem; anything else is rethrown. */
export function toValidationError(error: unknown): Error {
  const issues = zodIssues(error);
  if (issues === undefined) return error instanceof Error ? error : new Error("Validation failed", { cause: error });
  return new ValidationError("The request is invalid.", fieldErrorsFromZod(issues), { cause: error });
}

const StrictZodValidationPipe = createZodValidationPipe({
  strictSchemaDeclaration: true,
  createValidationException: toValidationError,
});

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  private readonly inner: PipeTransform = new StrictZodValidationPipe();

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === "custom") return value;
    return this.inner.transform(value, metadata);
  }
}
