"use client";

import { X } from "lucide-react";
import { Dialog, RadioGroup } from "radix-ui";
import { useId, useState } from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { PRICE_SOURCES } from "../lib/indicators/core";
import {
  COLOR_TOKENS,
  COLOR_TOKEN_LABELS,
  INDICATORS,
  LINE_WIDTHS,
  PLOT_DASHES,
  defaultStyles,
  sanitizeInputs,
} from "../lib/indicators/registry";
import type { ColorToken, IndicatorInstance, InputValue, LineWidth, PlotStyleValue } from "../lib/indicators/registry";
import { useWorkspace } from "../store/workspace-store";

import {
  TOKEN_BG,
  closeButtonClasses,
  dialogClasses,
  dialogHeaderClasses,
  focusRing,
  overlayClasses,
  usePortalContainer,
} from "./ui";

const fieldClasses = cn(
  "h-9 w-full rounded-sm border border-border-strong bg-surface-2 px-2.5 text-sm text-fg tabular",
  "transition-[background-color] hover:bg-surface-3",
  focusRing,
);

const SOURCE_LABELS: Readonly<Record<string, string>> = {
  close: "Close",
  open: "Open",
  high: "High",
  low: "Low",
  hl2: "(H + L) / 2",
  hlc3: "(H + L + C) / 3",
  ohlc4: "(O + H + L + C) / 4",
};

interface EditorProps {
  instance: IndicatorInstance;
  onDone: () => void;
}

