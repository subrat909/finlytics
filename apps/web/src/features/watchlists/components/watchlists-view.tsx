"use client";

import { Pencil, Plus, Star, Trash2 } from "lucide-react";
import { Tabs } from "radix-ui";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { EmptyState } from "@finlytics/ui/components/empty-state";
import { ErrorState } from "@finlytics/ui/components/error-state";
import { cn } from "@finlytics/ui/lib/utils";

import { Toaster } from "@/components/toaster";
import { useIsClient } from "@/hooks/use-is-client";
import { FeedStatus } from "@/features/realtime/components/feed-status";
import { useQuoteSeed } from "@/features/realtime/hooks/use-quote-seed";
import { useSubscribe } from "@/features/realtime/hooks/use-realtime";
import { isApiError } from "@/lib/api/client";
import { announce } from "@/stores/announcer.store";
import { toast } from "@/stores/toast.store";

import { watchlistErrorMessage } from "../errors";
import {
  useAddWatchlistItem,
  useCreateWatchlist,
  useDeleteWatchlist,
  useRemoveWatchlistItem,
  useRenameWatchlist,
  useReorderWatchlistItems,
  useWatchlists,
} from "../hooks/use-watchlists";
import { symbolOf } from "../schemas";
import type { Instrument, Watchlist, WatchlistItem } from "../schemas";

import { InstrumentSearch } from "./instrument-search";
import { DeleteWatchlistDialog, WatchlistNameDialog } from "./watchlist-dialogs";
import { WatchlistsSkeleton } from "./watchlists-skeleton";
import { WatchlistTable } from "./watchlist-table";

const tabClasses = cn(
  "inline-flex h-9 shrink-0 cursor-pointer items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap text-fg-muted",
  "transition-[color,background-color] hover:bg-surface-2 hover:text-fg data-[state=active]:bg-surface-2 data-[state=active]:text-fg",
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
);

/** Focuses an element after React has committed and the browser has laid it out. */
function focusLater(id: string) {
  requestAnimationFrame(() => {
    document.getElementById(id)?.focus();
  });
}

interface WatchlistPanelProps {
  watchlist: Watchlist;
}

/**
 * One watchlist: add through the search, live rows, remove and reorder. Subscribes to its instruments while it's the
 * open tab (Radix mounts only the active panel) and seeds them from `GET /v1/quotes` so prices show at once.
 */
function WatchlistPanel({ watchlist }: WatchlistPanelProps) {
  const addItem = useAddWatchlistItem();
  const { mutate: removeItem } = useRemoveWatchlistItem();
  const { mutate: reorder } = useReorderWatchlistItems();
  const searchRef = useRef<HTMLInputElement>(null);
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
          announce(`Added ${instrument.symbol} to ${watchlist.name}.`);
        },
      },
    );
  };

  // Stable across ticks (items change only when the list does), so the memoised rows keep their props.
  const onMove = useCallback(
    (item: WatchlistItem, offset: -1 | 1) => {
      const from = items.findIndex((candidate) => candidate.id === item.id);
      const to = from + offset;
      if (from < 0 || to < 0 || to >= items.length) return;
      const ids = items.map((candidate) => candidate.id);
      [ids[from], ids[to]] = [ids[to] ?? item.id, ids[from] ?? item.id];
      reorder(
        { watchlistId: watchlist.id, itemIds: ids },
        {
          onError: (error) => toast.error("The order didn't save", watchlistErrorMessage(error, "Try again.")),
        },
      );
      announce(`Moved ${symbolOf(item)} to position ${String(to + 1)} of ${String(items.length)}.`);
      // The row's node moves; keep the keyboard where it was (or on the other arrow at either end).
      const edge = to === 0 || to === items.length - 1;
      focusLater(`${item.id}-${edge ? (offset < 0 ? "down" : "up") : offset < 0 ? "up" : "down"}`);
    },
    [items, reorder, watchlist.id],
  );
  const onRemove = useCallback(
    (item: WatchlistItem) => {
      removeItem(
        { watchlistId: watchlist.id, itemId: item.id },
        {
          onSuccess: () => {
            announce(`Removed ${symbolOf(item)}.`);
          },
          onError: (error) =>
            toast.error(`Couldn't remove ${symbolOf(item)}`, watchlistErrorMessage(error, "Try again.")),
        },
      );
      searchRef.current?.focus();
    },
    [removeItem, watchlist.id],
  );

  const addError = addItem.isError
    ? watchlistErrorMessage(addItem.error, "That instrument wasn't added. Try again.")
    : undefined;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <InstrumentSearch
          inputRef={searchRef}
          label={`Add to ${watchlist.name}`}
          hideLabel
          onSelect={add}
          disabledKeys={keySet}
          busy={addItem.isPending}
          className="sm:max-w-md"
          aria-describedby={addError ? addErrorId : undefined}
        />
        {addError ? (
          <p
            id={addErrorId}
            role="alert"
            data-slot="watchlist-add-error"
            data-code={isApiError(addItem.error) ? addItem.error.code : undefined}
            className="rounded-md bg-loss/10 px-3 py-2 text-sm text-fg sm:max-w-md"
          >
            {addError}
          </p>
        ) : null}
      </div>
      {items.length === 0 ? (
        <section aria-labelledby={`${watchlist.id}-empty`} className="rounded-md bg-surface-1">
          <EmptyState
            id={`${watchlist.id}-empty`}
            headingLevel={2}
            icon={<Star className="text-highlight" />}
            title={
              <>
                Add your first symbol <span aria-hidden="true">⭐</span>
              </>
            }
            description="Search an index, a stock or an option above. Prices update live."
            action={
              <Button
                onClick={() => {
                  searchRef.current?.focus();
                }}
              >
                <Plus aria-hidden="true" />
                Add a symbol
              </Button>
            }
          />
        </section>
      ) : (
        <WatchlistTable name={watchlist.name} items={items} onMove={onMove} onRemove={onRemove} />
      )}
    </div>
  );
}

