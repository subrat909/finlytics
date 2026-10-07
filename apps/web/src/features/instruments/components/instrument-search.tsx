"use client";

import type { Instrument } from "@finlytics/shared";
import { Check, History, LoaderCircle, Search } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type * as React from "react";

import { Input } from "@finlytics/ui/components/input";
import { cn } from "@finlytics/ui/lib/utils";

import { useInstrumentSearch } from "../hooks/use-instrument-search";
import { accessibleName, displaySymbol, searchDetail } from "../lib/describe";
import { readRecent, rememberRecent } from "../lib/recent";

import { ExchangeBadge, SegmentBadge } from "./instrument-badges";

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
  /** A mutation is in flight: the field keeps focus but ignores picks until it settles. */
  busy?: boolean | undefined;
  className?: string | undefined;
  inputRef?: React.Ref<HTMLInputElement> | undefined;
  /** Described-by text from the caller (a plan-limit error). */
  "aria-describedby"?: string | undefined;
  /** Show recently picked instruments while the field is empty and focused (default true). */
  showRecent?: boolean | undefined;
  /** A key that focuses the field, shown as a hint inside it (the caller wires the key). */
  shortcut?: string | undefined;
  /** `sm` (h-9) for panels and toolbars; `md` (h-10, default) for forms. */
  size?: "sm" | "md" | undefined;
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

/** The symbol with the typed text in bold (matching is case-insensitive). */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toUpperCase();
  const at = needle === "" ? -1 : text.toUpperCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <span className="font-bold">{text.slice(at, at + needle.length)}</span>
      {text.slice(at + needle.length)}
    </>
  );
}

interface OptionProps {
  instrument: Instrument;
  id: string;
  active: boolean;
  added: boolean;
  recent: boolean;
  query: string;
  onPick: () => void;
  onHover: () => void;
}

function InstrumentOption({ instrument, id, active, added, recent, query, onPick, onHover }: OptionProps) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={active}
      aria-disabled={added || undefined}
      aria-label={`${accessibleName(instrument)}${added ? ", added" : ""}`}
      data-slot="instrument-option"
      data-instrument-key={instrument.key}
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-sm px-2.5 py-1.5",
        active && "bg-surface-2",
        added && "cursor-default",
      )}
      // Options take no tab stop (the input keeps focus, aria-activedescendant points here). Picking happens on
      // mousedown, prevented, so the input never blurs and closes the list first.
      tabIndex={-1}
      onMouseDown={(event) => {
        event.preventDefault();
        onPick();
      }}
      onMouseMove={onHover}
    >
      {recent ? <History aria-hidden="true" className="size-3.5 shrink-0 text-fg-muted" /> : null}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-fg">
          <Highlighted text={displaySymbol(instrument)} query={query} />
        </span>
        <span className="block truncate text-xs text-fg-muted">{searchDetail(instrument)}</span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {added ? (
          <span className="mr-1 inline-flex items-center gap-1 text-xs text-fg-muted">
            <Check aria-hidden="true" className="size-3.5 text-profit" />
            Added
          </span>
        ) : null}
        <ExchangeBadge exchange={instrument.exchange} />
        <SegmentBadge segment={instrument.segment} />
      </span>
    </div>
  );
}

