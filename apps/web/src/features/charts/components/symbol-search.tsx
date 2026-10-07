"use client";

import { MARKET_INDEX_KEYS } from "@finlytics/shared";
import type { Instrument } from "@finlytics/shared";
import { LoaderCircle, Search, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useEffect, useId, useState } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { useInstrumentSearch } from "@/features/watchlists/hooks/use-watchlists";

import {
  closeButtonClasses,
  dialogClasses,
  dialogHeaderClasses,
  focusRing,
  overlayClasses,
  usePortalContainer,
} from "./ui";

/** One row of the results: a search hit or a popular index. */
export interface SymbolOption {
  key: string;
  symbol: string;
  description: string;
  exchange: string;
  segment: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

function describe(instrument: Instrument): string {
  if (instrument.segment !== "OPT" && instrument.segment !== "FUT") return instrument.name;
  const [year = "", month = "", day = ""] = (instrument.expiry ?? "").split("-");
  const expiry =
    instrument.expiry === null ? "" : `${String(Number(day))} ${MONTHS[Number(month) - 1] ?? ""} ${year.slice(2)}`;
  const contract = instrument.segment === "OPT" ? `${instrument.strike ?? ""} ${instrument.optionType ?? ""}` : "FUT";
  return `${instrument.symbol} ${expiry} ${contract}`.replace(/\s+/g, " ").trim();
}

export function toOption(instrument: Instrument): SymbolOption {
  return {
    key: instrument.key,
    symbol: instrument.tradingSymbol ?? instrument.symbol,
    description: describe(instrument),
    exchange: instrument.exchange,
    segment: instrument.segment,
  };
}

const INDEX_NAMES: Readonly<Record<string, string>> = {
  NIFTY: "Nifty 50",
  BANKNIFTY: "Nifty Bank",
  FINNIFTY: "Nifty Financial Services",
  MIDCPNIFTY: "Nifty Midcap Select",
  NIFTYNXT50: "Nifty Next 50",
  NIFTYIT: "Nifty IT",
  INDIAVIX: "India VIX",
  SENSEX: "S&P BSE Sensex",
  BANKEX: "S&P BSE Bankex",
};

/** The always-streamed indices, for the empty state and an empty search. */
export const POPULAR: readonly SymbolOption[] = Object.entries(MARKET_INDEX_KEYS).map(([id, key]) => ({
  key,
  symbol: key.split("|")[1] ?? id,
  description: INDEX_NAMES[id] ?? id,
  exchange: key.startsWith("BSE") ? "BSE" : "NSE",
  segment: "INDEX",
}));

const FILTERS = [
  { value: "ALL", label: "All" },
  { value: "INDEX", label: "Indices" },
  { value: "EQ", label: "Stocks" },
  { value: "FUT", label: "Futures" },
  { value: "OPT", label: "Options" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];

const DEBOUNCE_MS = 200;

function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [value]);
  return debounced;
}

export interface SymbolSearchProps {
  /** The combobox's accessible name. */
  label: string;
  initialQuery?: string | undefined;
  currentKey?: string | undefined;
  onSelect: (option: SymbolOption) => void;
  /** `dialog`: the results always show; `inline`: they show under the field while it has text. */
  variant?: "dialog" | "inline" | undefined;
  className?: string | undefined;
}

/**
 * Symbol search (ARIA 1.2 combobox over `GET /v1/instruments?q=`): arrows move through the results, Enter opens
 * one, the type filters narrow them. With an empty query the dialog lists the popular indices.
 */
