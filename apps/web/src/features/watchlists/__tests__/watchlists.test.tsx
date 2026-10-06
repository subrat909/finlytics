import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { marketActions, useMarketStore } from "@/features/realtime/store";
import { mockApi, problem } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";
import { toast } from "@/stores/toast.store";

import { WatchlistsView } from "../components/watchlists-view";
import { describeInstrument } from "../schemas";

import { NIFTY_CE, instrument, watchlist } from "./fixtures";

vi.mock("next/navigation", () => nextNavigationMock);

const RELIANCE = instrument("RELIANCE");
const INFY = instrument("INFY");
const TCS = instrument("TCS");
const CORE = watchlist("wl1", "Core", [RELIANCE, INFY, TCS]);
const OPTIONS = watchlist("wl2", "Options", [], 1);
const QUOTES = {
  [RELIANCE.key]: { ltp: "2950.5", chg: "12.5", chgPct: "0.43", ts: Date.now() },
  [INFY.key]: { ltp: "1500", chg: "-3.5", chgPct: "-0.23", ts: Date.now() },
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

beforeEach(() => {
  marketActions.reset();
  act(() => {
    toast.clear();
  });
});

function listsRoute(lists: unknown) {
  return { path: "/v1/watchlists", respond: () => Response.json(lists) };
}
const quotesRoute = { path: /^\/v1\/quotes\?keys=/, respond: () => Response.json(QUOTES) };

describe("WatchlistsView", () => {
  it("shows a skeleton, then a tab per list and the open list's rows with live prices", async () => {
    const calls = mockApi([listsRoute([CORE, OPTIONS]), quotesRoute]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(screen.getByRole("status", { name: "Loading watchlists" })).toBeInTheDocument();

    const tabs = await screen.findByRole("tablist", { name: "Watchlists" });
    expect(
      within(tabs)
        .getAllByRole("tab")
        .map((tab) => tab.textContent),
    ).toEqual(["Core3, 3 instruments", "Options0, 0 instruments"]);
    expect(within(tabs).getByRole("tab", { name: "Core, 3 instruments" })).toHaveAttribute("aria-selected", "true");
    const rows = within(screen.getByRole("list", { name: "Instruments in Core" })).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute("aria-posinset", "1");
    expect(rows[0]).toHaveAttribute("aria-setsize", "3");
    expect(within(rows[0] as HTMLElement).getByRole("link", { name: "RELIANCE, open the chart" })).toHaveAttribute(
      "href",
      `/charts?key=${encodeURIComponent(RELIANCE.key)}`,
    );
    // Seeded from GET /v1/quotes (one request for the list's keys).
    expect(await within(rows[0] as HTMLElement).findByText("2,950.50")).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText("-0.23%")).toBeInTheDocument();
    expect(calls.filter((call) => call.path.startsWith("/v1/quotes"))).toHaveLength(1);
    expect(useMarketStore.getState().ticks.size).toBe(2);
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
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("button", { name: "New watchlist" }));
    const dialog = screen.getByRole("dialog", { name: "New watchlist" });
    await actor.click(within(dialog).getByRole("button", { name: "Create watchlist" }));
    expect(within(dialog).getByText("Give the watchlist a name")).toBeInTheDocument();
    await actor.type(within(dialog).getByLabelText("Name"), "Momentum");
    await actor.click(within(dialog).getByRole("button", { name: "Create watchlist" }));
    expect(await screen.findByRole("tab", { name: /Momentum/ })).toHaveAttribute("aria-selected", "true");
    expect(calls.find((call) => call.method === "POST")?.body).toEqual({ name: "Momentum" });
    expect(screen.getByRole("heading", { name: /Add your first symbol/ })).toBeInTheDocument();
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

  it("adds an instrument from the search with the keyboard", async () => {
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
          lists = [watchlist("wl2", "Options", [NIFTY_CE], 1)];
          return Response.json({}, { status: 201 });
        },
      },
    ]);
    const { container } = renderWithProviders(<WatchlistsView />);
    expect(await screen.findByRole("heading", { name: /Add your first symbol/ })).toBeInTheDocument();

    const combobox = screen.getByRole("combobox", { name: "Add to Options" });
    await actor.click(screen.getByRole("button", { name: "Add a symbol" }));
    expect(combobox).toHaveFocus();
    await actor.type(combobox, "nifty");
    const listbox = await screen.findByRole("listbox");
    const options = await within(listbox).findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(combobox).toHaveAttribute("aria-expanded", "true");
    expect(within(options[0] as HTMLElement).getByText("NFO · 30 Oct 25 24000 CE")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await actor.keyboard("{ArrowDown}{ArrowUp}");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[0]?.id);
    await actor.keyboard("{Enter}");
    await waitFor(() => {
      expect(calls.find((call) => call.method === "POST")?.body).toEqual({ instrumentKey: NIFTY_CE.key });
    });
    expect(combobox).toHaveValue("");
    expect(await screen.findByRole("list", { name: "Instruments in Options" })).toBeInTheDocument();
  });

  it("shows the plan's item limit from problem+json when adding fails", async () => {
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
    expect(within(options[0] as HTMLElement).getByText("Added")).toBeInTheDocument();
    await actor.click(options[0] as HTMLElement);
    expect(combobox).toHaveValue("rel");
    await actor.click(options[1] as HTMLElement);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your plan allows 50 instruments per watchlist.");
    expect(alert).toHaveAttribute("data-code", "FORBIDDEN");
    expect(combobox).toHaveAccessibleDescription("Your plan allows 50 instruments per watchlist.");
  });

  it("closes the results with Escape and clears with a second Escape", async () => {
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE]), quotesRoute, { path: /^\/v1\/instruments\?q=zzz/, respond: () => Response.json([]) }]);
    renderWithProviders(<WatchlistsView />);
    const combobox = await screen.findByRole("combobox", { name: "Add to Core" });
    await actor.type(combobox, "zzz");
    expect(await screen.findByText("No instruments match “zzz”.")).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    await actor.keyboard("{Escape}");
    expect(combobox).toHaveValue("");
  });

  it("moves rows up and down (saving the order) and removes them", async () => {
    const actor = userEvent.setup();
    let lists = [CORE];
    const calls = mockApi([
      { path: "/v1/watchlists", respond: () => Response.json(lists) },
      quotesRoute,
      {
        method: "PUT",
        path: "/v1/watchlists/wl1/items/order",
        respond: () => {
          lists = [watchlist("wl1", "Core", [INFY, RELIANCE, TCS])];
          return Response.json({});
        },
      },
      {
        method: "DELETE",
        path: "/v1/watchlists/wl1/items/wl1-item-2",
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    renderWithProviders(<WatchlistsView />);
    expect(await screen.findByRole("button", { name: "Move RELIANCE up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move TCS down" })).toBeDisabled();

    await actor.click(screen.getByRole("button", { name: "Move RELIANCE down" }));
    await waitFor(() => {
      expect(calls.find((call) => call.method === "PUT")?.body).toEqual({
        itemIds: ["wl1-item-1", "wl1-item-0", "wl1-item-2"],
      });
    });
    const order = () =>
      within(screen.getByRole("list", { name: "Instruments in Core" }))
        .getAllByRole("listitem")
        .map((row) => row.getAttribute("data-instrument-key"));
    await waitFor(() => {
      expect(order()).toEqual([INFY.key, RELIANCE.key, TCS.key]);
    });

    await actor.click(screen.getByRole("button", { name: "Remove TCS" }));
    await waitFor(() => {
      expect(calls.some((call) => call.method === "DELETE")).toBe(true);
    });
  });

  it("restores the order and says so when saving it fails", async () => {
    const actor = userEvent.setup();
    mockApi([
      listsRoute([CORE]),
      quotesRoute,
      { method: "PUT", path: "/v1/watchlists/wl1/items/order", respond: () => problem(500, "INTERNAL") },
    ]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("button", { name: "Move INFY up" }));
    expect(await screen.findByText("The order didn't save")).toBeInTheDocument();
  });

  it("renames and deletes the open list", async () => {
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
    await actor.click(await screen.findByRole("button", { name: "Rename Core" }));
    const dialog = screen.getByRole("dialog", { name: "Rename watchlist" });
    const name = within(dialog).getByLabelText("Name");
    expect(name).toHaveValue("Core");
    await actor.clear(name);
    await actor.type(name, "Largecaps");
    await actor.click(within(dialog).getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("tab", { name: /Largecaps/ })).toBeInTheDocument();
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({ name: "Largecaps" });

    await actor.click(screen.getByRole("button", { name: "Delete Largecaps" }));
    const confirm = screen.getByRole("alertdialog", { name: "Delete “Largecaps”?" });
    expect(confirm).toHaveTextContent("Its 3 instruments go with it.");
    await actor.click(within(confirm).getByRole("button", { name: "Delete watchlist" }));
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /Largecaps/ })).toBeNull();
    });
    expect(screen.getByRole("tab", { name: /Options/ })).toHaveAttribute("aria-selected", "true");
  });

  it("switches lists with the tabs", async () => {
    const actor = userEvent.setup();
    mockApi([listsRoute([CORE, OPTIONS]), quotesRoute]);
    renderWithProviders(<WatchlistsView />);
    await actor.click(await screen.findByRole("tab", { name: /Options/ }));
    expect(screen.getByRole("combobox", { name: "Add to Options" })).toBeInTheDocument();
  });
});

describe("describeInstrument", () => {
  it("names equities by company and derivatives by contract", () => {
    expect(describeInstrument(RELIANCE)).toBe("NSE · RELIANCE Ltd");
    expect(describeInstrument(NIFTY_CE)).toBe("NFO · 30 Oct 25 24000 CE");
    expect(describeInstrument({ ...NIFTY_CE, segment: "FUT", strike: null, optionType: null })).toBe(
      "NFO · 30 Oct 25 FUT",
    );
  });
});
