"use client";

import {
  AlignJustify,
  ArrowUpRight,
  CalendarRange,
  Check,
  ChevronRight,
  Circle,
  Crosshair,
  Equal,
  Eye,
  EyeOff,
  Lock,
  LockOpen,
  Magnet,
  Minus,
  MousePointer2,
  MoveDiagonal,
  MoveRight,
  MoveUpRight,
  Plus,
  RectangleHorizontal,
  Ruler,
  RulerDimensionLine,
  Slash,
  Tag,
  Trash2,
  Triangle,
  Type,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { TOOL_LABELS } from "../lib/drawings/types";
import type { DrawingTool } from "../lib/drawings/types";
import { useWorkspace } from "../store/workspace-store";

import {
  Divider,
  Hint,
  Kbd,
  menuContentClasses,
  menuItemClasses,
  menuLabelClasses,
  toolButtonClasses,
  usePortalContainer,
} from "./ui";

export interface ToolSpec {
  tool: DrawingTool;
  icon: React.ReactNode;
  shortcut?: string | undefined;
}

export interface ToolGroup {
  id: string;
  label: string;
  tools: readonly ToolSpec[];
}

/** The drawing tools, grouped as on TradingView: each group is one button with a flyout of its tools. */
export const TOOL_GROUPS: readonly ToolGroup[] = [
  {
    id: "cursors",
    label: "Cursors",
    tools: [
      { tool: "crosshair", icon: <Crosshair aria-hidden="true" /> },
      { tool: "cursor", icon: <MousePointer2 aria-hidden="true" /> },
    ],
  },
  {
    id: "lines",
    label: "Trend line tools",
    tools: [
      { tool: "trend", icon: <Slash aria-hidden="true" />, shortcut: "Alt+T" },
      { tool: "arrow", icon: <ArrowUpRight aria-hidden="true" /> },
      { tool: "ray", icon: <MoveUpRight aria-hidden="true" /> },
      { tool: "extended", icon: <MoveDiagonal aria-hidden="true" /> },
      { tool: "hline", icon: <Minus aria-hidden="true" />, shortcut: "Alt+H" },
      { tool: "hray", icon: <MoveRight aria-hidden="true" /> },
      { tool: "vline", icon: <Minus aria-hidden="true" className="rotate-90" />, shortcut: "Alt+V" },
      { tool: "crossline", icon: <Plus aria-hidden="true" />, shortcut: "Alt+C" },
      { tool: "channel", icon: <Equal aria-hidden="true" className="-rotate-12" /> },
    ],
  },
  {
    id: "fib",
    label: "Fibonacci tools",
    tools: [{ tool: "fib", icon: <AlignJustify aria-hidden="true" />, shortcut: "Alt+F" }],
  },
  {
    id: "shapes",
    label: "Shapes",
    tools: [
      { tool: "rect", icon: <RectangleHorizontal aria-hidden="true" />, shortcut: "Alt+R" },
      { tool: "ellipse", icon: <Circle aria-hidden="true" /> },
      { tool: "triangle", icon: <Triangle aria-hidden="true" /> },
    ],
  },
  {
    id: "annotations",
    label: "Annotation tools",
    tools: [
      { tool: "text", icon: <Type aria-hidden="true" /> },
      { tool: "pricelabel", icon: <Tag aria-hidden="true" /> },
    ],
  },
  {
    id: "measure",
    label: "Measuring tools",
    tools: [
      { tool: "measure", icon: <RulerDimensionLine aria-hidden="true" /> },
      { tool: "daterange", icon: <CalendarRange aria-hidden="true" /> },
      { tool: "datepricerange", icon: <Ruler aria-hidden="true" /> },
    ],
  },
];

/** The roving tab order of the toolbar's items (group buttons, their flyout arrows, then the toggles). */
const ITEM_ORDER: readonly string[] = [
  ...TOOL_GROUPS.flatMap((group) =>
    group.tools.length > 1 ? [`group:${group.id}`, `arrow:${group.id}`] : [`group:${group.id}`],
  ),
  "magnet",
  "lock",
  "hide",
  "remove",
];
const ITEM_INDEX = new Map(ITEM_ORDER.map((key, index) => [key, index]));

/** Every tool, flat (the narrow-screen Draw menu). */
export const ALL_TOOLS: readonly ToolSpec[] = TOOL_GROUPS.flatMap((group) => group.tools);

function groupOf(tool: DrawingTool): ToolGroup | undefined {
  return TOOL_GROUPS.find((group) => group.tools.some((spec) => spec.tool === tool));
}

/** The tool a group button shows: the active one if it's in the group, else the group's last pick, else its first. */
function shownTool(group: ToolGroup, active: DrawingTool, picks: Readonly<Record<string, DrawingTool>>): ToolSpec {
  const fallback = group.tools[0] as ToolSpec;
  const wanted = group.tools.some((spec) => spec.tool === active) ? active : picks[group.id];
  return group.tools.find((spec) => spec.tool === wanted) ?? fallback;
}

const arrowClasses = cn(
  "absolute right-0 bottom-0 flex h-3.5 w-3 cursor-pointer items-end justify-end rounded-sm text-fg-muted",
  "opacity-60 hover:bg-surface-3 hover:text-fg hover:opacity-100 data-[state=open]:opacity-100",
  "focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid",
);

/**
 * The left drawing toolbar, TradingView-style: one button per group (the group's current tool) with a corner arrow
 * that opens the group's flyout; then magnet, lock, hide and a remove menu (drawings, indicators, everything). A
 * vertical toolbar: one tab stop, arrow keys move.
 */
export function DrawingToolbar({ className }: { className?: string | undefined }) {
  const tool = useWorkspace((state) => state.tool);
  const setTool = useWorkspace((state) => state.setTool);
  const picks = useWorkspace((state) => state.groupTools);
  const setGroupTool = useWorkspace((state) => state.setGroupTool);
  const magnet = useWorkspace((state) => state.magnet);
  const toggleMagnet = useWorkspace((state) => state.toggleMagnet);
  const locked = useWorkspace((state) => state.locked);
  const toggleLocked = useWorkspace((state) => state.toggleLocked);
  const hidden = useWorkspace((state) => state.drawingsHidden);
  const toggleHidden = useWorkspace((state) => state.toggleDrawingsHidden);
  const count = useWorkspace((state) => state.history.present.length);
  const indicatorCount = useWorkspace((state) => state.indicators.length);
  const removeAll = useWorkspace((state) => state.removeAllDrawings);
  const removeIndicators = useWorkspace((state) => state.removeAllIndicators);
  const container = usePortalContainer();
  const ref = useRef<HTMLDivElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);

  const pick = (spec: ToolSpec) => {
    const group = groupOf(spec.tool);
    if (group !== undefined) setGroupTool(group.id, spec.tool);
    setTool(spec.tool);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const list = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>("[data-toolbar-item]:not(:disabled)") ?? [],
    );
    const current = list.findIndex((item) => item === document.activeElement);
    if (current === -1) return;
    let next = current;
    if (event.key === "ArrowDown") next = (current + 1) % list.length;
    else if (event.key === "ArrowUp") next = (current - 1 + list.length) % list.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = list.length - 1;
    else return;
    event.preventDefault();
    list[next]?.focus();
  };

  const roving = (key: string) => {
    const index = ITEM_INDEX.get(key) ?? 0;
    return {
      "data-toolbar-item": "",
      tabIndex: index === focusIndex ? 0 : -1,
      onFocus: () => {
        setFocusIndex(index);
      },
    };
  };

  const plain = (props: {
    key: string;
    label: string;
    icon: React.ReactNode;
    pressed?: boolean | undefined;
    onClick: () => void;
    disabled?: boolean | undefined;
  }) => (
    <Hint key={props.label} label={props.label} side="right">
      <button
        type="button"
        {...roving(props.key)}
        aria-label={props.label}
        aria-pressed={props.pressed}
        disabled={props.disabled}
        onClick={props.onClick}
        className={cn(toolButtonClasses, "size-8 px-0")}
      >
        {props.icon}
      </button>
    </Hint>
  );

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Drawing tools"
      aria-orientation="vertical"
      data-slot="drawing-toolbar"
      onKeyDown={onKeyDown}
      className={cn(
        "flex w-11 shrink-0 flex-col items-center gap-0.5 overflow-y-auto rounded-sm border border-border bg-surface-1 py-1.5",
        className,
      )}
    >
      {TOOL_GROUPS.map((group, index) => {
        const spec = shownTool(group, tool, picks);
        const active = group.tools.some((candidate) => candidate.tool === tool);
        return (
          <div key={group.id} className="flex flex-col items-center">
            {index === 2 || index === 4 ? <Divider orientation="horizontal" /> : null}
            <div className="relative" data-slot={`tool-group-${group.id}`}>
              <Hint label={TOOL_LABELS[spec.tool]} shortcut={spec.shortcut} side="right">
                <button
                  type="button"
                  {...roving(`group:${group.id}`)}
                  aria-label={TOOL_LABELS[spec.tool]}
                  aria-pressed={active}
                  data-slot={`tool-${spec.tool}`}
                  onClick={() => {
                    pick(spec);
                  }}
                  className={cn(toolButtonClasses, "size-8 px-0")}
                >
                  {spec.icon}
                </button>
              </Hint>
              {group.tools.length > 1 ? (
                <DropdownMenu.Root>
                  <DropdownMenu.Trigger
                    {...roving(`arrow:${group.id}`)}
                    aria-label={`More ${group.label.toLowerCase()}`}
                    className={arrowClasses}
                  >
                    <ChevronRight aria-hidden="true" className="size-2.5 rotate-45" />
                  </DropdownMenu.Trigger>
                  <DropdownMenu.Portal container={container}>
                    <DropdownMenu.Content side="right" align="start" sideOffset={6} className={menuContentClasses}>
                      <DropdownMenu.Label className={menuLabelClasses}>{group.label}</DropdownMenu.Label>
                      {group.tools.map((item) => (
                        <DropdownMenu.Item
                          key={item.tool}
                          data-slot={`flyout-${item.tool}`}
                          onSelect={() => {
                            pick(item);
                          }}
                          className={cn(menuItemClasses, "min-w-56")}
                        >
                          {item.icon}
                          <span className="flex-1">{TOOL_LABELS[item.tool]}</span>
                          {item.shortcut ? <Kbd>{item.shortcut}</Kbd> : null}
                          {tool === item.tool ? <Check aria-hidden="true" className="text-primary!" /> : null}
                        </DropdownMenu.Item>
                      ))}
                    </DropdownMenu.Content>
                  </DropdownMenu.Portal>
                </DropdownMenu.Root>
              ) : null}
            </div>
          </div>
        );
      })}
      <Divider orientation="horizontal" />
      {plain({
        key: "magnet",
        label: "Magnet: snap to open, high, low, close",
        icon: <Magnet aria-hidden="true" />,
        pressed: magnet,
        onClick: toggleMagnet,
      })}
      {plain({
        key: "lock",
        label: "Lock all drawings",
        icon: locked ? <Lock aria-hidden="true" /> : <LockOpen aria-hidden="true" />,
        pressed: locked,
        onClick: toggleLocked,
      })}
      {plain({
        key: "hide",
        label: "Hide all drawings",
        icon: hidden ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />,
        pressed: hidden,
        onClick: toggleHidden,
      })}
      <Divider orientation="horizontal" />
      <DropdownMenu.Root>
        <Hint label="Remove objects" side="right">
          <DropdownMenu.Trigger
            {...roving("remove")}
            aria-label="Remove objects"
            disabled={count === 0 && indicatorCount === 0}
            className={cn(toolButtonClasses, "size-8 px-0 hover:text-loss")}
          >
            <Trash2 aria-hidden="true" />
          </DropdownMenu.Trigger>
        </Hint>
        <DropdownMenu.Portal container={container}>
          <DropdownMenu.Content side="right" align="end" sideOffset={6} className={menuContentClasses}>
            <DropdownMenu.Item disabled={count === 0} onSelect={removeAll} className={menuItemClasses}>
              <Trash2 aria-hidden="true" />
              Remove {count} drawing{count === 1 ? "" : "s"}
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={indicatorCount === 0} onSelect={removeIndicators} className={menuItemClasses}>
              <Trash2 aria-hidden="true" />
              Remove {indicatorCount} indicator{indicatorCount === 1 ? "" : "s"}
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              onSelect={() => {
                removeAll();
                removeIndicators();
              }}
              className={cn(menuItemClasses, "text-loss")}
            >
              <Trash2 aria-hidden="true" />
              Remove everything
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