export function SymbolSearch({
  label,
  initialQuery = "",
  currentKey,
  onSelect,
  variant = "dialog",
  className,
}: SymbolSearchProps) {
  const id = useId();
  const listboxId = `${id}-listbox`;
  const [text, setText] = useState(initialQuery);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim());
  const search = useInstrumentSearch(query);
  const typing = text.trim() !== "";

  const hits = query === "" ? [] : (search.data ?? []).map(toOption);
  const pool = typing ? hits : variant === "dialog" ? [...POPULAR] : [];
  const results = filter === "ALL" ? pool : pool.filter((option) => option.segment === filter);
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const activeOption = results[activeIndex];
  const optionId = (index: number) => `${id}-option-${String(index)}`;
  const showList = variant === "dialog" || typing;

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((activeIndex + step + results.length) % results.length);
    } else if (event.key === "Enter" && activeOption !== undefined) {
      event.preventDefault();
      onSelect(activeOption);
    } else if (event.key === "Escape" && variant === "inline" && text !== "") {
      event.preventDefault();
      setText("");
    }
  };

  const searching = typing && (text.trim() !== query || search.isFetching);
  let status: string | null = null;
  if (typing && results.length === 0) {
    if (searching || search.isPending) status = "Searching…";
    else if (search.isError) status = "Search didn't work. Keep typing to try again.";
    else status = `No symbols match “${query}”${filter === "ALL" ? "" : " in this filter"}.`;
  }

  return (
    <div data-slot="symbol-search" className={cn("flex min-h-0 flex-col", className)}>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
        />
        <input
          role="combobox"
          aria-label={label}
          aria-expanded={showList && results.length > 0}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={showList && activeOption !== undefined ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Search NIFTY, RELIANCE, BANKNIFTY 24000 CE…"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={cn(
            "h-10 w-full min-w-0 rounded-md border border-border-strong bg-surface-2 pr-9 pl-9 text-sm text-fg uppercase",
            "transition-[background-color] placeholder:text-fg-muted placeholder:normal-case hover:bg-surface-3",
            focusRing,
          )}
        />
        {searching ? (
          <LoaderCircle
            aria-hidden="true"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted motion-safe:animate-spin"
          />
        ) : null}
      </div>
      {showList ? (
        <>
          <div role="group" aria-label="Instrument type" className="mt-3 flex flex-wrap gap-1">
            {FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value);
                  setActive(0);
                }}
                className={cn(
                  "h-7 cursor-pointer rounded-md bg-surface-2 px-2.5 text-xs font-medium text-fg-muted transition-[color,background-color]",
                  "hover:bg-surface-3 hover:text-fg aria-pressed:bg-primary aria-pressed:text-primary-fg",
                  focusRing,
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          {typing ? null : (
            <p className="mt-3 text-xs font-medium tracking-wide text-fg-muted uppercase">Popular indices</p>
          )}
          <div
            id={listboxId}
            role="listbox"
            aria-label={`${label}: results`}
            className={cn(
              "mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain",
              variant === "inline" && "max-h-72 rounded-md border border-border bg-surface-1 p-1",
              variant === "inline" && results.length === 0 && "hidden",
            )}
          >
            {results.map((option, index) => (
              <div
                key={option.key}
                id={optionId(index)}
                role="option"
                aria-selected={index === activeIndex}
                tabIndex={-1}
                data-slot="symbol-option"
                onMouseDown={(event) => {
                  // The field keeps focus; picking happens before it could blur.
                  event.preventDefault();
                  onSelect(option);
                }}
                onMouseMove={() => {
                  if (index !== activeIndex) setActive(index);
                }}
                className={cn(
                  "flex h-11 cursor-pointer items-center gap-3 rounded-md px-3 text-sm",
                  index === activeIndex && "bg-surface-2",
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate font-semibold text-fg">{option.symbol}</span>
                    {option.key === currentKey ? <span className="text-xs text-primary">On chart</span> : null}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">{option.description}</span>
                </span>
                <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
                  {option.segment}
                </span>
                <span className="w-9 shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-center text-[11px] font-semibold text-fg">
                  {option.exchange}
                </span>
              </div>
            ))}
          </div>
          {status === null ? null : (
            <p role="status" className="px-1 py-6 text-center text-sm text-fg-muted">
              {status}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

export interface SymbolSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialQuery: string;
  currentKey: string;
  onSelect: (option: SymbolOption) => void;
}

/** The toolbar's symbol search, also opened by typing on the chart. */
export function SymbolSearchDialog({
  open,
  onOpenChange,
  initialQuery,
  currentKey,
  onSelect,
}: SymbolSearchDialogProps) {
  const container = usePortalContainer();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          data-slot="symbol-search-dialog"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // The search field takes focus at once (the dialog may open on a keystroke, as TradingView's does).
            event.preventDefault();
            const content = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
            content?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus();
          }}
          className={cn(dialogClasses, "h-[min(36rem,calc(100dvh-2rem))] max-w-xl")}
        >
          <div className={dialogHeaderClasses}>
            <Dialog.Title className="text-base font-semibold">Symbol search</Dialog.Title>
            <Dialog.Close aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          {open ? (
            <SymbolSearch
              label="Search symbols"
              initialQuery={initialQuery}
              currentKey={currentKey}
              onSelect={(option) => {
                onSelect(option);
                onOpenChange(false);
              }}
              className="min-h-0 flex-1 p-4"
            />
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
