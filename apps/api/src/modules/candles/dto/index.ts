/** DTOs for the candles module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { CandleListSchema, CandlesQuerySchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

/** `GET /v1/candles` query: `key`, `tf`, `from`, `to` (epoch seconds or ISO 8601). */
export class CandlesQueryDto extends createZodDto(CandlesQuerySchema) {}

/** `GET /v1/candles`: bars in ascending time order. */
export class CandleListDto extends createZodDto(CandleListSchema) {}