type NameDialog = { mode: "create" } | { mode: "rename"; watchlist: Watchlist } | null;

/**
 * The watchlists page body (docs/05 Watchlists): a tab per list (create, rename, delete), the open list's live rows,
 * and every state: loading skeleton, empty with a CTA, error with retry.
 */
export function WatchlistsView() {
  const lists = useWatchlists();
  // Render what the server did (the skeleton) until hydration is over, even if the query already finished.
  const hydrated = useIsClient();
  const create = useCreateWatchlist();
  const rename = useRenameWatchlist();
  const remove = useDeleteWatchlist();
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [nameDialog, setNameDialog] = useState<NameDialog>(null);
  const [deleting, setDeleting] = useState<Watchlist | null>(null);

  const data = lists.data;
  const active = data?.find((list) => list.id === selected) ?? data?.[0];

  const submitName = async (name: string) => {
    try {
      if (nameDialog?.mode === "rename") {
        await rename.mutateAsync({ id: nameDialog.watchlist.id, name });
        announce(`Renamed to ${name}.`);
      } else {
        const created = await create.mutateAsync(name);
        setSelected(created.id);
        announce(`Created ${name}.`);
      }
      setNameDialog(null);
    } catch (error) {
      throw new Error(watchlistErrorMessage(error, "That didn't save. Try again."), { cause: error });
    }
  };

  let body: React.ReactNode;
  if (!hydrated || lists.isPending) {
    body = (
      <div role="status" aria-label="Loading watchlists">
        <WatchlistsSkeleton />
      </div>
    );
  } else if (lists.isError) {
    body = (
      <section className="rounded-md bg-surface-1">
        <ErrorState
          title="Your watchlists didn't load"
          description="The Finlytics service didn't answer. Try again in a moment."
          reference={isApiError(lists.error) ? lists.error.requestId : undefined}
          onRetry={async () => {
            await lists.refetch({ throwOnError: true });
          }}
        />
      </section>
    );
  } else if (active === undefined) {
    body = (
      <section aria-labelledby="watchlists-empty" className="rounded-md bg-surface-1">
        <EmptyState
          id="watchlists-empty"
          icon={<Star className="text-highlight" />}
          title={
            <>
              Create your first watchlist <span aria-hidden="true">⭐</span>
            </>
          }
          description="Group the instruments you follow and watch them update live."
          action={
            <Button
              onClick={() => {
                setNameDialog({ mode: "create" });
              }}
            >
              <Plus aria-hidden="true" />
              New watchlist
            </Button>
          }
        />
      </section>
    );
  } else {
    body = (
      <Tabs.Root value={active.id} onValueChange={setSelected} className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Tabs.List aria-label="Watchlists" className="flex min-w-0 flex-1 gap-1 overflow-x-auto p-0.5">
            {data?.map((list) => (
              <Tabs.Trigger key={list.id} value={list.id} className={tabClasses} data-slot="watchlist-tab">
                {list.name}
                <span aria-hidden="true" className="rounded-full bg-surface-3 px-1.5 text-xs tabular text-fg-muted">
                  {list.items.length}
                </span>
                <span className="sr-only">{`, ${String(list.items.length)} instruments`}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <div className="flex items-center gap-1">
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="New watchlist"
              onClick={() => {
                setNameDialog({ mode: "create" });
              }}
            >
              <Plus aria-hidden="true" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Rename ${active.name}`}
              onClick={() => {
                setNameDialog({ mode: "rename", watchlist: active });
              }}
            >
              <Pencil aria-hidden="true" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-loss"
              aria-label={`Delete ${active.name}`}
              onClick={() => {
                setDeleting(active);
              }}
            >
              <Trash2 aria-hidden="true" />
            </Button>
          </div>
        </div>
        <Tabs.Content
          value={active.id}
          className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        >
          <WatchlistPanel watchlist={active} />
        </Tabs.Content>
      </Tabs.Root>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-fg">Watchlists</h1>
          <p className="text-sm text-fg-muted">Your symbols with live prices.</p>
        </div>
        <FeedStatus />
      </div>
      {body}
      <WatchlistNameDialog
        open={nameDialog !== null}
        onOpenChange={(open) => {
          if (!open) setNameDialog(null);
        }}
        mode={nameDialog?.mode ?? "create"}
        defaultName={nameDialog?.mode === "rename" ? nameDialog.watchlist.name : undefined}
        onSubmit={submitName}
      />
      <DeleteWatchlistDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        name={deleting?.name ?? ""}
        count={deleting?.items.length ?? 0}
        onConfirm={() => {
          if (deleting === null) return;
          const { id, name } = deleting;
          remove.mutate(id, {
            onSuccess: () => {
              announce(`Deleted ${name}.`);
            },
            onError: (error) => toast.error(`Couldn't delete “${name}”`, watchlistErrorMessage(error, "Try again.")),
          });
          setSelected(undefined);
        }}
      />
      <Toaster />
    </>
  );
}
