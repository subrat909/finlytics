import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { marketActions, useMarketStore } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock, router } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";
import { toast } from "@/stores/toast.store";

import { WatchlistsView } from "../components/watchlists-view";
import { DESKTOP_QUERY } from "../hooks/use-media-query";
import { describeInstrument } from "../schemas";
import type { Watchlist } from "../schemas";

import { NIFTY_CE, instrument, watchlist } from "./fixtures";

const chartMocks = vi.hoisted(() => {
  const series = { setData: vi.fn(), update: vi.fn(), applyOptions: vi.fn(), createPriceLine: vi.fn() };
  const chart = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    remove: vi.fn(),
    timeScale: vi.fn(() => ({ fitContent: vi.fn() })),
  };
  return { chart, series, createChart: vi.fn(() => chart) };
});

vi.mock("lightweight-charts", () => ({
  createChart: chartMocks.createChart,
  BaselineSeries: "Baseline",
  ColorType: { Solid: "solid" },
  CrosshairMode: { Magnet: 1 },
  LineStyle: { Dashed: 2 },
}));
vi.mock("next/navigation", () => nextNavigationMock);

const RELIANCE = instrument("RELIANCE");
const INFY = instrument("INFY");
const TCS = instrument("TCS");
const CORE = watchlist("wl1", "Core", [RELIANCE, INFY, TCS]);
const OPTIONS = watchlist("wl2", "Options", [], 1);
const QUOTES = {
  [RELIANCE.key]: {
    ltp: "2950.5",
    chg: "12.5",
    chgPct: "0.43",
    ts: Date.now(),
    open: "2940",
    high: "2960",
    low: "2930",
    close: "2938",
    atp: "2948.2",
    vol: "1234567",
  },
  [INFY.key]: { ltp: "1500", chg: "-3.5", chgPct: "-0.23", ts: Date.now() },
};
const DEPTH = {
  k: INFY.key,
  t: 5,
  bids: [
    ["1499.9", 300, 6],
    ["1499.85", 120, 2],
  ],
  asks: [["1500.1", 150, 3]],
  tbq: 90_000,
  tsq: 60_000,
};

// The virtualiser measures its scroll box; jsdom has no layout.
const descriptors = {
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetHeight"),
  offsetWidth: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth"),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "offsetHeight", { configurable: true, get: () => 600 });
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", { configurable: true, get: () => 1024 });
});
afterAll(() => {
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(HTMLElement.prototype, name, descriptor);
  }
});

const originalMatchMedia = window.matchMedia.bind(window);
/** Renders as a 1024 px+ screen: the detail panel instead of the sheet. */
function asDesktop() {
  window.matchMedia = (query: string) => Object.assign(originalMatchMedia(query), { matches: query === DESKTOP_QUERY });
}

beforeEach(() => {
  marketActions.reset();
  act(() => {
    toast.clear();
  });
});
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function listsRoute(lists: unknown) {
  return { path: "/v1/watchlists", respond: () => Response.json(lists) };
}
const quotesRoute = { path: /^\/v1\/quotes\?keys=/, respond: () => Response.json(QUOTES) };
const depthRoute = {
  path: /^\/v1\/quotes\/depth\?key=/,
  respond: ({ path }: { path: string }) =>
    path.endsWith(encodeURIComponent(INFY.key)) ? Response.json(DEPTH) : problem(404, "NOT_FOUND"),
};
const candlesRoute = { path: /^\/v1\/candles\?/, respond: () => Response.json([]) };

/** The server's view after a reorder or removal: the same items (ids kept), in a new order. */
function reordered(list: Watchlist, indexes: number[]): Watchlist {
  return {
    ...list,
    items: indexes.flatMap((index, position) => {
      const item = list.items[index];
      return item === undefined ? [] : [{ ...item, position }];
    }),
  };
}

function rowList(name = "Core") {
  return screen.getByRole("list", { name: `Instruments in ${name}` });
}

function order(name = "Core") {
  return within(rowList(name))
    .getAllByRole("listitem")
    .map((row) => row.getAttribute("data-instrument-key"));
}

