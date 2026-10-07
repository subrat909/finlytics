import { describeBrokerAdapterContract } from "../../../__tests__/adapter.contract";

import { NIFTY_CE, NIFTY_CE_TOKEN, niftyOrder, upstoxSetup } from "./setup";

describeBrokerAdapterContract({
  name: "UpstoxAdapter (recorded fixtures)",
  setup: () => {
    const { adapter, creds, expiredCreds, fake } = upstoxSetup();
    let ltp = 219.3;
    return Promise.resolve({
      adapter,
      creds,
      expiredCreds,
      marketableOrder: niftyOrder({ tag: "contract-1" }),
      restingOrder: niftyOrder({ type: "LIMIT", price: "50" }),
      modifiedPrice: "55",
      feedKey: NIFTY_CE,
      emitTick: () => {
        ltp += 0.05;
        fake.emitLtpc(NIFTY_CE_TOKEN, ltp);
      },
      candleQuery: {
        instrumentKey: NIFTY_CE,
        timeframe: "M1",
        from: new Date("2025-10-03T03:45:00Z"),
        to: new Date("2025-10-03T03:47:00Z"),
      },
    });
  },
});
