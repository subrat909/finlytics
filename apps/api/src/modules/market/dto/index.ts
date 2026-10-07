/** DTOs for the market module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import { MarketOverviewSchema } from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";

export class MarketOverviewDto extends createZodDto(MarketOverviewSchema) {}
