"use client";

import { RadioGroup } from "radix-ui";
import { useId } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { COLOR_TOKENS, COLOR_TOKEN_LABELS } from "../lib/indicators/registry";
import type { ColorToken } from "../lib/indicators/registry";

import { TOKEN_BG, focusRing } from "./ui";

/** A labelled on/off switch row. */
export function SwitchRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean | undefined;
}) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 py-1.5 text-sm text-fg",
        disabled && "cursor-default opacity-50",
      )}
    >
      {label}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className={cn("size-4 cursor-pointer accent-primary", focusRing)}
      />
    </label>
  );
}

/** A row: a label on the left, a control on the right. */
export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm text-fg">
      <span>{label}</span>
      {children}
    </div>
  );
}

/** One choice out of a few, as a compact segmented radio group. */
export function Segments<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  /** `[value, content, accessible name]`; the name is required when the content is a picture. */
  options: readonly (readonly [T, React.ReactNode, string?])[];
  onChange: (value: T) => void;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={String(value)}
      onValueChange={(next) => {
        const match = options.find(([option]) => String(option) === next);
        if (match !== undefined) onChange(match[0]);
      }}
      className="inline-flex gap-0.5 rounded-sm border border-border bg-surface-2 p-0.5"
    >
      {options.map(([option, text, name]) => (
        <RadioGroup.Item
          key={String(option)}
          value={String(option)}
          aria-label={name}
          className={cn(
            "flex h-7 min-w-8 cursor-pointer items-center justify-center rounded-sm px-2 text-xs text-fg-muted transition-[color,background-color] hover:text-fg",
            "data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
            focusRing,
          )}
        >
          {text}
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}

/** The colour palette (design tokens, so both themes stay legible) as a swatch radio group. */
export function ColorSwatches({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ColorToken;
  onChange: (value: ColorToken) => void;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const token = COLOR_TOKENS.find((candidate) => candidate === next);
        if (token !== undefined) onChange(token);
      }}
      className="grid grid-cols-5 gap-1.5"
    >
      {COLOR_TOKENS.map((token) => (
        <RadioGroup.Item
          key={token}
          value={token}
          aria-label={COLOR_TOKEN_LABELS[token]}
          title={COLOR_TOKEN_LABELS[token]}
          className={cn(
            "size-6 cursor-pointer rounded-sm ring-offset-2 ring-offset-surface-1",
            "data-[state=checked]:ring-2 data-[state=checked]:ring-fg",
            TOKEN_BG[token],
            focusRing,
          )}
        />
      ))}
    </RadioGroup.Root>
  );
}

const WIDTH_CLASSES: Readonly<Record<number, string>> = {
  1: "border-t",
  2: "border-t-2",
  3: "border-t-[3px]",
  4: "border-t-4",
};

/** Line samples for width and dash pickers. */
export function LineSample({ width, dash = "solid" }: { width: number; dash?: "solid" | "dashed" | "dotted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block w-5 border-current",
        WIDTH_CLASSES[width] ?? "border-t-2",
        dash === "dashed" ? "border-dashed" : dash === "dotted" ? "border-dotted" : "border-solid",
      )}
    />
  );
}
