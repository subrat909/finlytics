"use client";

import { ListPlus, Plus, Search, Star } from "lucide-react";
import { Tabs } from "radix-ui";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";

import { Toaster } from "@/components/toaster";
import { useIsClient } from "@/hooks/use-is-client";
import { InstrumentSearch } from "@/features/instruments/components/instrument-search";
import { displaySymbol } from "@/features/instruments/lib/describe";
import { FeedStatus } from "@/features/realtime/components/feed-status";
import { SimulatedBadge } from "@/features/realtime/components/simulated-badge";
import { useQuoteSeed } from "@/features/realtime/hooks/use-quote-seed";
import { useSubscribe } from "@/features/realtime/hooks/use-realtime";
import { isApiError } from "@/lib/api/client";
import { announce } from "@/stores/announcer.store";
import { toast } from "@/stores/toast.store";

import { watchlistErrorMessage } from "../errors";
import { DESKTOP_QUERY, useDebouncedValue, useMediaQuery } from "../hooks/use-media-query";
import {
  useAddWatchlistItem,
  useCreateWatchlist,
  useDeleteWatchlist,
  useRemoveWatchlistItem,
  useRenameWatchlist,
  useReorderWatchlistItems,
  useWatchlists,
} from "../hooks/use-watchlists";
import { isEditableTarget, itemLimitFrom, readActiveList, reorderedIds, writeActiveList } from "../lib/watchlist-lib";
import type { Instrument, Watchlist, WatchlistItem } from "../schemas";

import { DetailSheet } from "./detail-sheet";
import { InstrumentDetail } from "./instrument-detail";
import { DeleteWatchlistDialog, WatchlistNameDialog } from "./watchlist-dialogs";
import { WatchlistMenu, WatchlistTabs } from "./watchlist-tabs";
import { InstrumentDetailSkeleton, WatchlistsSkeleton } from "./watchlists-skeleton";
import { WatchlistTable } from "./watchlist-table";

const EMPTY_ITEMS: readonly WatchlistItem[] = [];
/** Keyboard browsing settles before the detail panel (depth stream, candles) follows. */
const DETAIL_DEBOUNCE_MS = 120;

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-4 items-center justify-center rounded-sm border border-border px-1 font-mono text-[10px] text-fg-muted">
      {children}
    </kbd>
  );
}

interface WatchlistPanelProps {
  watchlist: Watchlist;
  selectedKey: string | undefined;
  depthKey: string | undefined;
  itemLimit: number | undefined;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onLimit: (limit: number) => void;
  onSelect: (item: WatchlistItem, source: "pointer" | "keyboard") => void;
  onOpen: (item: WatchlistItem) => void;
  onToggleDepth: (item: WatchlistItem) => void;
  onRemove: (item: WatchlistItem, next: WatchlistItem | undefined) => void;
  onAdded: (instrument: Instrument) => void;
}

/**
 * The open list: the search that adds to it, its live rows and the footer. Subscribes to its instruments while it's
 * the open tab and seeds them from `GET /v1/quotes`, so prices show at once (and when the market is closed).
 */
