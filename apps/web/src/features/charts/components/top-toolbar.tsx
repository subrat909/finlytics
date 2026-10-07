"use client";

import {
  Baseline,
  Camera,
  ChartArea,
  ChartCandlestick,
  ChartColumn,
  ChartLine,
  ChartNoAxesColumn,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  EllipsisVertical,
  Maximize,
  Minimize,
  PanelRightClose,
  PanelRightOpen,
  PencilRuler,
  Redo2,
  Search,
  Settings,
  SquareFunction,
  Trash2,
  Undo2,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { useRef } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { canRedo, canUndo } from "../lib/drawings/history";
import { TOOL_LABELS } from "../lib/drawings/types";
import { CHART_INTERVALS, CHART_TYPES, CHART_TYPE_LABELS, INTERVALS } from "../schemas";
import type { ChartInterval, ChartType } from "../schemas";
import { useWorkspace } from "../store/workspace-store";

import { useChartInfo } from "./chart-context";
import { ALL_TOOLS } from "./drawing-toolbar";
import {
  Divider,
  Hint,
  SimulatedBadge,
  ToolButton,
  focusRing,
  menuContentClasses,
  menuItemClasses,
  menuLabelClasses,
  toolButtonClasses,
  usePortalContainer,
} from "./ui";

export const CHART_TYPE_ICONS: Readonly<Record<ChartType, React.ReactNode>> = {
  candles: <ChartCandlestick aria-hidden="true" />,
  hollow: <ChartNoAxesColumn aria-hidden="true" />,
  bars: <ChartColumn aria-hidden="true" />,
  line: <ChartLine aria-hidden="true" />,
  area: <ChartArea aria-hidden="true" />,
  baseline: <Baseline aria-hidden="true" />,
  "heikin-ashi": <ChartNoAxesCombined aria-hidden="true" />,
};

const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/** The intervals as a radio group: arrow keys move and select (the APG pattern), one tab stop. */
function IntervalGroup({ value, onChange }: { value: ChartInterval; onChange: (interval: ChartInterval) => void }) {
  const refs = useRef(new Map<ChartInterval, HTMLButtonElement>());
  const move = (offset: number) => {
    const index = CHART_INTERVALS.indexOf(value);
    const next = CHART_INTERVALS[(index + offset + CHART_INTERVALS.length) % CHART_INTERVALS.length] ?? value;
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label="Interval"
      data-slot="interval-group"
      className="hidden items-center @3xl/workspace:flex"
    >
      {CHART_INTERVALS.map((interval) => {
        const checked = interval === value;
        return (
          <button
            key={interval}
            ref={(node) => {
              if (node) refs.current.set(interval, node);
              else refs.current.delete(interval);
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={INTERVALS[interval].long}
            tabIndex={checked ? 0 : -1}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                move(1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                move(-1);
              }
            }}
            onClick={() => {
              onChange(interval);
            }}
            className={cn(
              toolButtonClasses,
              "min-w-9 px-1.5 text-[13px] font-medium tabular",
              checked && "bg-surface-2 text-primary hover:text-primary",
            )}
          >
            {INTERVALS[interval].short}
          </button>
        );
      })}
    </div>
  );
}

/** Below the toolbar's full width: the interval as a menu. */
function IntervalMenu({ value, onChange }: { value: ChartInterval; onChange: (interval: ChartInterval) => void }) {
  const container = usePortalContainer();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        aria-label={`Interval: ${INTERVALS[value].long}`}
        className={cn(toolButtonClasses, "px-2 text-[13px] font-medium text-fg @3xl/workspace:hidden")}
      >
        {INTERVALS[value].short}
        <ChevronDown aria-hidden="true" className="size-3.5!" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClasses}>
          <DropdownMenu.Label className={menuLabelClasses}>Interval</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const interval = CHART_INTERVALS.find((candidate) => candidate === next);
              if (interval) onChange(interval);
            }}
          >
            {CHART_INTERVALS.map((interval) => (
              <DropdownMenu.RadioItem key={interval} value={interval} className={menuItemClasses}>
                <span className="w-4">
                  <DropdownMenu.ItemIndicator>
                    <Check aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                </span>
                {INTERVALS[interval].long}
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ChartTypeMenu() {
  const chartType = useWorkspace((state) => state.chartType);
  const setChartType = useWorkspace((state) => state.setChartType);
  const container = usePortalContainer();
  return (
    <DropdownMenu.Root>
      <Hint label="Chart type">
        <DropdownMenu.Trigger
          aria-label={`Chart type: ${CHART_TYPE_LABELS[chartType]}`}
          data-slot="chart-type-trigger"
          className={toolButtonClasses}
        >
          {CHART_TYPE_ICONS[chartType]}
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content align="start" sideOffset={4} className={menuContentClasses}>
          <DropdownMenu.Label className={menuLabelClasses}>Chart type</DropdownMenu.Label>
          <DropdownMenu.RadioGroup
            value={chartType}
            onValueChange={(next) => {
              const type = CHART_TYPES.find((candidate) => candidate === next);
              if (type) setChartType(type);
            }}
          >
            {CHART_TYPES.map((type) => (
              <DropdownMenu.RadioItem key={type} value={type} className={menuItemClasses}>
                {CHART_TYPE_ICONS[type]}
                <span className="flex-1">{CHART_TYPE_LABELS[type]}</span>
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" className="text-primary!" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The drawing tools as a menu, where the left toolbar doesn't fit. */
function DrawMenu() {
  const tool = useWorkspace((state) => state.tool);
  const setTool = useWorkspace((state) => state.setTool);
  const count = useWorkspace((state) => state.history.present.length);
  const removeAll = useWorkspace((state) => state.removeAllDrawings);
  const container = usePortalContainer();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger aria-label="Drawing tools" className={cn(toolButtonClasses, "@xl/workspace:hidden")}>
        <PencilRuler aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal container={container}>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className={cn(menuContentClasses, "max-h-[70dvh] overflow-y-auto")}
        >
          <DropdownMenu.RadioGroup
            value={tool}
            onValueChange={(next) => {
              const spec = ALL_TOOLS.find((candidate) => candidate.tool === next);
              if (spec) setTool(spec.tool);
            }}
          >
            {ALL_TOOLS.map((spec) => (
              <DropdownMenu.RadioItem key={spec.tool} value={spec.tool} className={menuItemClasses}>
                {spec.icon}
                <span className="flex-1">{TOOL_LABELS[spec.tool]}</span>
                <DropdownMenu.ItemIndicator>
                  <Check aria-hidden="true" className="text-primary!" />
                </DropdownMenu.ItemIndicator>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item disabled={count === 0} onSelect={removeAll} className={menuItemClasses}>
            <Trash2 aria-hidden="true" />
            Remove drawings
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

export interface TopToolbarProps {
  simulated: boolean;
  fullscreen: boolean;
  onToggleFullscreen: () => void;
  onScreenshot: () => void;
}

/**
 * The chart's top toolbar (TradingView's header): symbol search, intervals, chart type, indicators, undo/redo, then
 * screenshot, full screen, settings and the side panel. Narrow workspaces fold intervals, drawing tools and the
 * right-hand actions into menus (container queries on the workspace, so the sidebar's width counts).
 */
export function TopToolbar({ simulated, fullscreen, onToggleFullscreen, onScreenshot }: TopToolbarProps) {
  const info = useChartInfo();
  const interval = useWorkspace((state) => state.interval);
  const setInterval = useWorkspace((state) => state.setInterval);
  const openDialog = useWorkspace((state) => state.openDialog);
  const history = useWorkspace((state) => state.history);
  const undo = useWorkspace((state) => state.undo);
  const redo = useWorkspace((state) => state.redo);
  const panelOpen = useWorkspace((state) => state.panelOpen);
  const togglePanel = useWorkspace((state) => state.togglePanel);
  const indicatorCount = useWorkspace((state) => state.indicators.length);
  const container = usePortalContainer();
  const mod = isMac() ? "⌘" : "Ctrl+";

  return (
    <div
      role="group"
      aria-label="Chart toolbar"
      data-slot="chart-toolbar"
      className="flex h-11 shrink-0 items-center gap-0.5 overflow-x-auto rounded-sm border border-border bg-surface-1 px-1.5 [scrollbar-width:none]"
    >
      <Hint label="Symbol search" shortcut="Type a symbol">
        <button
          type="button"
          data-slot="symbol-button"
          aria-label={`Symbol search, ${info.symbol} on chart`}
          onClick={() => {
            openDialog("symbol");
          }}
          className={cn(
            "inline-flex h-8 max-w-44 shrink-0 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm font-semibold text-fg",
            "transition-[color,background-color] hover:bg-surface-2",
            focusRing,
          )}
        >
          <Search aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          <span className="truncate">{info.symbol}</span>
        </button>
      </Hint>
      {simulated ? <SimulatedBadge className="hidden @lg/workspace:inline-flex" /> : null}
      <Divider />
      <IntervalGroup value={interval} onChange={setInterval} />
      <IntervalMenu value={interval} onChange={setInterval} />
      <Divider />
      <ChartTypeMenu />
      <ToolButton
        label={indicatorCount > 0 ? `Indicators, ${String(indicatorCount)} on the chart` : "Indicators"}
        data-slot="indicators-button"
        icon={<SquareFunction aria-hidden="true" />}
        text={
          <span className="hidden text-[13px] font-medium @4xl/workspace:inline">
            Indicators
            {indicatorCount > 0 ? <span className="text-fg-muted tabular"> {indicatorCount}</span> : null}
          </span>
        }
        onClick={() => {
          openDialog("indicators");
        }}
      />
      <DrawMenu />
      <Divider className="hidden @xl/workspace:block" />
      <ToolButton
        label="Undo"
        shortcut={`${mod}Z`}
        icon={<Undo2 aria-hidden="true" />}
        disabled={!canUndo(history)}
        onClick={undo}
        className="hidden @xl/workspace:inline-flex"
      />
      <ToolButton
        label="Redo"
        shortcut={`${mod}Y`}
        icon={<Redo2 aria-hidden="true" />}
        disabled={!canRedo(history)}
        onClick={redo}
        className="hidden @xl/workspace:inline-flex"
      />
      <span className="min-w-2 flex-1" />
      <ToolButton
        label="Take a screenshot"
        icon={<Camera aria-hidden="true" />}
        onClick={onScreenshot}
        className="hidden @xl/workspace:inline-flex"
      />
      <ToolButton
        label={fullscreen ? "Exit full screen" : "Full screen"}
        aria-pressed={fullscreen}
        icon={fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
        onClick={onToggleFullscreen}
        className="hidden @xl/workspace:inline-flex"
      />
      <ToolButton
        label="Chart settings"
        icon={<Settings aria-hidden="true" />}
        onClick={() => {
          openDialog("settings");
        }}
        className="hidden @xl/workspace:inline-flex"
      />
      <ToolButton
        label={panelOpen ? "Hide the side panel" : "Show the side panel"}
        aria-pressed={panelOpen}
        icon={panelOpen ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
        onClick={togglePanel}
        className="hidden xl:inline-flex"
      />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger aria-label="More chart actions" className={cn(toolButtonClasses, "@xl/workspace:hidden")}>
          <EllipsisVertical aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal container={container}>
          <DropdownMenu.Content align="end" sideOffset={4} className={menuContentClasses}>
            <DropdownMenu.Item disabled={!canUndo(history)} onSelect={undo} className={menuItemClasses}>
              <Undo2 aria-hidden="true" />
              Undo
            </DropdownMenu.Item>
            <DropdownMenu.Item disabled={!canRedo(history)} onSelect={redo} className={menuItemClasses}>
              <Redo2 aria-hidden="true" />
              Redo
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item onSelect={onScreenshot} className={menuItemClasses}>
              <Camera aria-hidden="true" />
              Take a screenshot
            </DropdownMenu.Item>
            <DropdownMenu.Item onSelect={onToggleFullscreen} className={menuItemClasses}>
              {fullscreen ? <Minimize aria-hidden="true" /> : <Maximize aria-hidden="true" />}
              {fullscreen ? "Exit full screen" : "Full screen"}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => {
                openDialog("settings");
              }}
              className={menuItemClasses}
            >
              <Settings aria-hidden="true" />
              Chart settings
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
