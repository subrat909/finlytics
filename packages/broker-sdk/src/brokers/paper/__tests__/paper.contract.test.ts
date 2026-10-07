import { Secret } from "../../../credentials";
import { describeBrokerAdapterContract } from "../../../__tests__/adapter.contract";

import { NIFTY_CE, order, paperSetup } from "./fixtures";

describeBrokerAdapterContract({
  name: "PaperAdapter",
  setup: async () => {
    let ltp = 100;
    const { adapter, creds, quotes } = await paperSetup({
      candles: () => [
        {
          ts: Date.UTC(2025, 9, 6, 3, 45),
          open: "100",
          high: "101",
          low: "99.5",
          close: "100.5",
          volume: 1500,
          oi: 10,
        },
        { ts: Date.UTC(2025, 9, 6, 3, 46), open: "100.5", high: "100.5", low: "100", close: "100", volume: 900 },
      ],
    });
    return {
      adapter,
      creds,
      expiredCreds: { ...creds, accessToken: Secret.of("not-the-paper-token") },
      marketableOrder: order(),
      restingOrder: order({ type: "LIMIT", price: "50" }),
      modifiedPrice: "55",
      feedKey: NIFTY_CE,
      emitTick: () => {
        ltp += 1;
        quotes.set(NIFTY_CE, { ltp: String(ltp) });
      },
      candleQuery: {
        instrumentKey: NIFTY_CE,
        timeframe: "M1",
        from: new Date("2025-10-06T03:45:00Z"),
        to: new Date("2025-10-06T03:47:00Z"),
      },
    };
  },
});