/**
 * The instrument search (docs/05 InstrumentSearch): an ARIA 1.2 combobox over `GET /v1/instruments?q=`. Results show
 * the F&O contract, exchange and segment badges, and mark what's already added; with the field empty it offers the
 * recently picked instruments. Arrow keys, Home and End move, Enter picks, Escape closes (then clears), and the active
 * option is announced through `aria-activedescendant`. Searching, error and no-match states show inside the popup.
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
  showRecent = true,
  shortcut,
  size = "md",
}: InstrumentSearchProps) {
  const id = useId();
  const inputId = `${id}-input`;
  const listboxId = `${id}-listbox`;
  const recentLabelId = `${id}-recent`;
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<readonly Instrument[]>([]);
  const query = useDebounced(text.trim(), DEBOUNCE_MS);
  const search = useInstrumentSearch(query);
  const typing = text.trim() !== "";
  const results = query === "" ? [] : (search.data ?? []);
  const showingRecent = !typing && showRecent && recent.length > 0;
  const options: readonly Instrument[] = typing ? results : showingRecent ? recent : [];
  const expanded = open && (typing || showingRecent);
  const activeIndex = Math.min(active, Math.max(options.length - 1, 0));
  const activeOption = expanded ? options[activeIndex] : undefined;
  const optionId = (index: number) => `${id}-option-${String(index)}`;

  const choose = (instrument: Instrument | undefined) => {
    if (instrument === undefined || busy || disabledKeys?.has(instrument.key)) return;
    onSelect(instrument);
    setRecent(rememberRecent(instrument));
    setText("");
    setOpen(false);
    setActive(0);
  };

  const move = (next: number) => {
    setOpen(true);
    setActive(options.length === 0 ? 0 : (next + options.length) % options.length);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        move(expanded ? activeIndex + 1 : activeIndex);
        break;
      case "ArrowUp":
        event.preventDefault();
        move(expanded ? activeIndex - 1 : activeIndex);
        break;
      case "Home":
      case "End":
        if (!expanded || options.length === 0) return;
        event.preventDefault();
        setActive(event.key === "Home" ? 0 : options.length - 1);
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

  const searching = typing && (text.trim() !== query || search.isFetching);
  let status: React.ReactNode = null;
  if (expanded && typing && results.length === 0) {
    if (searching || search.isPending) status = "Searching…";
    else if (search.isError) status = "Search didn't work. Keep typing to try again.";
    else status = `No instruments match “${query}”.`;
  }

  const renderOption = (instrument: Instrument, index: number) => (
    <InstrumentOption
      key={instrument.key}
      instrument={instrument}
      id={optionId(index)}
      active={index === activeIndex}
      added={disabledKeys?.has(instrument.key) ?? false}
      recent={showingRecent}
      query={typing ? query : ""}
      onPick={() => {
        choose(instrument);
      }}
      onHover={() => {
        if (index !== activeIndex) setActive(index);
      }}
    />
  );

  const popupClasses =
    "absolute top-full right-0 left-0 z-30 mt-1 rounded-md border border-border bg-surface-1 text-fg";

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
          aria-busy={busy ? true : undefined}
          aria-keyshortcuts={shortcut}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn("pr-9 pl-9", size === "sm" && "h-9 text-[13px]")}
          value={text}
          readOnly={busy}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => {
            setRecent(readRecent());
            setOpen(true);
          }}
          onBlur={() => {
            setOpen(false);
          }}
          onKeyDown={onKeyDown}
        />
        {searching || busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-fg-muted motion-safe:animate-spin"
          />
        ) : shortcut !== undefined && text === "" ? (
          <kbd
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 right-2.5 inline-flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-sm border border-border px-1 font-mono text-[11px] text-fg-muted"
          >
            {shortcut}
          </kbd>
        ) : null}
      </div>
      <div
        id={listboxId}
        role="listbox"
        aria-label={showingRecent ? `${label}: recent` : `${label}: results`}
        hidden={!expanded || options.length === 0}
        className={cn(popupClasses, "max-h-80 overflow-y-auto overscroll-contain p-1")}
      >
        {showingRecent ? (
          <div role="group" aria-labelledby={recentLabelId}>
            <div
              id={recentLabelId}
              role="presentation"
              className="px-2.5 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-fg-muted uppercase"
            >
              Recent
            </div>
            {options.map(renderOption)}
          </div>
        ) : (
          options.map(renderOption)
        )}
      </div>
      {status !== null ? (
        <p role="status" className={cn(popupClasses, "px-3 py-3 text-sm text-fg-muted")}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
