"use client";

import { Check, Copy, Lock, LockOpen, PaintBucket, Pencil, Settings2, Tags, Trash2 } from "lucide-react";
import { DropdownMenu, Popover } from "radix-ui";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { COLOR_TOKEN_LABELS } from "../lib/indicators/registry";
import {
  DRAWING_WIDTHS,
  EXTENDABLE,
  FILLABLE,
  FONT_SIZES,
  LABELLED,
  LINE_DASHES,
  TEXTUAL,
  TOOL_LABELS,
  styleOf,
} from "../lib/drawings/types";
import type { DrawingPatch, LineDash } from "../lib/drawings/types";
import { useWorkspace } from "../store/workspace-store";

import { ColorSwatches, LineSample } from "./settings-controls";
import {
  Divider,
  Hint,
  TOKEN_BG,
  menuContentClasses,
  menuItemClasses,
  toolButtonClasses,
  usePortalContainer,
} from "./ui";

const DASH_LABELS: Readonly<Record<LineDash, string>> = { solid: "Solid", dashed: "Dashed", dotted: "Dotted" };

function Item({
  label,
  children,
  ...props
}: { label: string; children: React.ReactNode } & React.ComponentProps<"button">) {
  return (
    <Hint label={label} side="bottom">
      <button type="button" aria-label={label} className={cn(toolButtonClasses, "h-7 min-w-7 px-1")} {...props}>
        {children}
      </button>
    </Hint>
  );
}

/**
 * The floating style bar of the selected drawing (TradingView-style), top-centre of the chart: colour, line width
 * and style, fill, extend, labels, font size, text, the full settings dialog, lock, clone and delete. Every change is
 * one undo step.
 */
