"use client";

import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";
import type { Range } from "@tanstack/react-virtual";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { chartHref, rowButtonId } from "../lib/watchlist-lib";
import type { WatchlistItem } from "../schemas";

import { WatchlistRow } from "./watchlist-row";

export { chartHref } from "../lib/watchlist-lib";

/** Two-line rows (symbol and exchange; price and change); an open depth row is measured once rendered. */
const ROW_ESTIMATE_PX = 44;
const OVERSCAN = 8;
/** PageUp / PageDown move this many rows. */
const PAGE_ROWS = 10;

export interface WatchlistTableProps {
  name: string;
  items: readonly WatchlistItem[];
  /** The selected instrument (the roving tab stop); the first row when undefined or gone. */
  selectedKey: string | undefined;
  /** The row whose depth is open under it. */
  depthKey: string | undefined;
  /** `pointer`: a click or tap (small screens open the details too); `keyboard`: arrow keys, Home, End. */
  onSelect: (item: WatchlistItem, source: "pointer" | "keyboard") => void;
  /** Enter: the details (the sheet on small screens, the panel's heading on large ones). */
  onOpen: (item: WatchlistItem) => void;
  onToggleDepth: (item: WatchlistItem) => void;
  /** `next` is the row that takes the selection (and focus) after it. */
  onRemove: (item: WatchlistItem, next: WatchlistItem | undefined) => void;
  onMoveTo: (item: WatchlistItem, to: number) => void;
}

interface DragState {
  id: string;
  over?: { index: number; after: boolean } | undefined;
}

/**
 * The instruments of one watchlist, virtualised (TanStack Virtual: only the rows in view, a few more and the selected
 * one are in the DOM). A list with one tab stop (roving tabindex): ↑/↓, Home/End and PageUp/PageDown move the
 * selection, Enter opens the details, D toggles market depth, C opens the chart, Delete removes, Alt+↑/↓ moves the
 * instrument; rows also reorder by drag and drop. `aria-setsize`/`aria-posinset` keep the count right while rows out
 * of view aren't rendered.
 */
