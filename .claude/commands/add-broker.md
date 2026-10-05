---
description: Scaffold and implement a new broker adapter. Usage - /add-broker <BrokerName> <docs-url>
---

Use the `broker-integrator` subagent to add broker: $ARGUMENTS

Steps: fetch the official docs → fill `packages/broker-sdk/src/brokers/<name>/types.ts` with exact field names → implement all 12 `BrokerAdapter` operations + market feed + order feed → symbol mapping to canonical `instrumentKey` → contract tests with fixtures → register in `BrokerRegistry` → add UI config (logo, connect flow) → update `packages/broker-sdk/README.md` with rate limits & quirks.
