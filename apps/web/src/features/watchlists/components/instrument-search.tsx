"use client";

import { LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type * as React from "react";

import { Input } from "@finlytics/ui/components/input";
import { cn } from "@finlytics/ui/lib/utils";

import { useInstrumentSearch } from "../hooks/use-watchlists";
import { describeInstrument } from "../schemas";
import type { Instrument } from "../schemas";

const DEBOUNCE_MS = 200;

export interface InstrumentSearchProps {
  /** The visible label (also the combobox's accessible name). */
  label: string;
  /** Hide the label visually (a toolbar); it stays the accessible name. */
  hideLabel?: boolean | undefined;
  placeholder?: string | undefined;
  onSelect: (instrument: Instrument) => void;
  /** Keys already chosen: listed as "Added" and not selectable. */
  disabledKeys?: ReadonlySet<string> | undefined;
  /** Disables the field (a mutation in flight). */
  busy?: boolean | undefined;
  className?: string | undefined;
  inputRef?: React.Ref<HTMLInputElement> | undefined;
  /** Described-by text from the caller (a plan-limit error). */
  "aria-describedby"?: string | undefined;
}

/** Waits until typing pauses before the value changes (no request per keystroke). */
function useDebounced(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delay);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
  return debounced;
}

/**
 * The instrument search (docs/05 InstrumentSearch): an ARIA 1.2 combobox over `GET /v1/instruments?q=`. Arrow keys
 * move through the results, Enter picks, Escape closes (or clears), and the active option is announced through
 * `aria-activedescendant`. Searching, error and no-match states show inside the popup.
 */
export function InstrumentSearch({
  label,
  hideLabel,
  placeholder = "Search NIFTY, RELIANCE, BANKNIFTY 24000 CE…",
  onSelect,
  disabledKeys,
  busy,
  className,
  inputRef,
  "aria-describedby": describedBy,
}: InstrumentSearchProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = useDebounced(text.trim(), DEBOUNCE_MS);
  const search = useInstrumentSearch(query);
  const results = query === "" ? [] : (search.data ?? []);
  const expanded = open && text.trim() !== "";
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const activeOption = expanded ? results[activeIndex] : undefined;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  const choose = (instrument: Instrument | undefined) => {
    if (instrument === undefined || disabledKeys?.has(instrument.key)) return;
    onSelect(instrument);
    setText("");
    setOpen(false);
    setActive(0);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setOpen(true);
        setActive(results.length === 0 ? 0 : (activeIndex + 1) % results.length);
        break;
      case "ArrowUp":
        event.preventDefault();
        setOpen(true);
        setActive(results.length === 0 ? 0 : (activeIndex - 1 + results.length) % results.length);
        break;
      case "Home":
      case "End":
        if (!expanded || results.length === 0) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : results.length - 1);
        break;
      case "Enter":
        if (!expanded) return;
        event.preventDefault();
        choose(activeOption);
        break;
      case "Escape":
        if (expanded) {
          event.preventDefault();
          setOpen(false);
        } else if (text !== "") {
          event.preventDefault();
          setText("");
        }
        break;
      default:
        break;
    }
  };

  const searching = text.trim() !== query || search.isFetching;
  let status: React.ReactNode = null;
  if (expanded && results.length === 0) {
    if (searching || search.isPending) status = "Searching…";
    else if (search.isError) status = "Search didn't work. Keep typing to try again.";
    else status = `No instruments match “${query}”.`;
  }

  return (
    <div data-slot="instrument-search" className={cn("relative w-full", className)}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : "mb-1.5 block text-sm font-medium text-fg"}>
        {label}
      </label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
        />
        <Input
          ref={inputRef}
          id={inputId}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={activeOption ? optionId(activeIndex) : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className="pr-9 pl-9"
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {expanded && searching ? (
          <LoaderCircle
            aria-hidden="true"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted motion-safe:animate-spin"
          />
        ) : null}
      </div>
      <div
        id={listboxId}
        role="listbox"
        aria-label={`${label}: results`}
        hidden={!expanded}
        className="absolute top-full right-0 left-0 z-30 mt-1 max-h-80 overflow-y-auto overscroll-contain rounded-md bg-surface-1 p-1 ring-1 ring-surface-3"
      >
        {results.map((instrument, index) => {
          const added = disabledKeys?.has(instrument.key) ?? false;
          return (
            <div
              key={instrument.key}
              id={optionId(index)}
              role="option"
              aria-selected={index === activeIndex}
              aria-disabled={added || undefined}
              data-slot="instrument-option"
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm",
                index === activeIndex && "bg-surface-2",
                added && "cursor-default opacity-60",
              )}
              // Options take no tab stop (the input keeps focus, aria-activedescendant points here). Picking happens on
              // mousedown, prevented, so the input never blurs and closes the list first.
              tabIndex={-1}
              onMouseDown={(event) => {
                event.preventDefault();
                choose(instrument);
              }}
              onMouseMove={() => {
                if (index !== activeIndex) setActive(index);
              }}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-fg">{instrument.symbol}</span>
                <span className="block truncate text-xs text-fg-muted">{describeInstrument(instrument)}</span>
              </span>
              <span className="shrink-0 rounded-sm bg-surface-2 px-1.5 py-0.5 text-xs text-fg-muted">
                {added ? "Added" : instrument.segment}
              </span>
            </div>
          );
        })}
      </div>
      {expanded && status !== null ? (
        <p
          role="status"
          className="absolute top-full right-0 left-0 z-30 mt-1 rounded-md bg-surface-1 px-3 py-3 text-sm text-fg-muted ring-1 ring-surface-3"
        >
          {status}
        </p>
      ) : null}
    </div>
  );
}
