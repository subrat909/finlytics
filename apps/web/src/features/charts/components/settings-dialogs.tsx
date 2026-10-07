"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@finlytics/ui/components/tabs";
import { cn } from "@finlytics/ui/lib/utils";

import { MAX_NOTE_LENGTH } from "../lib/drawings/types";
import { DEFAULT_SETTINGS } from "../schemas";
import type { ChartSettings } from "../schemas";
import { useWorkspace } from "../store/workspace-store";

import { ColorSwatches, FieldRow, LineSample, Segments, SwitchRow } from "./settings-controls";

import {
  closeButtonClasses,
  dialogClasses,
  dialogHeaderClasses,
  focusRing,
  overlayClasses,
  usePortalContainer,
} from "./ui";

function Shell({
  open,
  onOpenChange,
  title,
  description,
  slot,
  wide = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  slot: string;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const container = usePortalContainer();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          data-slot={slot}
          className={cn(dialogClasses, wide ? "h-[min(34rem,calc(100dvh-2rem))] max-w-2xl" : "max-w-md")}
        >
          <div className={dialogHeaderClasses}>
            <Dialog.Title className="text-base font-semibold">{title}</Dialog.Title>
            <Dialog.Close aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">{description}</Dialog.Description>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/**
 * Chart settings, TradingView-style: Symbol (candle colours, borders, wicks, last-price line), Status line (what the
 * legend shows), Scales (side, indicator labels) and Canvas (grid, crosshair, session breaks, watermark). Changes
 * apply at once and persist with the layout.
 */
export function ChartSettingsDialog() {
  const open = useWorkspace((state) => state.dialog === "settings");
  const openDialog = useWorkspace((state) => state.openDialog);
  const settings = useWorkspace((state) => state.settings);
  const setSettings = useWorkspace((state) => state.setSettings);
  const update = (patch: Partial<ChartSettings>) => {
    setSettings({ ...settings, ...patch });
  };
  const switchRow = (label: string, key: BooleanSetting) => (
    <SwitchRow
      label={label}
      checked={settings[key]}
      onChange={(value) => {
        update({ [key]: value });
      }}
    />
  );

  return (
    <Shell
      open={open}
      onOpenChange={(next) => {
        openDialog(next ? "settings" : null);
      }}
      title="Chart settings"
      description="Symbol colours, status line, scales and canvas. Changes apply at once."
      slot="chart-settings-dialog"
      wide
    >
      <Tabs defaultValue="symbol" orientation="vertical" className="flex min-h-0 flex-1 flex-col sm:flex-row">
        <TabsList
          aria-label="Settings sections"
          className="shrink-0 overflow-x-auto border-b border-border px-2 sm:w-40 sm:flex-col sm:items-stretch sm:border-r sm:border-b-0 sm:py-2"
        >
          <TabsTrigger value="symbol">Symbol</TabsTrigger>
          <TabsTrigger value="status">Status line</TabsTrigger>
          <TabsTrigger value="scales">Scales</TabsTrigger>
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
        </TabsList>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TabsContent value="symbol" className="space-y-3 p-4">
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Up candles</p>
              <ColorSwatches
                label="Up colour"
                value={settings.upColor}
                onChange={(upColor) => {
                  update({ upColor });
                }}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Down candles</p>
              <ColorSwatches
                label="Down colour"
                value={settings.downColor}
                onChange={(downColor) => {
                  update({ downColor });
                }}
              />
            </div>
            {switchRow("Borders", "candleBorders")}
            {switchRow("Wicks", "candleWicks")}
            {switchRow("Last price line", "priceLine")}
          </TabsContent>
          <TabsContent value="status" className="space-y-1 p-4">
            {switchRow("Open, high, low, close values", "legendOhlc")}
            {switchRow("Bar change values", "legendChange")}
            {switchRow("Volume", "legendVolume")}
            {switchRow("Indicator values", "legendIndicators")}
          </TabsContent>
          <TabsContent value="scales" className="space-y-1 p-4">
            <FieldRow label="Price scale">
              <Segments<"right" | "left">
                label="Price scale side"
                value={settings.priceScale}
                options={[
                  ["left", "Left"],
                  ["right", "Right"],
                ]}
                onChange={(priceScale) => {
                  update({ priceScale });
                }}
              />
            </FieldRow>
            {switchRow("Indicator last-value labels", "indicatorLabels")}
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-fg-muted">Time zone</dt>
              <dd className="text-fg">(UTC+05:30) Kolkata · exchange time</dd>
              <dt className="text-fg-muted">Session</dt>
              <dd className="text-fg">Regular hours (NSE/BSE 09:15–15:30, MCX 09:00–23:30)</dd>
            </dl>
          </TabsContent>
          <TabsContent value="canvas" className="space-y-1 p-4">
            {switchRow("Vertical grid lines", "gridVertical")}
            {switchRow("Horizontal grid lines", "gridHorizontal")}
            {switchRow("Session breaks (intraday)", "sessionBreaks")}
            {switchRow("Symbol watermark", "watermark")}
            <FieldRow label="Crosshair">
              <Segments<"normal" | "magnet">
                label="Crosshair mode"
                value={settings.crosshair}
                options={[
                  ["normal", "Free"],
                  ["magnet", "Snap to OHLC"],
                ]}
                onChange={(crosshair) => {
                  update({ crosshair });
                }}
              />
            </FieldRow>
            <FieldRow label="Crosshair line">
              <Segments<"dashed" | "dotted" | "solid">
                label="Crosshair line style"
                value={settings.crosshairStyle}
                options={[
                  ["solid", <LineSample key="solid" width={1} />, "Solid"],
                  ["dashed", <LineSample key="dashed" width={1} dash="dashed" />, "Dashed"],
                  ["dotted", <LineSample key="dotted" width={2} dash="dotted" />, "Dotted"],
                ]}
                onChange={(crosshairStyle) => {
                  update({ crosshairStyle });
                }}
              />
            </FieldRow>
          </TabsContent>
        </div>
      </Tabs>
      <div className="flex justify-between gap-2 border-t border-border p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSettings({ ...DEFAULT_SETTINGS });
          }}
        >
          Reset to defaults
        </Button>
        <Dialog.Close asChild>
          <Button size="sm">Done</Button>
        </Dialog.Close>
      </div>
    </Shell>
  );
}

