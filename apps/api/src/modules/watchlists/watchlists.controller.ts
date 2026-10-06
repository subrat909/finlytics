import type { Watchlist, WatchlistItem } from "@finlytics/shared";
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZodResponse } from "nestjs-zod";

import { CurrentUser } from "../../common/decorators/current-user";
import type { AuthIdentity } from "../auth/auth-identity";

import {
  AddWatchlistItemDto,
  CreateWatchlistDto,
  ReorderWatchlistItemsDto,
  UpdateWatchlistDto,
  WatchlistDto,
  WatchlistItemDto,
  WatchlistItemParamsDto,
  WatchlistListDto,
  WatchlistParamsDto,
} from "./dto";
import { WatchlistsService } from "./watchlists.service";

/** `/v1/watchlists`: the user's lists and their instruments, within the plan's limits. */
@ApiTags("watchlists")
@Controller("v1/watchlists")
export class WatchlistsController {
  constructor(private readonly watchlists: WatchlistsService) {}

  @Get()
  @ZodResponse({ status: 200, description: "The user's watchlists with their items", type: WatchlistListDto })
  list(@CurrentUser() identity: AuthIdentity): Promise<Watchlist[]> {
    return this.watchlists.list(identity.userId);
  }

  @Post()
  @ZodResponse({ status: 201, description: "The new, empty watchlist", type: WatchlistDto })
  create(@CurrentUser() identity: AuthIdentity, @Body() body: CreateWatchlistDto): Promise<Watchlist> {
    return this.watchlists.create(identity.userId, body);
  }

  @Patch(":id")
  @ZodResponse({ status: 200, description: "The renamed or moved watchlist", type: WatchlistDto })
  update(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: WatchlistParamsDto,
    @Body() body: UpdateWatchlistDto,
  ): Promise<Watchlist> {
    return this.watchlists.update(identity.userId, params.id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(@CurrentUser() identity: AuthIdentity, @Param() params: WatchlistParamsDto): Promise<void> {
    await this.watchlists.remove(identity.userId, params.id);
  }

  @Post(":id/items")
  @ZodResponse({ status: 201, description: "The added item", type: WatchlistItemDto })
  addItem(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: WatchlistParamsDto,
    @Body() body: AddWatchlistItemDto,
  ): Promise<WatchlistItem> {
    return this.watchlists.addItem(identity.userId, params.id, body);
  }

  @Delete(":id/items/:itemId")
  @HttpCode(204)
  async removeItem(@CurrentUser() identity: AuthIdentity, @Param() params: WatchlistItemParamsDto): Promise<void> {
    await this.watchlists.removeItem(identity.userId, params.id, params.itemId);
  }

  @Put(":id/items/order")
  @ZodResponse({ status: 200, description: "The watchlist with its items in the new order", type: WatchlistDto })
  reorderItems(
    @CurrentUser() identity: AuthIdentity,
    @Param() params: WatchlistParamsDto,
    @Body() body: ReorderWatchlistItemsDto,
  ): Promise<Watchlist> {
    return this.watchlists.reorderItems(identity.userId, params.id, body);
  }
}
