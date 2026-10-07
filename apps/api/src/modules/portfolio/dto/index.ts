/** DTOs for the portfolio module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { FundsViewSchema, HoldingsViewSchema, PortfolioQuerySchema, PositionsViewSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class PortfolioQueryDto extends createZodDto(PortfolioQuerySchema) {}
export class FundsViewDto extends createZodDto(FundsViewSchema) {}
export class PositionsViewDto extends createZodDto(PositionsViewSchema) {}
export class HoldingsViewDto extends createZodDto(HoldingsViewSchema) {}