describe("WatchlistsView", () => {
  it("shows a skeleton, then numbered tabs and the open list's live rows", async () => {
    const calls = mockApi([listsRoute([CORE, OPTIONS]), quotesRoute]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(screen.getByRole("heading", { level: 1, name: "Watchlists" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading watchlists" })).toBeInTheDocument();

    const tabs = await screen.findByRole("tablist", { name: "Watchlists" });
    const tabList = within(tabs).getAllByRole("tab");
    expect(tabList.map((tab) => tab.textContent)).toEqual(["1Core, 3 instruments", "2Options, 0 instruments"]);
    expect(tabList[0]).toHaveAccessibleName("Core, 3 instruments");
    expect(tabList[0]).toHaveAttribute("aria-selected", "true");

    const rows = within(rowList()).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[0]).toHaveAttribute("aria-setsize", "3");
    const first = within(rows[0] as HTMLElement).getByRole("button", { name: "RELIANCE, NSE" });
    expect(first).toHaveAttribute("aria-current", "true");
    expect(first).toHaveAttribute("tabindex", "0");
    expect(within(rows[1] as HTMLElement).getByRole("button", { name: "INFY, NSE" })).toHaveAttribute("tabindex", "-1");
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "Chart RELIANCE" })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent(RELIANCE.key)}`,
    );
    // Seeded from GET /v1/quotes (one request for the list's keys).
    expect(await within(rows[0] as HTMLElement).findByText("2,950.50")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("-0.23%")).toBeInTheDocument();
    expect(calls.filter((call) => call.path.startsWith("/v1/quotes"))).toHaveLength(1);
    expect(useMarketStore.getState().ticks.size).toBe(2);
    expect(screen.getByText("3 instruments")).toBeInTheDocument();
    await expectNoAxeViolations(container);
  });

  it("shows the empty state, and creates the first watchlist through the dialog", async () => {
    const actor = userEvent.setup();
    let lists: unknown[] = [];
    const calls = mockApi([
      { path: "/v1/watchlists", respond: () => Response.json(lists) },
      {
        method: "POST",
        path: "/v1/watchlists",
        respond: () => {
          lists = [watchlist("wl9", "Momentum", [])];
          return Response.json(lists[0], { status: 201 });
        },
      },
    ]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(await screen.findByRole("heading", { name: /Create your first watchlist/ })).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await actor.click(screen.getByRole("button", { name: "New watchlist" }));
    const dialog = screen.getByRole("dialog", { name: "New watchlist" });
    await actor.click(within(dialog).getByRole("button", { name: "Create watchlist" }));
    expect(within(dialog).getByText("Give the watchlist a name")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
    await actor.type(within(dialog).getByLabelText("Name"), "Momentum");
    await actor.click(within(dialog).getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByRole("tab", { name: /Momentum/ })).toHaveAttribute("aria-selected", "true");
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Momentum" });
    expect(screen.getByRole("heading", { name: /Add your first symbol/ })).toBeInTheDocument();
    expect(localStorage.getItem("finlytics:watchlists:active")).toBe("wl9");
  });

  it("shows the plan limit when another watchlist isn't allowed", async () => {
    const actor = userEvent.setup();
    mockApi([
      listsRoute([CORE]),
      quotesRoute,
      {
        method: "POST",
        path: "/v1/watchlists",
        respond: () => problem(403, "FORBIDDEN", { detail: "Your plan allows 3 watchlists." }),
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("button", { name: "New watchlist" }));
    const dialog = screen.getByRole("dialog", { name: "New watchlist" });
    await actor.type(within(dialog).getByLabelText("Name"), "Fourth");
    await actor.click(within(dialog).getByRole("button", { name: "Create watchlist" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Your plan allows 3 watchlists.");
  });

  it("shows a retryable error", async () => {
    const actor = userEvent.setup();
    let fail = true;
    mockApi([
      { path: "/v1/watchlists", respond: () => (fail ? problem(503, "SERVICE_UNAVAILABLE") : Response.json([CORE])) },
      quotesRoute,
    ]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Your watchlists didn't load");
    await expectNoAxeViolations(container);
    fail = false;
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("tab", { name: /Core/ })).toBeInTheDocument();
  });

  it("adds an instrument from the search with the keyboard and selects it", async () => {
    const actor = userEvent.setup();
    let lists = [OPTIONS];
    const calls = mockApi([
      { path: "/v1/watchlists", respond: () => Response.json(lists) },
      quotesRoute,
      { path: /^\/v1\/instruments\?q=nifty/, respond: () => Response.json([NIFTY_CE, RELIANCE]) },
      {
        method: "POST",
        path: "/v1/watchlists/wl2/items",
        respond: () => {
          lists = [watchlist("wl2", "Options", [RELIANCE, NIFTY_CE], 1)];
          return Response.json({}, { status: 201 });
        },
      },
    ]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(await screen.findByRole("heading", { name: /Add your first symbol/ })).toBeInTheDocument();

    const combobox = screen.getByRole("combobox", { name: "Add to Options" });
    await actor.click(screen.getByRole("button", { name: "Search to add" }));
    expect(combobox).toHaveFocus();
    await actor.type(combobox, "nifty");
    const listbox = await screen.findByRole("listbox");
    const options = await within(listbox).findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    await expectNoAxeViolations(container);

    await actor.keyboard("{ArrowDown}{ArrowUp}");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[0]?.id);
    await actor.keyboard("{Enter}");
    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({ instrumentKey: NIFTY_CE.key });
    });
    expect(combobox).toHaveValue("");
    expect(await screen.findByRole("list", { name: "Instruments in Options" })).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "NIFTY 24000 CE, call, expiry 30 Oct 2025, NFO" }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("shows the plan's item limit from problem+json when adding fails, and in the footer", async () => {
    const actor = userEvent.setup();
    mockApi([
      listsRoute([CORE]),
      quotesRoute,
      { path: /^\/v1\/instruments\?q=/, respond: () => Response.json([RELIANCE, NIFTY_CE]) },
      {
        method: "POST",
        path: "/v1/watchlists/wl1/items",
        respond: () => problem(403, "FORBIDDEN", { detail: "Your plan allows 50 instruments per watchlist." }),
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    const combobox = await screen.findByRole("combobox", { name: "Add to Core" });
    await actor.type(combobox, "rel");
    const options = await screen.findAllByRole("option");
    // Already in the list: shown, not selectable.
    expect(options[0]).toHaveAttribute("aria-disabled", "true");
    await actor.click(options[0] as HTMLElement);
    expect(combobox).toHaveValue("rel");
    await actor.click(options[1] as HTMLElement);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your plan allows 50 instruments per watchlist.");
    expect(alert).toHaveAttribute("data-code", "FORBIDDEN");
    expect(combobox).toHaveAccessibleDescription("Your plan allows 50 instruments per watchlist.");
    expect(screen.getByText("3 / 50 instruments")).toBeInTheDocument();
  });

  it("moves through the rows with the keyboard, reorders with Alt+arrows and removes with Delete", async () => {
    const actor = userEvent.setup();
    let lists = [CORE];
    const calls = mockApi([
      { path: "/v1/watchlists", respond: () => Response.json(lists) },
      quotesRoute,
      {
        method: "PUT",
        path: "/v1/watchlists/wl1/items/order",
        respond: () => {
          lists = [reordered(CORE, [1, 0, 2])];
          return Response.json({});
        },
      },
      {
        method: "DELETE",
        path: "/v1/watchlists/wl1/items/wl1-item-2",
        respond: () => {
          lists = [reordered(CORE, [1, 0])];
          return new Response(null, { status: 204 });
        },
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    const reliance = await screen.findByRole("button", { name: "RELIANCE, NSE" });
    act(() => {
      reliance.focus();
    });
    await actor.keyboard("{ArrowDown}");
    const infy = screen.getByRole("button", { name: "INFY, NSE" });
    expect(infy).toHaveFocus();
    expect(infy).toHaveAttribute("aria-current", "true");
    expect(reliance).toHaveAttribute("tabindex", "-1");
    await actor.keyboard("{End}");
    expect(screen.getByRole("button", { name: "TCS, NSE" })).toHaveFocus();
    await actor.keyboard("{Home}");
    expect(reliance).toHaveFocus();

    await actor.keyboard("{Alt>}{ArrowDown}{/Alt}");
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        itemIds: ["wl1-item-1", "wl1-item-0", "wl1-item-2"],
      });
    });
    await waitFor(() => {
      expect(order()).toEqual([INFY.key, RELIANCE.key, TCS.key]);
    });
    expect(screen.getByRole("button", { name: "RELIANCE, NSE" })).toHaveFocus();
    await actor.keyboard("{Alt>}{ArrowUp}{ArrowUp}{/Alt}"); // the second is past the top: ignored

    await actor.keyboard("{End}{Delete}");
    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
    // The row before the removed last one takes the selection and the focus.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "RELIANCE, NSE" })).toHaveFocus();
    });
  });

  it("reorders by drag and drop", async () => {
    const calls = mockApi([
      listsRoute([CORE]),
      quotesRoute,
      { method: "PUT", path: "/v1/watchlists/wl1/items/order", respond: () => Response.json({}) },
    ]);
    renderWithProviders(<WatchlistsView />);
    await screen.findByRole("button", { name: "RELIANCE, NSE" });
    const rows = within(rowList()).getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(rows[0] as HTMLElement, { dataTransfer });
    expect(rows[0]).toHaveAttribute("data-dragging", "true");
    expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", RELIANCE.key);
    fireEvent.dragOver(rows[2] as HTMLElement, { dataTransfer });
    expect(rows[2]).toHaveAttribute("data-drop", "before");
    fireEvent.drop(rows[2] as HTMLElement, { dataTransfer });
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        itemIds: ["wl1-item-1", "wl1-item-0", "wl1-item-2"],
      });
    });
    fireEvent.dragEnd(rows[0] as HTMLElement);
    expect(within(rowList()).getAllByRole("listitem")[0]).not.toHaveAttribute("data-dragging");
  });

  it("restores the order and says so when saving it fails", async () => {
    const actor = userEvent.setup();
    mockApi([
      listsRoute([CORE]),
      quotesRoute,
      { method: "PUT", path: "/v1/watchlists/wl1/items/order", respond: () => problem(500, "INTERNAL") },
    ]);
    renderWithProviders(<WatchlistsView />);
    const reliance = await screen.findByRole("button", { name: "RELIANCE, NSE" });
    act(() => {
      reliance.focus();
    });
    await actor.keyboard("{Alt>}{ArrowDown}{/Alt}");
    expect(await screen.findByText("The order didn't save")).toBeInTheDocument();
    await waitFor(() => {
      expect(order()).toEqual([RELIANCE.key, INFY.key, TCS.key]);
    });
  });

  it("opens market depth under a row with D or its button, and closes it with Escape", async () => {
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE]), quotesRoute, depthRoute]);
    const { container } = renderWithProviders(<WatchlistsView />);
    const reliance = await screen.findByRole("button", { name: "RELIANCE, NSE" });
    act(() => {
      reliance.focus();
    });
    await actor.keyboard("{ArrowDown}d");
    const toggle = screen.getByRole("button", { name: "Market depth for INFY" });
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const table = await screen.findByRole("table", { name: /Market depth for INFY/ });
    const levels = within(table).getAllByRole("row");
    expect(levels[1]).toHaveTextContent("1,499.906300");
    expect(table).toHaveTextContent("90,000");
    expect(screen.getByText("Buy 60.0%")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await actor.keyboard("{Escape}");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("table")).toBeNull();

    await actor.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    await actor.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("opens the chart with C and focuses the search with /", async () => {
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE]), quotesRoute]);
    renderWithProviders(<WatchlistsView />);
    const reliance = await screen.findByRole("button", { name: "RELIANCE, NSE" });
    act(() => {
      reliance.focus();
    });
    await actor.keyboard("c");
    expect(router.push).toHaveBeenCalledWith(`/charts?key=${encodeURIComponent(RELIANCE.key)}`);
    act(() => {
      reliance.blur();
    });
    await actor.keyboard("/");
    expect(screen.getByRole("combobox", { name: "Add to Core" })).toHaveFocus();
  });

  it("opens the details in a sheet on small screens, with remove and close", async () => {
    const actor = userEvent.setup();
    const calls = mockApi([
      listsRoute([CORE]),
      quotesRoute,
      depthRoute,
      candlesRoute,
      {
        method: "DELETE",
        path: "/v1/watchlists/wl1/items/wl1-item-1",
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("button", { name: "INFY, NSE" }));
    const sheet = await screen.findByRole("dialog", { name: "INFY" });
    expect(within(sheet).getByRole("link", { name: "Open chart" })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent(INFY.key)}`,
    );
    expect(await within(sheet).findByRole("table", { name: /Market depth for INFY/ })).toBeInTheDocument();
    await actor.click(within(sheet).getByRole("button", { name: "Close details" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    await actor.click(screen.getByRole("button", { name: "INFY, NSE" }));
    await actor.click(await screen.findByRole("button", { name: "Remove INFY from Core" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
  });

  it("shows the selected instrument beside the list on large screens; Enter focuses it", async () => {
    asDesktop();
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE]), quotesRoute, depthRoute, candlesRoute]);
    const { container } = renderWithProviders(<WatchlistsView />);
    const detail = await screen.findByRole("article", { name: "RELIANCE" });
    expect(within(detail).getByText("Prev close").nextElementSibling).toHaveTextContent("2,938.00");
    expect(within(detail).getByText("Volume").nextElementSibling).toHaveTextContent("12.3 L");
    expect(within(detail).getByText("RELIANCE Ltd")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await expectNoAxeViolations(container);

    act(() => {
      screen.getByRole("button", { name: "RELIANCE, NSE" }).focus();
    });
    await actor.keyboard("{ArrowDown}{Enter}");
    const heading = await screen.findByRole("heading", { level: 2, name: "INFY" });
    await waitFor(() => {
      expect(heading).toHaveFocus();
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renames and deletes the open list from its menu", async () => {
    const actor = userEvent.setup();
    let lists = [CORE, OPTIONS];
    const calls = mockApi([
      { path: "/v1/watchlists", respond: () => Response.json(lists) },
      quotesRoute,
      {
        method: "PATCH",
        path: "/v1/watchlists/wl1",
        respond: () => {
          lists = [{ ...CORE, name: "Largecaps" }, OPTIONS];
          return Response.json(lists[0]);
        },
      },
      {
        method: "DELETE",
        path: "/v1/watchlists/wl1",
        respond: () => {
          lists = [OPTIONS];
          return new Response(null, { status: 204 });
        },
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("button", { name: "Watchlist actions" }));
    await actor.click(screen.getByRole("menuitem", { name: "Rename “Core”" }));
    const dialog = screen.getByRole("dialog", { name: "Rename watchlist" });
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Core");
    await actor.clear(name);
    await actor.type(name, "Largecaps");
    await actor.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("tab", { name: /Largecaps/ })).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Largecaps" });

    await actor.click(screen.getByRole("button", { name: "Watchlist actions" }));
    await actor.click(screen.getByRole("menuitem", { name: "Delete “Largecaps”" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete “Largecaps”?" });
    expect(confirm).toHaveTextContent("Its 3 instruments go with it.");
    await actor.click(within(confirm).getByRole("button", { name: "Delete watchlist" }));
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Largecaps/ })).toBeNull();
    });
    expect(screen.getByRole("tab", { name: /Options/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches lists with the tabs and remembers the open one", async () => {
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE, OPTIONS]), quotesRoute]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("tab", { name: /Options/ }));
    expect(screen.getByRole("combobox", { name: "Add to Options" })).toBeInTheDocument();
    expect(localStorage.getItem("finlytics:watchlists:active")).toBe("wl2");
  });
});

describe("describeInstrument", () => {
  it("names equities by company and derivatives by contract", () => {
    expect(describeInstrument(RELIANCE)).toBe("NSE · RELIANCE Ltd");
    expect(describeInstrument(NIFTY_CE)).toBe("NFO · 30 Oct 25 24000 CE");
  });
});
