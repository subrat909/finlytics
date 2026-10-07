import type { Instrument } from "@finlytics/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { InstrumentSearch } from "../components/instrument-search";
import { MAX_RECENT, RECENT_STORAGE_KEY, clearRecent, readRecent, rememberRecent } from "../lib/recent";

function instrument(symbol: string, overrides: Partial<Instrument> = {}): Instrument {
  return {
    key: `NSE_EQ|${symbol}`,
    exchange: "NSE",
    segment: "EQ",
    symbol,
    tradingSymbol: symbol,
    name: `${symbol} Ltd`,
    expiry: null,
    strike: null,
    optionType: null,
    lotSize: 1,
    tickSize: "0.05",
    isActive: true,
    ...overrides,
  };
}

const INFY = instrument("INFY");
const NIFTY_CE = instrument("NIFTY", {
  key: "NSE_FO|NIFTY|2025-10-30|24000|CE",
  exchange: "NFO",
  segment: "OPT",
  name: "NIFTY",
  expiry: "2025-10-30",
  strike: "24000",
  optionType: "CE",
  lotSize: 75,
});

describe("recent instruments", () => {
  it("keeps the latest picks first, once each, at most eight, and survives bad storage", () => {
    expect(readRecent()).toEqual([]);
    rememberRecent(INFY);
    rememberRecent(NIFTY_CE);
    expect(rememberRecent(INFY).map((item) => item.key)).toEqual([INFY.key, NIFTY_CE.key]);
    for (let index = 0; index < 12; index += 1) rememberRecent(instrument(`S${String(index)}`));
    expect(readRecent()).toHaveLength(MAX_RECENT);
    localStorage.setItem(RECENT_STORAGE_KEY, "{not json");
    expect(readRecent()).toEqual([]);
    localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify([{ key: 1 }]));
    expect(readRecent()).toEqual([]);
    clearRecent();
    expect(localStorage.getItem(RECENT_STORAGE_KEY)).toBeNull();
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(rememberRecent(INFY)).toEqual([INFY]);
    setItem.mockRestore();
  });
});

describe("InstrumentSearch", () => {
  it("shows contract details and badges, picks with the keyboard and remembers the pick", async () => {
    const actor = userEvent.setup();
    const onSelect = vi.fn();
    mockApi([{ path: /^\/v1\/instruments\?q=nif/, respond: () => Response.json([NIFTY_CE, INFY]) }]);
    const { container } = renderWithProviders(
      <InstrumentSearch label="Add to Core" onSelect={onSelect} disabledKeys={new Set([INFY.key])} shortcut="/" />,
    );
    const combobox = screen.getByRole("combobox", { name: "Add to Core" });
    expect(combobox).toHaveAttribute("aria-keyshortcuts", "/");
    await actor.type(combobox, "nif");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveAccessibleName("NIFTY 24000 CE, call, expiry 30 Oct 2025, NFO");
    expect(options[0]).toHaveTextContent("NIFTY 24000 CE");
    expect(options[0]).toHaveTextContent("Expiry 30 Oct 2025 · Lot 75");
    expect(within(options[0] as HTMLElement).getByText("NFO")).toBeInTheDocument();
    expect(within(options[0] as HTMLElement).getByText("OPT")).toBeInTheDocument();
    expect(options[1]).toHaveAttribute("aria-disabled", "true");
    expect(within(options[1] as HTMLElement).getByText("Added")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    await actor.keyboard("{End}");
    expect(combobox).toHaveAttribute("aria-activedescendant", options[1]?.id);
    await actor.keyboard("{Enter}"); // already added: nothing happens
    expect(onSelect).not.toHaveBeenCalled();
    await actor.keyboard("{Home}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(NIFTY_CE);
    expect(combobox).toHaveValue("");
    expect(readRecent()).toEqual([NIFTY_CE]);
  });

  it("offers recent picks when the field is empty", async () => {
    const actor = userEvent.setup();
    const onSelect = vi.fn();
    rememberRecent(INFY);
    rememberRecent(NIFTY_CE);
    mockApi([]);
    const { container } = renderWithProviders(<InstrumentSearch label="Open a chart" onSelect={onSelect} />);
    await actor.click(screen.getByRole("combobox", { name: "Open a chart" }));
    const listbox = screen.getByRole("listbox", { name: "Open a chart: recent" });
    const group = within(listbox).getByRole("group", { name: "Recent" });
    expect(
      within(group)
        .getAllByRole("option")
        .map((option) => option.getAttribute("data-instrument-key")),
    ).toEqual([NIFTY_CE.key, INFY.key]);
    await expectNoAxeViolations(container);
    await actor.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith(INFY);
  });

  it("hides recents when asked, explains no matches and closes with Escape, then clears", async () => {
    const actor = userEvent.setup();
    rememberRecent(INFY);
    mockApi([{ path: /^\/v1\/instruments\?q=zzz/, respond: () => Response.json([]) }]);
    renderWithProviders(<InstrumentSearch label="Search" onSelect={vi.fn()} showRecent={false} size="sm" />);
    const combobox = screen.getByRole("combobox", { name: "Search" });
    await actor.click(combobox);
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    await actor.type(combobox, "zzz");
    expect(await screen.findByText("No instruments match “zzz”.")).toBeInTheDocument();
    await actor.keyboard("{Escape}");
    expect(combobox).toHaveAttribute("aria-expanded", "false");
    await actor.keyboard("{Escape}");
    expect(combobox).toHaveValue("");
  });

  it("keeps focus but ignores picks while busy", async () => {
    const actor = userEvent.setup();
    const onSelect = vi.fn();
    rememberRecent(INFY);
    mockApi([]);
    renderWithProviders(<InstrumentSearch label="Search" onSelect={onSelect} busy />);
    const combobox = screen.getByRole("combobox", { name: "Search" });
    await actor.click(combobox);
    expect(combobox).toHaveFocus();
    expect(combobox).toHaveAttribute("aria-busy", "true");
    await actor.keyboard("{Enter}");
    await waitFor(() => {
      expect(onSelect).not.toHaveBeenCalled();
    });
  });

  it("says when the search failed", async () => {
    const actor = userEvent.setup();
    mockApi([{ path: /^\/v1\/instruments/, respond: () => new Response("nope", { status: 500 }) }]);
    renderWithProviders(<InstrumentSearch label="Search" onSelect={vi.fn()} />);
    await actor.type(screen.getByRole("combobox", { name: "Search" }), "x");
    expect(await screen.findByText("Search didn't work. Keep typing to try again.")).toBeInTheDocument();
  });
});