export function DrawingStyleBar() {
  const selected = useWorkspace((state) =>
    state.selectedId === null || state.drawingsHidden
      ? undefined
      : state.history.present.find((drawing) => drawing.id === state.selectedId),
  );
  const updateDrawing = useWorkspace((state) => state.updateDrawing);
  const cloneDrawing = useWorkspace((state) => state.cloneDrawing);
  const deleteSelected = useWorkspace((state) => state.deleteSelected);
  const openDialog = useWorkspace((state) => state.openDialog);
  const requestText = useWorkspace((state) => state.requestText);
  const container = usePortalContainer();
  if (selected === undefined) return null;

  const style = styleOf(selected);
  const update = (patch: DrawingPatch) => {
    updateDrawing(selected.id, patch);
  };
  const lineKind = !TEXTUAL.has(selected.kind);

  return (
    <div
      role="toolbar"
      aria-label={`${TOOL_LABELS[selected.kind]} style`}
      data-slot="drawing-style-bar"
      className="absolute top-2 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-sm border border-border bg-surface-1 p-0.5"
    >
      <Popover.Root>
        <Hint label="Colour" side="bottom">
          <Popover.Trigger
            aria-label={`Colour: ${COLOR_TOKEN_LABELS[style.color]}`}
            className={cn(toolButtonClasses, "h-7 min-w-7 px-1")}
          >
            <span aria-hidden="true" className={cn("size-4 rounded-sm", TOKEN_BG[style.color])} />
          </Popover.Trigger>
        </Hint>
        <Popover.Portal container={container}>
          <Popover.Content sideOffset={6} className={cn(menuContentClasses, "min-w-0 p-2")}>
            <ColorSwatches
              label="Colour"
              value={style.color}
              onChange={(color) => {
                update({ color });
              }}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {lineKind ? (
        <>
          <DropdownMenu.Root>
            <Hint label="Line width" side="bottom">
              <DropdownMenu.Trigger
                aria-label={`Line width: ${String(style.width)}px`}
                className={cn(toolButtonClasses, "h-7 gap-1 px-1.5 text-xs")}
              >
                <LineSample width={style.width} />
                {style.width}px
              </DropdownMenu.Trigger>
            </Hint>
            <DropdownMenu.Portal container={container}>
              <DropdownMenu.Content sideOffset={6} className={cn(menuContentClasses, "min-w-32")}>
                <DropdownMenu.RadioGroup
                  value={String(style.width)}
                  onValueChange={(value) => {
                    update({ width: Number(value) });
                  }}
                >
                  {DRAWING_WIDTHS.map((width) => (
                    <DropdownMenu.RadioItem key={width} value={String(width)} className={menuItemClasses}>
                      <LineSample width={width} />
                      {width}px
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
          <DropdownMenu.Root>
            <Hint label="Line style" side="bottom">
              <DropdownMenu.Trigger
                aria-label={`Line style: ${DASH_LABELS[style.dash]}`}
                className={cn(toolButtonClasses, "h-7 px-1.5")}
              >
                <LineSample width={2} dash={style.dash} />
              </DropdownMenu.Trigger>
            </Hint>
            <DropdownMenu.Portal container={container}>
              <DropdownMenu.Content sideOffset={6} className={cn(menuContentClasses, "min-w-36")}>
                <DropdownMenu.RadioGroup
                  value={style.dash}
                  onValueChange={(value) => {
                    const dash = LINE_DASHES.find((candidate) => candidate === value);
                    if (dash !== undefined) update({ dash });
                  }}
                >
                  {LINE_DASHES.map((dash) => (
                    <DropdownMenu.RadioItem key={dash} value={dash} className={menuItemClasses}>
                      <LineSample width={2} dash={dash} />
                      {DASH_LABELS[dash]}
                    </DropdownMenu.RadioItem>
                  ))}
                </DropdownMenu.RadioGroup>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </>
      ) : (
        <DropdownMenu.Root>
          <Hint label="Font size" side="bottom">
            <DropdownMenu.Trigger
              aria-label={`Font size: ${String(style.fontSize)}`}
              className={cn(toolButtonClasses, "h-7 px-1.5 text-xs tabular")}
            >
              {style.fontSize}
            </DropdownMenu.Trigger>
          </Hint>
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content sideOffset={6} className={cn(menuContentClasses, "min-w-24")}>
              <DropdownMenu.RadioGroup
                value={String(style.fontSize)}
                onValueChange={(value) => {
                  update({ fontSize: Number(value) });
                }}
              >
                {FONT_SIZES.map((size) => (
                  <DropdownMenu.RadioItem key={size} value={String(size)} className={menuItemClasses}>
                    {size}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      {FILLABLE.has(selected.kind) ? (
        <Item
          label={style.fill ? "Hide background" : "Show background"}
          aria-pressed={style.fill}
          onClick={() => {
            update({ fill: !style.fill });
          }}
        >
          <PaintBucket aria-hidden="true" />
        </Item>
      ) : null}
      {EXTENDABLE.has(selected.kind) ? (
        <DropdownMenu.Root>
          <Hint label="Extend" side="bottom">
            <DropdownMenu.Trigger aria-label="Extend the line" className={cn(toolButtonClasses, "h-7 px-1.5 text-xs")}>
              ⟷
            </DropdownMenu.Trigger>
          </Hint>
          <DropdownMenu.Portal container={container}>
            <DropdownMenu.Content sideOffset={6} className={cn(menuContentClasses, "min-w-40")}>
              <DropdownMenu.CheckboxItem
                checked={style.extendLeft}
                onCheckedChange={(checked) => {
                  update({ extendLeft: checked });
                }}
                className={menuItemClasses}
              >
                <DropdownMenu.ItemIndicator className="w-4">
                  <Check aria-hidden="true" className="text-primary!" />
                </DropdownMenu.ItemIndicator>
                Extend left
              </DropdownMenu.CheckboxItem>
              <DropdownMenu.CheckboxItem
                checked={style.extendRight}
                onCheckedChange={(checked) => {
                  update({ extendRight: checked });
                }}
                className={menuItemClasses}
              >
                <DropdownMenu.ItemIndicator className="w-4">
                  <Check aria-hidden="true" className="text-primary!" />
                </DropdownMenu.ItemIndicator>
                Extend right
              </DropdownMenu.CheckboxItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      ) : null}
      {LABELLED.has(selected.kind) ? (
        <Item
          label={style.labels ? "Hide labels" : "Show labels"}
          aria-pressed={style.labels}
          onClick={() => {
            update({ labels: !style.labels });
          }}
        >
          <Tags aria-hidden="true" />
        </Item>
      ) : null}
      {TEXTUAL.has(selected.kind) ? (
        <Item
          label="Edit text"
          onClick={() => {
            requestText({ id: selected.id });
          }}
        >
          <Pencil aria-hidden="true" />
        </Item>
      ) : null}
      <Divider />
      <Item
        label="Settings"
        onClick={() => {
          openDialog("drawing");
        }}
      >
        <Settings2 aria-hidden="true" />
      </Item>
      <Item
        label={style.locked ? "Unlock" : "Lock"}
        aria-pressed={style.locked}
        onClick={() => {
          update({ locked: !style.locked });
        }}
      >
        {style.locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />}
      </Item>
      <Item
        label="Clone"
        onClick={() => {
          cloneDrawing(selected.id);
        }}
      >
        <Copy aria-hidden="true" />
      </Item>
      <Item
        label="Remove"
        className={cn(toolButtonClasses, "h-7 min-w-7 px-1 hover:text-loss")}
        onClick={() => deleteSelected()}
      >
        <Trash2 aria-hidden="true" />
      </Item>
    </div>
  );
}