type BooleanSetting = {
  [K in keyof ChartSettings]: ChartSettings[K] extends boolean ? K : never;
}[keyof ChartSettings];

function NoteForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (text: string) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [text, setText] = useState(initial);
  return (
    <form
      className="space-y-4 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(text);
      }}
    >
      <div>
        <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-fg">
          Text
        </label>
        <input
          id={id}
          value={text}
          maxLength={MAX_NOTE_LENGTH}
          autoComplete="off"
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the dialog exists to type this text
          autoFocus
          onChange={(event) => {
            setText(event.target.value);
          }}
          className={cn(
            "h-10 w-full rounded-sm border border-border-strong bg-surface-2 px-3 text-sm text-fg",
            "transition-[background-color] hover:bg-surface-3",
            focusRing,
          )}
        />
        <p className="mt-1.5 text-xs text-fg-muted">An empty note is removed.</p>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

/** Text for a new note, or the text of one being edited. */
export function TextNoteDialog() {
  const request = useWorkspace((state) => state.textRequest);
  const existing = useWorkspace((state) => {
    const pending = state.textRequest;
    if (pending === null || !("id" in pending)) return undefined;
    return state.history.present.find((drawing) => drawing.id === pending.id);
  });
  const requestText = useWorkspace((state) => state.requestText);
  const saveText = useWorkspace((state) => state.saveText);
  const editing = request !== null && "id" in request;

  return (
    <Shell
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) requestText(null);
      }}
      title={editing ? "Edit note" : "Add a note"}
      description="The note is pinned to the chart at the point you clicked."
      slot="text-note-dialog"
    >
      {request === null ? null : (
        <NoteForm
          initial={existing?.text ?? ""}
          onSave={saveText}
          onCancel={() => {
            requestText(null);
          }}
        />
      )}
    </Shell>
  );
}