function WatchlistPanel({
  watchlist,
  selectedKey,
  depthKey,
  itemLimit,
  searchRef,
  onLimit,
  onSelect,
  onOpen,
  onToggleDepth,
  onRemove,
  onAdded,
}: WatchlistPanelProps) {
  const addItem = useAddWatchlistItem();
  const { mutate: reorder } = useReorderWatchlistItems();
  const addErrorId = useId();
  const { items } = watchlist;
  const keys = useMemo(() => items.map((item) => item.instrumentKey), [items]);
  const keySet = useMemo(() => new Set(keys), [keys]);
  useSubscribe(keys);
  useQuoteSeed(keys);

  const add = (instrument: Instrument) => {
    addItem.mutate(
      { watchlistId: watchlist.id, instrument },
      {
        onSuccess: () => {
          announce(`Added ${displaySymbol(instrument)} to ${watchlist.name}.`);
          onAdded(instrument);
        },
        onError: (error) => {
          const limit = itemLimitFrom(isApiError(error) ? error.detail : undefined);
          if (limit !== undefined) onLimit(limit);
        },
      },
    );
  };

  const onMoveTo = (item: WatchlistItem, to: number) => {
    const from = items.findIndex((candidate) => candidate.id === item.id);
    if (from < 0 || to === from || to < 0 || to >= items.length) return;
    reorder(
      { watchlistId: watchlist.id, itemIds: reorderedIds(items, from, to) },
      { onError: (error) => toast.error("The order didn't save", watchlistErrorMessage(error, "Try again.")) },
    );
    announce(`Moved ${displaySymbol(item.instrument)} to position ${String(to + 1)} of ${String(items.length)}.`);
  };

  const addError = addItem.isError
    ? watchlistErrorMessage(addItem.error, "That instrument wasn't added. Try again.")
    : undefined;
  const count = items.length;

  return (
    <>
      <div className="shrink-0 space-y-2 border-b border-border p-2" data-slot="watchlist-search">
        <InstrumentSearch
          inputRef={searchRef}
          label={`Add to ${watchlist.name}`}
          hideLabel
          size="sm"
          shortcut="/"
          placeholder="Search & add: infy, nifty 24000 ce…"
          onSelect={add}
          disabledKeys={keySet}
          busy={addItem.isPending}
          aria-describedby={addError ? addErrorId : undefined}
        />
        {addError ? (
          <p
            id={addErrorId}
            role="alert"
            data-slot="watchlist-add-error"
            data-code={isApiError(addItem.error) ? addItem.error.code : undefined}
            className="rounded-sm bg-loss/10 px-3 py-2 text-xs text-fg"
          >
            {addError}
          </p>
        ) : null}
      </div>
      {count === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
          <EmptyState
            id={`${watchlist.id}-empty`}
            size="inline"
            headingLevel={2}
            icon={<Star className="text-highlight" />}
            title={
              <>
                Add your first symbol <span aria-hidden="true">⭐</span>
              </>
            }
            description="Search an index, a stock or an option. Prices, depth and the chart update live."
            action={
              <Button
                size="sm"
                onClick={() => {
                  searchRef.current?.focus();
                }}
              >
                <Search aria-hidden="true" />
                Search to add
              </Button>
            }
          />
        </div>
      ) : (
        <WatchlistTable
          name={watchlist.name}
          items={items}
          selectedKey={selectedKey}
          depthKey={depthKey}
          onSelect={onSelect}
          onOpen={onOpen}
          onToggleDepth={onToggleDepth}
          onRemove={onRemove}
          onMoveTo={onMoveTo}
        />
      )}
      <footer
        data-slot="watchlist-footer"
        className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-[11px] text-fg-muted"
      >
        <span className="tabular">
          {itemLimit === undefined
            ? `${String(count)} instrument${count === 1 ? "" : "s"}`
            : `${String(count)} / ${String(itemLimit)} instruments`}
        </span>
        <span aria-hidden="true" className="hidden items-center gap-1 pointer-fine:sm:flex">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> select · <Kbd>↵</Kbd> details · <Kbd>D</Kbd> depth · <Kbd>Del</Kbd> remove
        </span>
      </footer>
    </>
  );
}

type NameDialog = { mode: "create" } | { mode: "rename"; watchlist: Watchlist } | null;

/**
 * The watchlist terminal (docs/05 Watchlists, plan phase-1b W): a list panel (numbered tabs, search to add, dense live
 * rows with hover and keyboard actions, footer) and, from 1024 px, the selected instrument's detail panel (quote,
 * statistics, market depth, intraday chart); below 1024 px the detail opens in a sheet. Every state: shaped skeleton,
 * empty with a CTA, error with retry. Render inside `TerminalPage`.
 */
