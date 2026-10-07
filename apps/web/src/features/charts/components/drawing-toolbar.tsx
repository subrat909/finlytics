"use client";

import {
  AlignJustify,
  Crosshair,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveRight,
  MoveUpRight,
  RectangleHorizontal,
  RulerDimensionLine,
  Slash,
  Trash2,
  Type,
} from "lucide-react";
import { useRef, useState } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { TOOL_LABELS } from "../lib/drawings/types";
import type { DrawingTool } from "../lib/drawings/types";
import { useWorkspace } from "../store/workspace-store";

import { Divider, Hint, toolButtonClasses } from "./ui";

export interface ToolSpec {
  tool: DrawingTool;
  icon: React.ReactNode;
  shortcut?: string | undefined;
}

/** The drawing tools in toolbar order, grouped (also the mobile Draw menu). */
export const TOOL_GROUPS: readonly (readonly ToolSpec[])[] = [
  [
    { tool: "crosshair", icon: <Crosshair aria-hidden="true" /> },
    { tool: "cursor", icon: <MousePointer2 aria-hidden="true" /> },
  ],
  [
    { tool: "trend", icon: <Slash aria-hidden="true" />, shortcut: "Alt+T" },
    { tool: "ray", icon: <MoveUpRight aria-hidden="true" /> },
    { tool: "hline", icon: <Minus aria-hidden="true" />, shortcut: "Alt+H" },
    { tool: "hray", icon: <MoveRight aria-hidden="true" /> },
    { tool: "vline", icon: <Minus aria-hidden="true" className="rotate-90" />, shortcut: "Alt+V" },
  ],
  [
    { tool: "rect", icon: <RectangleHorizontal aria-hidden="true" /> },
    { tool: "fib", icon: <AlignJustify aria-hidden="true" />, shortcut: "Alt+F" },
    { tool: "measure", icon: <RulerDimensionLine aria-hidden="true" /> },
    { tool: "text", icon: <Type aria-hidden="true" /> },
  ],
];

const TOOL_POSITIONS = new Map(TOOL_GROUPS.flat().map((spec, position) => [spec.tool, position]));
const TOOL_COUNT = TOOL_POSITIONS.size;

/**
 * The left drawing toolbar (a vertical APG toolbar: one tab stop, arrow keys move between tools). Tools are toggle
 * buttons; magnet, lock and hide are toggles; "Remove drawings" clears them all (Ctrl+Z brings them back).
 */
export function DrawingToolbar({ className }: { className?: string | undefined }) {
  const tool = useWorkspace((state) => state.tool);
  const setTool = useWorkspace((state) => state.setTool);
  const magnet = useWorkspace((state) => state.magnet);
  const toggleMagnet = useWorkspace((state) => state.toggleMagnet);
  const locked = useWorkspace((state) => state.locked);
  const toggleLocked = useWorkspace((state) => state.toggleLocked);
  const hidden = useWorkspace((state) => state.drawingsHidden);
  const toggleHidden = useWorkspace((state) => state.toggleDrawingsHidden);
  const count = useWorkspace((state) => state.history.present.length);
  const removeAll = useWorkspace((state) => state.removeAllDrawings);
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const items = (): HTMLButtonElement[] =>
    Array.from(ref.current?.querySelectorAll<HTMLButtonElement>("[data-toolbar-item]:not(:disabled)") ?? []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const current = list.findIndex((item) => item === document.activeElement);
    if (current === -1) return;
    let next = current;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (current + 1) % list.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (current - 1 + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]?.focus();
  };

  const item = (
    position: number,
    props: {
      label: string;
      shortcut?: string | undefined;
      icon: React.ReactNode;
      /** Toggle buttons only; plain actions leave it undefined. */
      pressed?: boolean | undefined;
      onClick: () => void;
      disabled?: boolean | undefined;
      slot?: string | undefined;
      tone?: string | undefined;
    },
  ) => {
    return (
      <Hint key={props.label} label={props.label} shortcut={props.shortcut} side="right">
        <button
          type="button"
          data-toolbar-item=""
          data-slot={props.slot}
          aria-label={props.label}
          aria-pressed={props.pressed}
          disabled={props.disabled}
          tabIndex={position === focusIndex ? 0 : -1}
          onFocus={() => {
            setFocusIndex(position);
          }}
          onClick={props.onClick}
          className={cn(toolButtonClasses, "size-8 px-0", props.tone)}
        >
          {props.icon}
        </button>
      </Hint>
    );
  };

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="vertical"
      data-slot="drawing-toolbar"
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-md border border-border bg-surface-1 py-1.5",
        className,
      )}
    >
      {TOOL_GROUPS.map((group, groupIndex) => (
        <div key={group[0]?.tool ?? groupIndex} className="flex flex-col items-center gap-0.5">
          {groupIndex === 0 ? null : <Divider orientation="horizontal" />}
          {group.map((spec) =>
            item(TOOL_POSITIONS.get(spec.tool) ?? 0, {
              label: TOOL_LABELS[spec.tool],
              shortcut: spec.shortcut,
              icon: spec.icon,
              pressed: tool === spec.tool,
              slot: `tool-${spec.tool}`,
              onClick: () => {
                setTool(spec.tool);
              },
            }),
          )}
        </div>
      ))}
      <Divider orientation="horizontal" />
      {item(TOOL_COUNT, {
        label: "Magnet: snap to open, high, low, close",
        icon: <Magnet aria-hidden="true" />,
        pressed: magnet,
        onClick: toggleMagnet,
      })}
      {item(TOOL_COUNT + 1, {
        label: "Lock all drawings",
        icon: locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />,
        pressed: locked,
        onClick: toggleLocked,
      })}
      {item(TOOL_COUNT + 2, {
        label: "Hide all drawings",
        icon: hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />,
        pressed: hidden,
        onClick: toggleHidden,
      })}
      <Divider orientation="horizontal" />
      {item(TOOL_COUNT + 3, {
        label: count === 0 ? "Remove drawings (none yet)" : `Remove ${String(count)} drawing${count === 1 ? "" : "s"}`,
        icon: <Trash2 aria-hidden="true" />,
        disabled: count === 0,
        tone: "hover:text-loss",
        onClick: removeAll,
      })}
    </div>
  );
}
