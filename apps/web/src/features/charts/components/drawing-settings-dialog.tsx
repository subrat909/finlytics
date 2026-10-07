"use client";

import { X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState } from "react";

import { Button } from "@finlytics/ui/components/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@finlytics/ui/components/tabs";
import { cn } from "@finlytics/ui/lib/utils";

import {
  DRAWING_WIDTHS,
  EXTENDABLE,
  FILLABLE,
  FONT_SIZES,
  LABELLED,
  LINE_DASHES,
  MAX_NOTE_LENGTH,
  TEXTUAL,
  TOOL_LABELS,
  styleOf,
} from "../lib/drawings/types";
import type { Drawing, DrawingPatch, LineDash } from "../lib/drawings/types";
import { formatBarTime } from "../lib/time";
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

const inputClasses = cn(
  "h-8 w-32 rounded-sm border border-border-strong bg-surface-2 px-2 text-right text-sm text-fg tabular",
  "transition-[background-color] hover:bg-surface-3",
  focusRing,
);

function Editor({ drawing, onDone }: { drawing: Drawing; onDone: (patch: DrawingPatch | null) => void }) {
  const [patch, setPatch] = useState<DrawingPatch>({});
  const style = styleOf({ ...drawing, ...patch });
  const [points, setPoints] = useState(drawing.points.map((point) => String(point.price)));
  const [text, setText] = useState(drawing.text ?? "");
  const textId = useId();
  const change = (next: DrawingPatch) => {
    setPatch((current) => ({ ...current, ...next }));
  };

  const apply = () => {
    const prices = points.map((value, index) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : (drawing.points[index]?.price ?? 0);
    });
    onDone({
      ...patch,
      points: drawing.points.map((point, index) => ({ ...point, price: prices[index] ?? point.price })),
      ...(TEXTUAL.has(drawing.kind) ? { text: text.trim().slice(0, MAX_NOTE_LENGTH) } : {}),
    });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        apply();
      }}
    >
      <Tabs defaultValue="style" className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Drawing settings" className="shrink-0 px-4">
          <TabsTrigger value="style">Style</TabsTrigger>
          {TEXTUAL.has(drawing.kind) ? <TabsTrigger value="text">Text</TabsTrigger> : null}
          <TabsTrigger value="coordinates">Coordinates</TabsTrigger>
        </TabsList>
        <TabsContent value="style" className="space-y-3 overflow-y-auto p-4">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-fg-muted uppercase">Colour</p>
            <ColorSwatches
              label="Colour"
              value={style.color}
              onChange={(color) => {
                change({ color });
              }}
            />
          </div>
          {TEXTUAL.has(drawing.kind) ? (
            <FieldRow label="Font size">
              <Segments<number>
                label="Font size"
                value={style.fontSize}
                options={FONT_SIZES.map((size) => [size, String(size)] as const)}
                onChange={(fontSize) => {
                  change({ fontSize });
                }}
              />
            </FieldRow>
          ) : (
            <>
              <FieldRow label="Line width">
                <Segments<number>
                  label="Line width"
                  value={style.width}
                  options={DRAWING_WIDTHS.map(
                    (width) => [width, <LineSample key={width} width={width} />, `${String(width)} px`] as const,
                  )}
                  onChange={(width) => {
                    change({ width });
                  }}
                />
              </FieldRow>
              <FieldRow label="Line style">
                <Segments<LineDash>
                  label="Line style"
                  value={style.dash}
                  options={LINE_DASHES.map(
                    (dash) => [dash, <LineSample key={dash} width={2} dash={dash} />, dash] as const,
                  )}
                  onChange={(dash) => {
                    change({ dash });
                  }}
                />
              </FieldRow>
            </>
          )}
          {FILLABLE.has(drawing.kind) ? (
            <>
              <SwitchRow
                label="Background"
                checked={style.fill}
                onChange={(fill) => {
                  change({ fill });
                }}
              />
              <FieldRow label="Background opacity">
                <input
                  type="range"
                  min={0.02}
                  max={0.6}
                  step={0.02}
                  disabled={!style.fill}
                  aria-label="Background opacity"
                  value={style.fillOpacity}
                  onChange={(event) => {
                    change({ fillOpacity: Number(event.target.value) });
                  }}
                  className={cn("w-32 accent-primary", focusRing)}
                />
              </FieldRow>
            </>
          ) : null}
          {EXTENDABLE.has(drawing.kind) ? (
            <>
              <SwitchRow
                label="Extend left"
                checked={style.extendLeft}
                onChange={(extendLeft) => {
                  change({ extendLeft });
                }}
              />
              <SwitchRow
                label="Extend right"
                checked={style.extendRight}
                onChange={(extendRight) => {
                  change({ extendRight });
                }}
              />
            </>
          ) : null}
          {LABELLED.has(drawing.kind) ? (
            <SwitchRow
              label="Labels"
              checked={style.labels}
              onChange={(labels) => {
                change({ labels });
              }}
            />
          ) : null}
          <SwitchRow
            label="Lock (can't be moved)"
            checked={style.locked}
            onChange={(locked) => {
              change({ locked });
            }}
          />
        </TabsContent>
        {TEXTUAL.has(drawing.kind) ? (
          <TabsContent value="text" className="space-y-2 p-4">
            <label htmlFor={textId} className="block text-sm font-medium text-fg">
              {drawing.kind === "pricelabel" ? "Label (empty shows the price)" : "Text"}
            </label>
            <textarea
              id={textId}
              value={text}
              maxLength={MAX_NOTE_LENGTH}
              rows={3}
              onChange={(event) => {
                setText(event.target.value);
              }}
              className={cn(
                "w-full rounded-sm border border-border-strong bg-surface-2 px-3 py-2 text-sm text-fg",
                "transition-[background-color] hover:bg-surface-3",
                focusRing,
              )}
            />
          </TabsContent>
        ) : null}
        <TabsContent value="coordinates" className="space-y-1 overflow-y-auto p-4">
          {drawing.points.map((point, index) => (
            <FieldRow key={index} label={`#${String(index + 1)} · ${formatBarTime(point.time, true)}`}>
              <input
                aria-label={`Price of point ${String(index + 1)}`}
                inputMode="decimal"
                value={points[index] ?? ""}
                onChange={(event) => {
                  const next = [...points];
                  next[index] = event.target.value;
                  setPoints(next);
                }}
                className={inputClasses}
              />
            </FieldRow>
          ))}
        </TabsContent>
      </Tabs>
      <div className="flex justify-end gap-2 border-t border-border p-4">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onDone(null);
          }}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Ok
        </Button>
      </div>
    </form>
  );
}

