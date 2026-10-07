/** DTOs for the quotes module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { QuoteDepthQuerySchema, QuotesQuerySchema, QuotesResultSchema, RtDepthSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class QuotesQueryDto extends createZodDto(QuotesQuerySchema) {}
export class QuotesResultDto extends createZodDto(QuotesResultSchema) {}
export class QuoteDepthQueryDto extends createZodDto(QuoteDepthQuerySchema) {}
export class QuoteDepthDto extends createZodDto(RtDepthSchema) {}
