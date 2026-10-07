/** DTOs for the instruments module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import {
  InstrumentListSchema,
  InstrumentSchema,
  InstrumentSearchQuerySchema,
  InstrumentSyncRequestSchema,
  InstrumentSyncResultSchema,
} from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class InstrumentSearchQueryDto extends createZodDto(InstrumentSearchQuerySchema) {}
export class InstrumentListDto extends createZodDto(InstrumentListSchema) {}
export class InstrumentDto extends createZodDto(InstrumentSchema) {}
/** The key as a path parameter (URL-encoded; parsed strictly by the service). */
export class InstrumentKeyParamsDto extends createZodDto(z.strictObject({ key: z.string().min(1).max(384) })) {}
export class InstrumentSyncRequestDto extends createZodDto(InstrumentSyncRequestSchema) {}
export class InstrumentSyncResultDto extends createZodDto(InstrumentSyncResultSchema) {}
