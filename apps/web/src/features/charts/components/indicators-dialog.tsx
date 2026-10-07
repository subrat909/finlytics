"use client";

import { Eye, EyeOff, Plus, Search, Settings2, Trash2, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { INDICATOR_LIST, INDICATORS, MAX_INDICATORS, describeInputs } from "../lib/indicators/registry";
import type { IndicatorDefinition } from "../lib/indicators/registry";
import { useWorkspace } from "../store/workspace-store";

import {
  closeButtonClasses,
  dialogClasses,
  dialogHeaderClasses,
  focusRing,
  overlayClasses,
  toolButtonClasses,
  usePortalContainer,
} from "./ui";

const GROUPS = [
  { group: "overlay", title: "On the price chart" },
  { group: "oscillator", title: "In their own pane" },
] as const;

function matches(definition: IndicatorDefinition, query: string): boolean {
  const text = `${definition.name} ${definition.short} ${definition.category} ${definition.description}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "")
    .every((word) => text.includes(word));
}

/** The Indicators dialog: search the catalogue, add any number (each its own copy), manage the ones on the chart. */
export function IndicatorsDialog() {
  const open = useWorkspace((state) => state.dialog === "indicators");
  const openDialog = useWorkspace((state) => state.openDialog);
  const instances = useWorkspace((state) => state.indicators);
  const addIndicator = useWorkspace((state) => state.addIndicator);
  const toggleIndicator = useWorkspace((state) => state.toggleIndicator);
  const removeIndicator = useWorkspace((state) => state.removeIndicator);
  const editIndicator = useWorkspace((state) => state.editIndicator);
  const container = usePortalContainer();
  const [query, setQuery] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const full = instances.length >= MAX_INDICATORS;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        openDialog(next ? "indicators" : null);
        if (!next) {
          setQuery("");
          setAnnouncement("");
        }
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          data-slot="indicators-dialog"
          className={cn(dialogClasses, "h-[min(40rem,calc(100dvh-2rem))] max-w-2xl")}
        >
          <div className={dialogHeaderClasses}>
            <Dialog.Title className="text-base font-semibold">Indicators</Dialog.Title>
            <Dialog.Close aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Search the indicators and add them to the chart. Each one you add is a separate copy with its own settings.
          </Dialog.Description>
          <div className="border-b border-border p-4">
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-muted"
              />
              <input
                type="search"
                aria-label="Search indicators"
                placeholder="Search: RSI, moving average, volume…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
                className={cn(
                  "h-10 w-full rounded-sm border border-border-strong bg-surface-2 pr-3 pl-9 text-sm text-fg",
                  "transition-[background-color] placeholder:text-fg-muted hover:bg-surface-3",
                  focusRing,
                )}
              />
            </div>
            <p aria-live="polite" className="mt-2 min-h-5 text-xs text-fg-muted">
              {full
                ? `A chart holds up to ${String(MAX_INDICATORS)} indicators. Remove one to add another.`
                : announcement}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {instances.length > 0 && query.trim() === "" ? (
              <section aria-labelledby="indicators-active" className="mb-2">
                <h3
                  id="indicators-active"
                  className="px-2 py-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase"
                >
                  On this chart
                </h3>
                <ul>
                  {instances.map((instance) => {
                    const definition = INDICATORS[instance.kind];
                    const params = describeInputs(instance);
                    const name = `${definition.short}${params === "" ? "" : ` ${params}`}`;
                    return (
                      <li key={instance.id} className="flex h-10 items-center gap-2 rounded-sm px-2 hover:bg-surface-2">
                        <span className={cn("min-w-0 flex-1 truncate text-sm", instance.hidden && "text-fg-muted")}>
                          {name}
                        </span>
                        <button
                          type="button"
                          aria-label={instance.hidden ? `Show ${name}` : `Hide ${name}`}
                          className={toolButtonClasses}
                          onClick={() => {
                            toggleIndicator(instance.id);
                          }}
                        >
                          {instance.hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                        </button>
                        <button
                          type="button"
                          aria-label={`${name} settings`}
                          className={toolButtonClasses}
                          onClick={() => {
                            // One dialog at a time: the settings replace the list.
                            openDialog(null);
                            editIndicator(instance.id);
                          }}
                        >
                          <Settings2 aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          aria-label={`Remove ${name}`}
                          className={cn(toolButtonClasses, "hover:text-loss")}
                          onClick={() => {
                            removeIndicator(instance.id);
                            setAnnouncement(`Removed ${name}.`);
                          }}
                        >
                          <Trash2 aria-hidden="true" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}
            {GROUPS.map(({ group, title }) => {
              const list = INDICATOR_LIST.filter(
                (definition) => definition.group === group && matches(definition, query),
              );
              if (list.length === 0) return null;
              return (
                <section key={group} aria-labelledby={`indicators-${group}`} className="mb-2">
                  <h3
                    id={`indicators-${group}`}
                    className="px-2 py-1.5 text-xs font-medium tracking-wide text-fg-muted uppercase"
                  >
                    {title}
                  </h3>
                  <ul>
                    {list.map((definition) => {
                      const count = instances.filter((instance) => instance.kind === definition.kind).length;
                      return (
                        <li key={definition.kind}>
                          <button
                            type="button"
                            disabled={full}
                            data-slot="indicator-option"
                            onClick={() => {
                              const added = addIndicator(definition.kind);
                              if (added !== undefined) setAnnouncement(`Added ${definition.name}.`);
                            }}
                            className={cn(
                              "flex w-full cursor-pointer items-center gap-3 rounded-sm px-2 py-2 text-left transition-[background-color]",
                              "hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50",
                              focusRing,
                            )}
                          >
                            <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-surface-2 text-primary">
                              <Plus aria-hidden="true" className="size-4" />
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-2 text-sm font-medium text-fg">
                                {definition.name}
                                <span className="text-xs font-normal text-fg-muted">{definition.short}</span>
                                {count > 0 ? (
                                  <span className="rounded-sm bg-surface-2 px-1.5 text-[11px] text-fg-muted">
                                    {count} on chart
                                  </span>
                                ) : null}
                              </span>
                              <span className="block truncate text-xs text-fg-muted">
                                {definition.category} · {definition.description}
                              </span>
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              );
            })}
            {GROUPS.every(({ group }) =>
              INDICATOR_LIST.every((definition) => definition.group !== group || !matches(definition, query)),
            ) ? (
              <p className="px-2 py-8 text-center text-sm text-fg-muted">No indicators match “{query}”.</p>
            ) : null}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
