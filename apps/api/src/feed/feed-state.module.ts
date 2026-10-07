import { Module } from "@nestjs/common";

import { FeedSourceReader } from "./feed-source";

/** {@link FeedSourceReader} for the roles that read the feed's source and state (gateway, http). */
@Module({
  providers: [FeedSourceReader],
  exports: [FeedSourceReader],
})
export class FeedStateModule {}