/** The selected drawing's full settings (TradingView's dialog): style, text and coordinates, applied on Ok. */
export function DrawingSettingsDialog() {
  const open = useWorkspace((state) => state.dialog === "drawing");
  const drawing = useWorkspace((state) =>
    state.selectedId === null ? undefined : state.history.present.find((item) => item.id === state.selectedId),
  );
  const openDialog = useWorkspace((state) => state.openDialog);
  const updateDrawing = useWorkspace((state) => state.updateDrawing);
  const container = usePortalContainer();
  const visible = open && drawing !== undefined;

  return (
    <Dialog.Root
      open={visible}
      onOpenChange={(next) => {
        if (!next) openDialog(null);
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content data-slot="drawing-settings-dialog" className={cn(dialogClasses, "max-w-md")}>
          <div className={dialogHeaderClasses}>
            <Dialog.Title className="text-base font-semibold">
              {drawing === undefined ? "Drawing" : TOOL_LABELS[drawing.kind]}
            </Dialog.Title>
            <Dialog.Close aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">
            Style, text and coordinates of the selected drawing.
          </Dialog.Description>
          {drawing === undefined ? null : (
            <Editor
              key={drawing.id}
              drawing={drawing}
              onDone={(patch) => {
                if (patch !== null) updateDrawing(drawing.id, patch);
                openDialog(null);
              }}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
