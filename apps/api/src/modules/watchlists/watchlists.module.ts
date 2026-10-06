import { Module } from "@nestjs/common";

import { WatchlistsController } from "./watchlists.controller";
import { WatchlistsRepository } from "./watchlists.repository";
import { WatchlistsService } from "./watchlists.service";

/** `/v1/watchlists`. */
@Module({
  controllers: [WatchlistsController],
  providers: [WatchlistsRepository, WatchlistsService],
})
export class WatchlistsModule {}
