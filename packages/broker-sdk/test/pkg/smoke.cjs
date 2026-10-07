// check:pkg smoke test (CJS). Loads the BUILT package through its own name with require(), the way NestJS does, and
// runs a paper order through the gateway, so a broken external (missing dependency, wrong interop) fails here.
const assert = require("node:assert/strict");

assert.match(
  require.resolve("@finlytics/broker-sdk"),
  /[/\\]dist[/\\]index\.cjs$/,
  "require() must resolve to dist/index.cjs",
);

const sdk = require("@finlytics/broker-sdk");

async function main() {
  const quotes = new sdk.MemoryQuoteSource();
  const key = "NSE_EQ|INFY";
  quotes.set(key, { ltp: "1500.5" });
  const gateway = new sdk.BrokerGateway({
    adapter: new sdk.PaperAdapter({ quotes }),
    rateLimiter: new sdk.MemoryRateLimiter(),
  });
  const account = { accountId: "smoke-cjs", creds: await gateway.exchangeToken({}) };
  await gateway.placeOrder(account, {
    instrumentKey: key,
    side: "SELL",
    type: "MARKET",
    product: "INTRADAY",
    validity: "DAY",
    qty: 3,
  });
  const funds = await gateway.getFunds(account);
  assert.equal(funds.usedMargin, "4501.5", "margin in exact decimals");
  const relogin = await gateway
    .getProfile({ accountId: "smoke-cjs", creds: { accessToken: sdk.Secret.of("wrong-token") } })
    .catch((error) => error);
  assert.equal(sdk.isBrokerError(relogin) && relogin.code, "NEEDS_RELOGIN");

  const esm = await import("@finlytics/broker-sdk");
  assert.notEqual(esm.BrokerGateway, sdk.BrokerGateway, "import() loads the separate ESM build");
  assert.equal(sdk.isBrokerError(new esm.RateLimitedError("x")), true);

  console.log("CJS smoke test passed: require() loads dist/index.cjs");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