export function WatchlistsView() {
  const lists = useWatchlists();
  // Render what the server did (the skeleton) until hydration is over, even if the query already finished.
  const hydrated = useIsClient();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const create = useCreateWatchlist();
  const rename = useRenameWatchlist();
  const removeList = useDeleteWatchlist();
  const { mutate: removeItem } = useRemoveWatchlistItem();
  const [activeId, setActiveId] = useState<string | undefined>(readActiveList);
  const [selection, setSelection] = useState<Readonly<Record<string, string>>>({});
  const [depthKey, setDepthKey] = useState<string | undefined>(undefined);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [deleting, setDeleting] = useState<Watchlist | null>(null);
  const [itemLimit, setItemLimit] = useState<number | undefined>(undefined);
  const searchRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Enter on a row (desktop): focus the detail heading once the panel shows that instrument. */
  const focusDetail = useRef<string | undefined>(undefined);

  const data = lists.data;
  const active = data?.find((list) => list.id === activeId) ?? data?.[0];
  const items = active?.items ?? EMPTY_ITEMS;
  const selectedItem = items.find((item) => item.instrumentKey === selection[active?.id ?? ""]) ?? items[0];
  const openDepthKey = items.some((item) => item.instrumentKey === depthKey) ? depthKey : undefined;
  const detailInstrument = useDebouncedValue(selectedItem?.instrument, DETAIL_DEBOUNCE_MS);
  const ready = hydrated && data !== undefined;
  const failed = lists.isError && data === undefined;

  useEffect(() => {
    if (focusDetail.current === undefined || detailInstrument?.key !== focusDetail.current) return;
    focusDetail.current = undefined;
    headingRef.current?.focus();
  });

  // "/" focuses the search (not while typing, and not under a dialog).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableTarget(event.target) || document.querySelector('[role="dialog"], [role="alertdialog"]')) return;
      const input = searchRef.current;
      if (input === null) return;
      event.preventDefault();
      input.focus();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const select = useCallback(
    (item: WatchlistItem, source: "pointer" | "keyboard") => {
      if (active === undefined) return;
      setSelection((current) => ({ ...current, [active.id]: item.instrumentKey }));
      if (source === "pointer" && !isDesktop) setSheetOpen(true);
    },
    [active, isDesktop],
  );

  const open = useCallback(
    (item: WatchlistItem) => {
      if (active === undefined) return;
      setSelection((current) => ({ ...current, [active.id]: item.instrumentKey }));
      if (isDesktop) focusDetail.current = item.instrumentKey;
      else setSheetOpen(true);
    },
    [active, isDesktop],
  );

  const toggleDepth = useCallback((item: WatchlistItem) => {
    setDepthKey((current) => (current === item.instrumentKey ? undefined : item.instrumentKey));
  }, []);

  const removeInstrument = useCallback(
    (item: WatchlistItem, next: WatchlistItem | undefined) => {
      if (active === undefined) return;
      const symbol = displaySymbol(item.instrument);
      if (next !== undefined) setSelection((current) => ({ ...current, [active.id]: next.instrumentKey }));
      else if (active.items.length <= 1) {
        setSheetOpen(false);
        searchRef.current?.focus();
      }
      removeItem(
        { watchlistId: active.id, itemId: item.id },
        {
          onSuccess: () => {
            announce(`Removed ${symbol} from ${active.name}.`);
          },
          onError: (error) => toast.error(`Couldn't remove ${symbol}`, watchlistErrorMessage(error, "Try again.")),
        },
      );
    },
    [active, removeItem],
  );

  const removeSelected =
    active === undefined || selectedItem === undefined
      ? undefined
      : () => {
          const index = active.items.findIndex((item) => item.id === selectedItem.id);
          removeInstrument(selectedItem, active.items[index + 1] ?? active.items[index - 1]);
        };
  const removeLabel =
    active === undefined || selectedItem === undefined
      ? undefined
      : `Remove ${displaySymbol(selectedItem.instrument)} from ${active.name}`;

  const switchList = (id: string) => {
    setActiveId(id);
    writeActiveList(id);
    setDepthKey(undefined);
  };

  const submitName = async (name: string) => {
    try {
      if (nameDialog?.mode === "rename") {
        await rename.mutateAsync({ id: nameDialog.watchlist.id, name });
        announce(`Renamed to ${name}.`);
      } else {
        const created = await create.mutateAsync(name);
        switchList(created.id);
        announce(`Created ${name}.`);
      }
      setNameDialog(null);
    } catch (error) {
      throw new Error(watchlistErrorMessage(error, "That didn't save. Try again."), { cause: error });
    }
  };

  const openCreate = () => {
    setNameDialog({ mode: "create" });
  };

  let body: React.ReactNode;
  if (failed) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <ErrorState
          size="inline"
          title="Your watchlists didn't load"
          description="The Finlytics service didn't answer. Try again in a moment."
          reference={isApiError(lists.error) ? lists.error.requestId : undefined}
          onRetry={async () => {
            await lists.refetch({ throwOnError: true });
          }}
        />
      </div>
    );
  } else if (!ready) {
    body = (
      <div role="status" aria-label="Loading watchlists" className="flex min-h-0 flex-1 flex-col">
        <WatchlistsSkeleton />
      </div>
    );
  } else if (active === undefined) {
    body = (
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto">
        <EmptyState
          id="watchlists-empty"
          size="inline"
          icon={<ListPlus className="text-highlight" />}
          title={
            <>
              Create your first watchlist <span aria-hidden="true">⭐</span>
            </>
          }
          description="Group the instruments you follow and watch them update live, with depth and a chart for each."
          action={
            <Button size="sm" onClick={openCreate}>
              <Plus aria-hidden="true" />
              New watchlist
            </Button>
          }
        />
      </div>
    );
  } else {
    body = (
      <Tabs.Root value={active.id} onValueChange={switchList} className="flex min-h-0 flex-1 flex-col">
        <WatchlistTabs lists={data} activeId={active.id} onCreate={openCreate} />
        <Tabs.Content
          value={active.id}
          className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <WatchlistPanel
            watchlist={active}
            selectedKey={selectedItem?.instrumentKey}
            depthKey={openDepthKey}
            itemLimit={itemLimit}
            searchRef={searchRef}
            onLimit={setItemLimit}
            onSelect={select}
            onOpen={open}
            onToggleDepth={toggleDepth}
            onRemove={removeInstrument}
            onAdded={(instrument) => {
              setSelection((current) => ({ ...current, [active.id]: instrument.key }));
            }}
          />
        </Tabs.Content>
      </Tabs.Root>
    );
  }

  let detail: React.ReactNode;
  if (!isDesktop || (!ready && !failed)) {
    detail = <InstrumentDetailSkeleton />;
  } else if (detailInstrument === undefined || selectedItem === undefined) {
    detail = (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <EmptyState
          size="inline"
          icon={<Search className="text-highlight" />}
          title="Pick an instrument"
          description={
            failed
              ? "Details show here once your watchlists load."
              : "Search and add instruments on the left: the quote, market depth and an intraday chart show here."
          }
        />
      </div>
    );
  } else {
    detail = (
      <InstrumentDetail
        key={detailInstrument.key}
        instrument={detailInstrument}
        headingRef={headingRef}
        onRemove={detailInstrument.key === selectedItem.instrumentKey ? removeSelected : undefined}
        removeLabel={removeLabel}
      />
    );
  }

  return (
    <>
      <section
        aria-labelledby="watchlists-title"
        data-slot="watchlist-panel"
        className="flex min-h-0 w-full flex-col bg-surface-1 lg:w-[360px] lg:shrink-0 lg:rounded-sm lg:border lg:border-border"
      >
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border px-3">
          <h1 id="watchlists-title" className="truncate text-sm font-semibold text-fg">
            Watchlists
          </h1>
          <div className="flex shrink-0 items-center gap-1.5">
            <SimulatedBadge />
            <FeedStatus compact />
            {ready ? (
              <WatchlistMenu
                active={active}
                onCreate={openCreate}
                onRename={(watchlist) => {
                  setNameDialog({ mode: "rename", watchlist });
                }}
                onDelete={setDeleting}
              />
            ) : null}
          </div>
        </header>
        {body}
      </section>
      <section
        aria-label="Instrument details"
        data-slot="watchlist-detail"
        className="hidden min-w-0 flex-1 flex-col overflow-hidden rounded-sm border border-border bg-surface-1 lg:flex"
      >
        {detail}
      </section>
      {hydrated && !isDesktop ? (
        <DetailSheet
          instrument={selectedItem?.instrument}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          onRemove={removeSelected}
          removeLabel={removeLabel}
        />
      ) : null}
      <WatchlistNameDialog
        open={nameDialog !== null}
        onOpenChange={(next) => {
          if (!next) setNameDialog(null);
        }}
        mode={nameDialog?.mode ?? "create"}
        defaultName={nameDialog?.mode === "rename" ? nameDialog.watchlist.name : undefined}
        onSubmit={submitName}
      />
      <DeleteWatchlistDialog
        open={deleting !== null}
        onOpenChange={(next) => {
          if (!next) setDeleting(null);
        }}
        name={deleting?.name ?? ""}
        count={deleting?.items.length ?? 0}
        onConfirm={() => {
          if (deleting === null) return;
          const { id, name } = deleting;
          removeList.mutate(id, {
            onSuccess: () => {
              announce(`Deleted ${name}.`);
            },
            onError: (error) => toast.error(`Couldn't delete “${name}”`, watchlistErrorMessage(error, "Try again.")),
          });
          if (id === active?.id) setActiveId(undefined);
        }}
      />
      <Toaster />
    </>
  );
}
