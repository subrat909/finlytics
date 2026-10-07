/** DTOs for the UDF datafeed: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import {
  UdfConfigSchema,
  UdfHistoryQuerySchema,
  UdfHistorySchema,
  UdfSearchQuerySchema,
  UdfSearchResultSchema,
  UdfSymbolInfoSchema,
  UdfSymbolQuerySchema,
} from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class UdfConfigDto extends createZodDto(UdfConfigSchema) {}
export class UdfSymbolQueryDto extends createZodDto(UdfSymbolQuerySchema) {}
export class UdfSymbolInfoDto extends createZodDto(UdfSymbolInfoSchema) {}
export class UdfSearchQueryDto extends createZodDto(UdfSearchQuerySchema) {}
export class UdfSearchResultDto extends createZodDto(UdfSearchResultSchema) {}
export class UdfHistoryQueryDto extends createZodDto(UdfHistoryQuerySchema) {}
export class UdfHistoryDto extends createZodDto(UdfHistorySchema) {}
