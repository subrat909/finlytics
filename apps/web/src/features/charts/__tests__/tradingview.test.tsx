import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import TradingViewChart from "../components/tradingview-chart";

const KEY = "NSE_INDEX|NIFTY 50";

interface WidgetOptions {
  symbol: string;
  interval: string;
  theme: string;
  datafeed: unknown;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubScripts(outcome: "load" | "error") {
  return vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
    for (const node of nodes) {
      if (!(node instanceof HTMLScriptElement)) continue;
      queueMicrotask(() => {
        if (outcome === "load") node.onload?.(new Event("load"));
        else node.onerror?.(new Event("error"));
      });
    }
  });
}

describe("TradingViewChart (Advanced Charts, when vendored)", () => {
  it("loads the library and the UDF datafeed with the interval, follows the theme and removes the widget", async () => {
    stubScripts("load");
    const remove = vi.fn();
    const changeTheme = vi.fn();
    const widget = vi.fn<(this: { remove: () => void; changeTheme: () => void }, options: WidgetOptions) => void>(
      function (this: { remove: () => void; changeTheme: () => void }) {
        this.remove = remove;
        this.changeTheme = changeTheme;
      },
    );
    const datafeed = vi.fn();
    vi.stubGlobal("TradingView", { widget });
    vi.stubGlobal("Datafeeds", { UDFCompatibleDatafeed: datafeed });

    const { unmount } = render(
      <TradingViewChart
        instrumentKey={KEY}
        timeframe="H4"
        datafeedPath="/datafeeds/udf/dist/bundle.js"
        summary="NIFTY chart"
      />,
    );
    await waitFor(() => {
      expect(widget).toHaveBeenCalledTimes(1);
    });
    expect(datafeed).toHaveBeenCalledWith("/v1/udf", 5_000);
    expect(widget.mock.calls[0]?.[0]).toMatchObject({
      symbol: KEY,
      interval: "240",
      library_path: "/charting_library/",
    });
    document.documentElement.setAttribute("data-theme", "light");
    await waitFor(() => {
      expect(changeTheme).toHaveBeenCalledWith("light");
    });
    unmount();
    expect(remove).toHaveBeenCalled();
  });

  it("shows a retryable error when the library doesn't load", async () => {
    const actor = userEvent.setup();
    stubScripts("error");
    render(
      <TradingViewChart
        instrumentKey={KEY}
        timeframe="M1"
        datafeedPath="/datafeeds/udf/dist/missing.js"
        summary="Chart"
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("The chart library didn't load");
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
  });
});