/** The editor, mounted per opening so it starts from the instance's current values. */
function Editor({ instance, onDone }: EditorProps) {
  const id = useId();
  const definition = INDICATORS[instance.kind];
  const updateIndicator = useWorkspace((state) => state.updateIndicator);
  const [inputs, setInputs] = useState<Record<string, InputValue>>(instance.inputs);
  const [styles, setStyles] = useState<Record<string, PlotStyleValue>>(instance.styles);

  const setInput = (key: string, value: InputValue) => {
    setInputs((current) => ({ ...current, [key]: value }));
  };
  const setStyle = (key: string, patch: Partial<PlotStyleValue>) => {
    setStyles((current) => {
      const existing = current[key] ?? { color: "primary" as ColorToken, width: 1 as LineWidth };
      return { ...current, [key]: { ...existing, ...patch } };
    });
  };

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        updateIndicator(instance.id, { inputs: sanitizeInputs(instance.kind, inputs), styles });
        onDone();
      }}
    >
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {definition.inputs.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">Inputs</legend>
            {definition.inputs.map((spec) => {
              const fieldId = `${id}-${spec.key}`;
              const value = inputs[spec.key] ?? spec.default;
              if (spec.kind === "boolean") {
                return (
                  <label key={spec.key} htmlFor={fieldId} className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      id={fieldId}
                      type="checkbox"
                      checked={value === true}
                      onChange={(event) => {
                        setInput(spec.key, event.target.checked);
                      }}
                      className={cn("size-4 accent-primary", focusRing)}
                    />
                    {spec.label}
                  </label>
                );
              }
              return (
                <div key={spec.key} className="grid grid-cols-[minmax(0,1fr)_10rem] items-center gap-3">
                  <label htmlFor={fieldId} className="text-sm text-fg">
                    {spec.label}
                  </label>
                  {spec.kind === "source" ? (
                    <select
                      id={fieldId}
                      value={String(value)}
                      onChange={(event) => {
                        setInput(spec.key, event.target.value);
                      }}
                      className={fieldClasses}
                    >
                      {PRICE_SOURCES.map((source) => (
                        <option key={source} value={source}>
                          {SOURCE_LABELS[source] ?? source}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id={fieldId}
                      type="number"
                      inputMode="decimal"
                      min={spec.min}
                      max={spec.max}
                      step={spec.step}
                      value={typeof value === "number" || value === "" ? value : spec.default}
                      onChange={(event) => {
                        // Empty while the user retypes; Apply turns anything invalid back into the default.
                        const next = event.target.valueAsNumber;
                        setInput(spec.key, Number.isFinite(next) ? next : "");
                      }}
                      className={fieldClasses}
                    />
                  )}
                </div>
              );
            })}
          </fieldset>
        ) : null}
        <fieldset className="space-y-4">
          <legend className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">Style</legend>
          {definition.plots.map((plot) => {
            const style = styles[plot.key] ?? { color: plot.color, width: plot.width ?? 1 };
            const widthId = `${id}-${plot.key}-width`;
            return (
              <div key={plot.key} className="space-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-fg">
                  <input
                    type="checkbox"
                    checked={style.visible !== false}
                    onChange={(event) => {
                      setStyle(plot.key, { visible: event.target.checked });
                    }}
                    className={cn("size-4 cursor-pointer accent-primary", focusRing)}
                  />
                  {plot.label}
                </label>
                <div className="flex flex-wrap items-center gap-3">
                  <RadioGroup.Root
                    aria-label={`${plot.label} colour`}
                    value={style.color}
                    onValueChange={(color) => {
                      setStyle(plot.key, { color: color as ColorToken });
                    }}
                    className="flex flex-wrap gap-1.5"
                  >
                    {COLOR_TOKENS.map((token) => (
                      <RadioGroup.Item
                        key={token}
                        value={token}
                        aria-label={COLOR_TOKEN_LABELS[token]}
                        className={cn(
                          "flex size-7 cursor-pointer items-center justify-center rounded-sm transition-[background-color] hover:bg-surface-2",
                          "data-[state=checked]:bg-surface-3",
                          focusRing,
                        )}
                      >
                        <span aria-hidden="true" className={cn("size-4 rounded-full", TOKEN_BG[token])} />
                      </RadioGroup.Item>
                    ))}
                  </RadioGroup.Root>
                  {plot.style === "histogram" ? null : (
                    <span className="flex items-center gap-2">
                      <label htmlFor={widthId} className="text-xs text-fg-muted">
                        Width
                      </label>
                      <select
                        id={widthId}
                        value={style.width}
                        onChange={(event) => {
                          setStyle(plot.key, { width: Number(event.target.value) as LineWidth });
                        }}
                        className={cn(fieldClasses, "w-20")}
                      >
                        {LINE_WIDTHS.map((width) => (
                          <option key={width} value={width}>
                            {width}px
                          </option>
                        ))}
                      </select>
                      <label htmlFor={`${widthId}-dash`} className="text-xs text-fg-muted">
                        Style
                      </label>
                      <select
                        id={`${widthId}-dash`}
                        value={style.dash ?? "solid"}
                        onChange={(event) => {
                          const dash = PLOT_DASHES.find((candidate) => candidate === event.target.value);
                          if (dash !== undefined) setStyle(plot.key, { dash });
                        }}
                        className={cn(fieldClasses, "w-24")}
                      >
                        {PLOT_DASHES.map((dash) => (
                          <option key={dash} value={dash}>
                            {dash[0]?.toUpperCase()}
                            {dash.slice(1)}
                          </option>
                        ))}
                      </select>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </fieldset>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border p-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setInputs(sanitizeInputs(instance.kind, {}));
            setStyles(defaultStyles(instance.kind));
          }}
        >
          Reset to defaults
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" size="sm">
            Apply
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Inputs and colours of one indicator (opened from its legend row or the Indicators dialog). */
export function IndicatorSettingsDialog() {
  const editing = useWorkspace((state) => state.editingIndicator);
  const instance = useWorkspace((state) => state.indicators.find((item) => item.id === state.editingIndicator));
  const editIndicator = useWorkspace((state) => state.editIndicator);
  const container = usePortalContainer();
  const definition = instance === undefined ? undefined : INDICATORS[instance.kind];
  const close = () => {
    editIndicator(null);
  };

  return (
    <Dialog.Root
      open={editing !== null && instance !== undefined}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content
          data-slot="indicator-settings-dialog"
          className={cn(dialogClasses, "max-h-[min(40rem,calc(100dvh-2rem))] max-w-md")}
        >
          <div className={dialogHeaderClasses}>
            <Dialog.Title className="truncate text-base font-semibold">{definition?.name ?? "Indicator"}</Dialog.Title>
            <Dialog.Close aria-label="Close" className={closeButtonClasses}>
              <X aria-hidden="true" className="size-4" />
            </Dialog.Close>
          </div>
          <Dialog.Description className="sr-only">Change the indicator’s inputs and colours.</Dialog.Description>
          {instance === undefined ? null : <Editor key={instance.id} instance={instance} onDone={close} />}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
