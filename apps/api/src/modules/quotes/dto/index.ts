/** DTOs for the quotes module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { QuotesQuerySchema, QuotesResultSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class QuotesQueryDto extends createZodDto(QuotesQuerySchema) {}
export class QuotesResultDto extends createZodDto(QuotesResultSchema) {}
