import { describeBrokerAdapterContract } from "../../../__tests__/adapter.contract";
import { Secret } from "../../../credentials";
import { DhanAdapter } from "../adapter";

import { CREDS, FakeDhan, KEYS, seededInstruments } from "./fake-dhan";
import { quoteFrame } from "./frames";

describeBrokerAdapterContract({
  name: "DhanAdapter",
  setup: () => {
    const dhan = new FakeDhan();
    const adapter = new DhanAdapter({
      fetch: dhan.fetch,
      webSocket: dhan.sockets.factory,
      instruments: seededInstruments(),
    });
    let ltp = 182.5;
    return Promise.resolve({
      adapter,
      creds: CREDS,
      expiredCreds: { ...CREDS, accessToken: Secret.of("expired-token-REDACTED") },
      marketableOrder: {
        instrumentKey: KEYS.hdfcBank,
        side: "BUY",
        type: "MARKET",
        product: "DELIVERY",
        validity: "DAY",
        qty: 2,
        tag: "contract-1",
      },
      restingOrder: {
        instrumentKey: KEYS.hdfcBank,
        side: "BUY",
        type: "LIMIT",
        product: "INTRADAY",
        validity: "DAY",
        qty: 1,
        price: "1400",
      },
      modifiedPrice: "1405.5",
      feedKey: KEYS.niftyCe,
      emitTick: () => {
        ltp += 0.5;
        // Like the server: packets only for instruments the socket subscribed (and not since unsubscribed).
        for (const socket of dhan.marketSockets()) {
          let subscribed = false;
          for (const message of socket.messages()) {
            const list = (message.InstrumentList ?? []) as { SecurityId: string }[];
            if (!list.some((item) => item.SecurityId === "52175")) continue;
            subscribed = [15, 17, 21].includes(Number(message.RequestCode));
          }
          if (subscribed && !socket.closed) socket.receive(quoteFrame(2, 52175, { ltp, ltt: 1_759_722_300 }));
        }
      },
      candleQuery: {
        instrumentKey: KEYS.niftyCe,
        timeframe: "M1",
        from: new Date("2025-10-06T03:45:00Z"),
        to: new Date("2025-10-06T03:48:00Z"),
      },
    });
  },
});
