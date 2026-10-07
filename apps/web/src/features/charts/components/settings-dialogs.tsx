"use client";

import { X } from "lucide-react";
import { Dialog, RadioGroup } from "radix-ui";
import { useId, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { MAX_NOTE_LENGTH } from "../lib/drawings/types";
import { DEFAULT_SETTINGS } from "../schemas";
import type { ChartSettings } from "../schemas";
import { useWorkspace } from "../store/workspace-store";

import {
  closeButtonClasses,
  dialogClasses,
  dialogHeaderClasses,
  focusRing,
  overlayClasses,
  usePortalContainer,
} from "./ui";

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-center justify-between gap-4 py-2 text-sm text-fg">
      {label}
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(event) => {
          onChange(event.target.checked);
        }}
        className={cn("size-4 cursor-pointer accent-primary", focusRing)}
      />
    </label>
  );
}

function Shell({
  open,
  onOpenChange,
  title,
  description,
  slot,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  slot: string;
  children: React.ReactNode;
}) {
  const container = usePortalContainer();
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal container={container}>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content data-slot={slot} className={cn(dialogClasses, "max-w-md")}>
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

/** Chart settings: grid, crosshair, the last-price line, session breaks; applied as they change. */
export function ChartSettingsDialog() {
  const open = useWorkspace((state) => state.dialog === "settings");
  const openDialog = useWorkspace((state) => state.openDialog);
  const settings = useWorkspace((state) => state.settings);
  const setSettings = useWorkspace((state) => state.setSettings);
  const update = (patch: Partial<ChartSettings>) => {
    setSettings({ ...settings, ...patch });
  };

  return (
    <Shell
      open={open}
      onOpenChange={(next) => {
        openDialog(next ? "settings" : null);
      }}
      title="Chart settings"
      description="Grid, crosshair and price line options. Changes apply at once."
      slot="chart-settings-dialog"
    >
      <div className="space-y-5 overflow-y-auto p-4">
        <section aria-labelledby="settings-canvas">
          <h3 id="settings-canvas" className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            Canvas
          </h3>
          <Toggle
            label="Vertical grid lines"
            checked={settings.gridVertical}
            onChange={(gridVertical) => {
              update({ gridVertical });
            }}
          />
          <Toggle
            label="Horizontal grid lines"
            checked={settings.gridHorizontal}
            onChange={(gridHorizontal) => {
              update({ gridHorizontal });
            }}
          />
          <Toggle
            label="Last price line"
            checked={settings.priceLine}
            onChange={(priceLine) => {
              update({ priceLine });
            }}
          />
          <Toggle
            label="Session breaks (intraday)"
            checked={settings.sessionBreaks}
            onChange={(sessionBreaks) => {
              update({ sessionBreaks });
            }}
          />
        </section>
        <section aria-labelledby="settings-crosshair">
          <h3 id="settings-crosshair" className="mb-2 text-xs font-medium tracking-wide text-fg-muted uppercase">
            Crosshair
          </h3>
          <RadioGroup.Root
            aria-labelledby="settings-crosshair"
            value={settings.crosshair}
            onValueChange={(value) => {
              update({ crosshair: value === "magnet" ? "magnet" : "normal" });
            }}
            className="inline-flex gap-1 rounded-md border border-border bg-surface-2 p-1"
          >
            {(
              [
                ["normal", "Free"],
                ["magnet", "Snap to OHLC"],
              ] as const
            ).map(([value, label]) => (
              <RadioGroup.Item
                key={value}
                value={value}
                className={cn(
                  "h-7 cursor-pointer rounded-md px-3 text-sm text-fg-muted transition-[color,background-color] hover:text-fg",
                  "data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
                  focusRing,
                )}
              >
                {label}
              </RadioGroup.Item>
            ))}
          </RadioGroup.Root>
        </section>
        <section aria-labelledby="settings-time">
          <h3 id="settings-time" className="text-xs font-medium tracking-wide text-fg-muted uppercase">
            Time
          </h3>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-fg-muted">Time zone</dt>
            <dd className="text-fg">(UTC+05:30) Kolkata · exchange time</dd>
            <dt className="text-fg-muted">Session</dt>
            <dd className="text-fg">Regular hours (NSE/BSE 09:15–15:30, MCX 09:00–23:30)</dd>
          </dl>
        </section>
      </div>
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
            "h-10 w-full rounded-md border border-border-strong bg-surface-2 px-3 text-sm text-fg",
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
