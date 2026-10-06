// check:pkg smoke test (ESM). Loads the BUILT package through its own name with import(), and runs a paper order
// through the gateway (zod, decimal.js via @finlytics/shared, node:crypto), so a broken external fails here.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

assert.match(
  import.meta.resolve("@finlytics/broker-sdk"),
  /\/dist\/index\.js$/,
  "import() must resolve to the ESM build",
);

const sdk = await import("@finlytics/broker-sdk");

const quotes = new sdk.MemoryQuoteSource();
const key = "NSE_EQ|INFY";
quotes.set(key, { ltp: "1500.5", bid: "1500.45", ask: "1500.55" });
const adapter = sdk.createBrokerRegistry().create("PAPER", { quotes });
const gateway = new sdk.BrokerGateway({ adapter, rateLimiter: new sdk.MemoryRateLimiter() });

const creds = await gateway.exchangeToken({});
const account = { accountId: "smoke-esm", creds };
const order = { instrumentKey: key, side: "BUY", type: "MARKET", product: "DELIVERY", validity: "DAY", qty: 2 };
const { brokerOrderId } = await gateway.placeOrder(account, order);
const [placed] = await gateway.getOrderBook(account);
assert.equal(placed.brokerOrderId, brokerOrderId);
assert.equal(placed.averagePrice, "1500.55", "fills at the ask");
const [position] = await gateway.getPositions(account);
assert.equal(position.unrealisedPnl, "-0.1", "P&L in exact decimals");

const invalid = await gateway.placeOrder(account, { ...order, type: "LIMIT" }).catch((error) => error);
assert.equal(sdk.isBrokerError(invalid) && invalid.code, "VALIDATION", "inputs are validated");
assert.equal(JSON.stringify(creds).includes(creds.accessToken.reveal()), false, "secrets never serialise");
assert.equal(sdk.redactSecrets("Bearer abcdefghijkl"), "Bearer [REDACTED]");
assert.equal(sdk.DEFAULT_BROKER_RATE_LIMITS.UPSTOX.standard.ratePerSec, 25);
assert.match(sdk.GCRA_SHA1, /^[0-9a-f]{40}$/);

// Both builds in one process: errors are recognised across copies by structure, not instanceof.
const cjs = createRequire(import.meta.url)("@finlytics/broker-sdk");
assert.notEqual(cjs.BrokerGateway, sdk.BrokerGateway, "require() loads the separate CJS build");
assert.equal(sdk.isBrokerError(new cjs.NeedsReloginError("x")), true);

console.log("ESM smoke test passed: import() loads dist/index.js");