export function WatchlistTable({
  name,
  items,
  selectedKey,
  depthKey,
  onSelect,
  onOpen,
  onToggleDepth,
  onRemove,
  onMoveTo,
}: WatchlistTableProps) {
  const router = useRouter();
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const found = items.findIndex((item) => item.instrumentKey === selectedKey);
  const selectedIndex = found < 0 ? 0 : found;

  // Handlers read the latest values through refs, so the memoised rows keep stable props across ticks and renders.
  const latest = useRef({ items, depthKey, onSelect, onOpen, onToggleDepth, onRemove, onMoveTo });
  const selectedIndexRef = useRef(selectedIndex);
  /** A row to focus after the next commit (keyboard moves, removals). */
  const pendingFocus = useRef<string | null>(null);
  useLayoutEffect(() => {
    latest.current = { items, depthKey, onSelect, onOpen, onToggleDepth, onRemove, onMoveTo };
    selectedIndexRef.current = selectedIndex;
  });

  // The selected row is always rendered, so the list's tab stop exists wherever the scroll is.
  const rangeExtractor = useCallback((range: Range) => {
    const indexes = defaultRangeExtractor(range);
    const selected = selectedIndexRef.current;
    if (selected < range.count && !indexes.includes(selected)) {
      indexes.push(selected);
      indexes.sort((a, b) => a - b);
    }
    return indexes;
  }, []);

  // eslint-disable-next-line react-hooks/incompatible-library -- the virtualizer is read during render on purpose; rows re-render from its state
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: OVERSCAN,
    getItemKey: (index) => items[index]?.id ?? index,
    rangeExtractor,
    initialRect: { width: 0, height: 600 },
  });
  const totalSize = virtualizer.getTotalSize();

  // The spacer's height is layout, not style: set on the node (frontend.md: no inline styles).
  useLayoutEffect(() => {
    if (innerRef.current) innerRef.current.style.height = `${String(totalSize)}px`;
  }, [totalSize]);

  // Focus follows the keyboard: after the commit that rendered the newly selected row.
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const node = document.getElementById(rowButtonId(id));
    if (node === null) return;
    pendingFocus.current = null;
    node.focus();
  });

  const select = useCallback((item: WatchlistItem) => {
    latest.current.onSelect(item, "pointer");
  }, []);

  const remove = useCallback((item: WatchlistItem, index: number) => {
    const current = latest.current.items;
    const next = current[index + 1] ?? (index > 0 ? current[index - 1] : undefined);
    if (next !== undefined && document.activeElement?.closest('[data-slot="watchlist-row"]')) {
      pendingFocus.current = next.id;
    }
    latest.current.onRemove(item, next);
  }, []);

  const toggleDepth = useCallback((item: WatchlistItem) => {
    latest.current.onToggleDepth(item);
  }, []);

  const onRowKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, item: WatchlistItem, index: number) => {
      const { items: current, depthKey: openDepth, onOpen: open, onMoveTo: moveTo } = latest.current;
      const goTo = (target: number) => {
        event.preventDefault();
        const next = current[Math.min(Math.max(target, 0), current.length - 1)];
        if (next === undefined || next.id === item.id) return;
        pendingFocus.current = next.id;
        latest.current.onSelect(next, "keyboard");
      };
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const to = index + (event.key === "ArrowUp" ? -1 : 1);
        if (to < 0 || to >= current.length) return;
        pendingFocus.current = item.id;
        moveTo(item, to);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      switch (event.key) {
        case "ArrowDown":
          goTo(index + 1);
          break;
        case "ArrowUp":
          goTo(index - 1);
          break;
        case "Home":
          goTo(0);
          break;
        case "End":
          goTo(current.length - 1);
          break;
        case "PageDown":
          goTo(index + PAGE_ROWS);
          break;
        case "PageUp":
          goTo(index - PAGE_ROWS);
          break;
        case "Enter":
          event.preventDefault();
          open(item);
          break;
        case "Delete":
        case "Backspace":
          event.preventDefault();
          remove(item, index);
          break;
        case "d":
        case "D":
          if (item.instrument.segment === "INDEX") return;
          event.preventDefault();
          latest.current.onToggleDepth(item);
          break;
        case "c":
        case "C":
          event.preventDefault();
          router.push(chartHref(item.instrumentKey));
          break;
        case "Escape":
          if (openDepth !== item.instrumentKey) return;
          event.preventDefault();
          latest.current.onToggleDepth(item);
          break;
        default:
          break;
      }
    },
    [remove, router],
  );

  // Drag and drop, delegated to the list (native listeners: one set for every row, removed on unmount).
  const dragRef = useRef<DragState | null>(null);
  useEffect(() => {
    const list = innerRef.current;
    if (list === null) return;
    const rowOf = (target: EventTarget | null) =>
      target instanceof Element ? target.closest<HTMLElement>('[data-slot="watchlist-row"]') : null;
    const update = (next: DragState | null) => {
      dragRef.current = next;
      setDrag(next);
    };
    const onDragStart = (event: DragEvent) => {
      const row = rowOf(event.target);
      const id = row?.dataset.itemId;
      if (row === null || id === undefined || event.dataTransfer === null) return;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.instrumentKey ?? "");
      update({ id });
    };
    const onDragOver = (event: DragEvent) => {
      const current = dragRef.current;
      const row = rowOf(event.target);
      if (current === null || row === null) return;
      event.preventDefault();
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = "move";
      const index = Number(row.dataset.index);
      const rect = row.getBoundingClientRect();
      const after = event.clientY > rect.top + rect.height / 2;
      if (current.over?.index !== index || current.over.after !== after)
        update({ id: current.id, over: { index, after } });
    };
    const onDrop = (event: DragEvent) => {
      const current = dragRef.current;
      if (current === null) return;
      event.preventDefault();
      update(null);
      const { items: rows, onMoveTo: moveTo } = latest.current;
      if (current.over === undefined) return;
      const from = rows.findIndex((item) => item.id === current.id);
      const moved = rows[from];
      let to = current.over.after ? current.over.index + 1 : current.over.index;
      if (from < to) to -= 1;
      if (moved !== undefined && to !== from) moveTo(moved, to);
    };
    const onDragEnd = () => {
      update(null);
    };
    list.addEventListener("dragstart", onDragStart);
    list.addEventListener("dragover", onDragOver);
    list.addEventListener("drop", onDrop);
    list.addEventListener("dragend", onDragEnd);
    return () => {
      list.removeEventListener("dragstart", onDragStart);
      list.removeEventListener("dragover", onDragOver);
      list.removeEventListener("drop", onDrop);
      list.removeEventListener("dragend", onDragEnd);
    };
  }, []);

  return (
    <div ref={scrollRef} data-slot="watchlist-table" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <p id={helpId} className="sr-only">
        Up and down arrows move between instruments. Enter opens the details, D shows market depth, C opens the chart,
        Delete removes. Alt with up or down moves the instrument.
      </p>
      <ul ref={innerRef} aria-label={`Instruments in ${name}`} className="relative w-full">
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index];
          if (item === undefined) return null;
          const over = drag?.over?.index === virtualRow.index ? drag.over : undefined;
          return (
            <li
              key={virtualRow.key}
              data-index={virtualRow.index}
              data-slot="watchlist-row"
              data-instrument-key={item.instrumentKey}
              data-item-id={item.id}
              data-dragging={drag?.id === item.id ? "true" : undefined}
              data-drop={over === undefined ? undefined : over.after ? "after" : "before"}
              aria-setsize={items.length}
              aria-posinset={virtualRow.index + 1}
              ref={(node) => {
                if (node === null) return;
                node.style.transform = `translateY(${String(virtualRow.start)}px)`;
                virtualizer.measureElement(node);
              }}
              draggable
              className={cn(
                "absolute top-0 left-0 w-full data-[dragging=true]:opacity-50",
                "data-[drop]:before:absolute data-[drop]:before:inset-x-2 data-[drop]:before:z-10 data-[drop]:before:h-0.5 data-[drop]:before:rounded-full data-[drop]:before:bg-primary",
                "data-[drop=before]:before:-top-px data-[drop=after]:before:-bottom-px",
              )}
            >
              <WatchlistRow
                item={item}
                index={virtualRow.index}
                focusable={virtualRow.index === selectedIndex}
                selected={virtualRow.index === selectedIndex}
                depthOpen={depthKey === item.instrumentKey}
                helpId={helpId}
                onSelect={select}
                onKeyDown={onRowKeyDown}
                onToggleDepth={toggleDepth}
                onRemove={remove}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
