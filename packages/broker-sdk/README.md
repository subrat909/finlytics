# @finlytics/broker-sdk

Adapter interface (`src/adapter.ts`) + implementations in `src/brokers/<name>/`.

| Broker                    | Auth                | Token life              | Market feed                                                      | Order feed            | Docs                                            |
| ------------------------- | ------------------- | ----------------------- | ---------------------------------------------------------------- | --------------------- | ----------------------------------------------- |
| Upstox (API v2 / v3 feed) | OAuth2 code         | till 03:30 IST next day | WSS protobuf (`MarketDataFeedV3`, modes ltpc/full/option_greeks) | WSS portfolio stream  | https://upstox.com/developer/api-documentation/ |
| Dhan (DhanHQ v2)          | static access token | 30 days                 | WSS binary packets, ≤5000 instruments/conn                       | WSS live order update | https://dhanhq.co/docs/v2/                      |
| Paper                     | none                | —                       | mirrors a real feed                                              | simulated fills       | internal                                        |

Rules: `.claude/rules/broker.md`. Use `/add-broker <Name> <docs-url>` to scaffold a new one.
Contract tests: `pnpm --filter broker-sdk test` (fixtures in `src/brokers/<name>/fixtures`, redacted).
