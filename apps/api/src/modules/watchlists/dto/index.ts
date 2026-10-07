/** DTOs for the watchlists module: the Zod contracts from @finlytics/shared, as nestjs-zod classes. */
import {
  AddWatchlistItemSchema,
  CreateWatchlistSchema,
  ReorderWatchlistItemsSchema,
  UpdateWatchlistSchema,
  WatchlistIdSchema,
  WatchlistItemSchema,
  WatchlistListSchema,
  WatchlistSchema,
} from "@finlytics/shared";
import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export class WatchlistDto extends createZodDto(WatchlistSchema) {}
export class WatchlistListDto extends createZodDto(WatchlistListSchema) {}
export class WatchlistItemDto extends createZodDto(WatchlistItemSchema) {}
export class CreateWatchlistDto extends createZodDto(CreateWatchlistSchema) {}
export class UpdateWatchlistDto extends createZodDto(UpdateWatchlistSchema) {}
export class AddWatchlistItemDto extends createZodDto(AddWatchlistItemSchema) {}
export class ReorderWatchlistItemsDto extends createZodDto(ReorderWatchlistItemsSchema) {}
export class WatchlistParamsDto extends createZodDto(z.strictObject({ id: WatchlistIdSchema })) {}
export class WatchlistItemParamsDto extends createZodDto(
  z.strictObject({ id: WatchlistIdSchema, itemId: WatchlistIdSchema }),
) {}
