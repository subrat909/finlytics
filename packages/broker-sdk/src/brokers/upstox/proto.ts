/**
 * Upstox Market Data Feed V3 protobuf schema, shipped as data: the text of ./MarketDataFeedV3.proto (verbatim from
 * https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto, read 2026-10-06), embedded as a string so
 * the ESM and CJS builds need no file access. A test keeps the two identical.
 *
 * `google.protobuf.DoubleValue` (from the wrappers import) is defined here, so parsing needs no other file.
 */
import protobuf from "protobufjs";

import type { UpstoxFeedResponse } from "./types";

export const MARKET_DATA_FEED_V3_PROTO = `syntax = "proto3";
package com.upstox.marketdatafeederv3udapi.rpc.proto;
import "google/protobuf/wrappers.proto";

message LTPC {
  double ltp = 1;
  int64 ltt = 2;
  int64 ltq = 3;
  double cp = 4;
  google.protobuf.DoubleValue iep = 5;
}

message MarketLevel {
  repeated Quote bidAskQuote = 1;
}

message MarketOHLC {
  repeated OHLC ohlc = 1;
}

message Quote {
  int64 bidQ = 1;
  double bidP = 2;
  int64 askQ = 3;
  double askP = 4;
}

message OptionGreeks {
  double delta = 1;
  double theta = 2;
  double gamma = 3;
  double vega = 4;
  double rho = 5;
}

message OHLC {
  string interval = 1;
  double open = 2;
  double high = 3;
  double low = 4;
  double close = 5;
  int64 vol = 6;
  int64 ts = 7;
}

enum Type{
  initial_feed = 0;
  live_feed = 1;
  market_info = 2;
}

message MarketFullFeed{
  LTPC ltpc = 1;
  MarketLevel marketLevel = 2;
  OptionGreeks optionGreeks = 3;
  MarketOHLC marketOHLC = 4;
  double atp = 5;
  int64 vtt = 6;
  double oi = 7;
  double iv = 8;
  double tbq =9;
  double tsq = 10;
  double iep = 11;
  double rp = 12;
  int64 ieq = 13;
  int64 iiqTotal = 14;
  int64 iiqM = 15;
  bool casEligible = 16;
}

message IndexFullFeed{
  LTPC ltpc = 1;
  MarketOHLC marketOHLC = 2;
}


message FullFeed {
  oneof FullFeedUnion {
    MarketFullFeed marketFF = 1;
    IndexFullFeed indexFF = 2;
  }
}

message FirstLevelWithGreeks{
  LTPC ltpc = 1;
  Quote firstDepth = 2;
  OptionGreeks optionGreeks = 3;
  int64 vtt = 4;
  double oi = 5;
  double iv = 6;
}

message Feed {
  oneof FeedUnion {
    LTPC ltpc = 1;
    FullFeed fullFeed = 2;
    FirstLevelWithGreeks firstLevelWithGreeks = 3;
  }
  RequestMode requestMode = 4;
}

enum RequestMode {
  ltpc = 0;
  full_d5 = 1;
  option_greeks = 2;
  full_d30 = 3;
}

enum MarketStatus {
  PRE_OPEN_START = 0;
  PRE_OPEN_END = 1;
  NORMAL_OPEN = 2;
  NORMAL_CLOSE = 3;
  CLOSING_START = 4;
  CLOSING_END = 5;
}


message StatusInfo {
  string status = 1;
  int64 updatedTime = 2;
}

message MarketInfo {
  map<string, MarketStatus> segmentStatus = 1;
  map<string, StatusInfo> casMarketStatus = 2;
  map<string, StatusInfo> preOpenSessionStatus = 3;
}

message FeedResponse{
  Type type = 1;
  map<string, Feed> feeds = 2;
  int64 currentTs = 3;
  MarketInfo marketInfo = 4;
}
`;

/** The protobuf package of every Upstox V3 feed message. */
export const MARKET_DATA_FEED_V3_PACKAGE = "com.upstox.marketdatafeederv3udapi.rpc.proto";

let feedResponseType: protobuf.Type | undefined;

/** The `FeedResponse` message type, parsed once. */
export function upstoxFeedResponseType(): protobuf.Type {
  if (feedResponseType === undefined) {
    const root = new protobuf.Root();
    root.define("google.protobuf").add(new protobuf.Type("DoubleValue").add(new protobuf.Field("value", 1, "double")));
    protobuf.parse(MARKET_DATA_FEED_V3_PROTO, root, { keepCase: true });
    root.resolveAll();
    feedResponseType = root.lookupType(`${MARKET_DATA_FEED_V3_PACKAGE}.FeedResponse`);
  }
  return feedResponseType;
}

/**
 * Decodes one binary feed frame. int64 fields become numbers (epoch ms and volumes fit), enums their names; fields at
 * their proto3 default (0, "", false) are absent.
 *
 * @throws {Error} when the bytes are not a `FeedResponse`.
 */
export function decodeUpstoxFeedResponse(bytes: Uint8Array): UpstoxFeedResponse {
  const type = upstoxFeedResponseType();
  return type.toObject(type.decode(bytes), { longs: Number, enums: String });
}
