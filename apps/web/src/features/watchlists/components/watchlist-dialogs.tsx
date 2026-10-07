"use client";

import { CreateWatchlistSchema } from "@finlytics/shared";
import type { CreateWatchlist } from "@finlytics/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { useId, useRef } from "react";
import { useForm } from "react-hook-form";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";
import { cn } from "@finlytics/ui/lib/utils";

import { watchlistNameErrors } from "../schemas";

const overlayClasses =
  "fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0";
const contentClasses = cn(
  "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2",
  "overflow-y-auto rounded-sm border border-border bg-surface-1 p-5 text-fg sm:p-6",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
);
const closeClasses =
  "absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-sm text-fg-muted transition-[color,background-color] hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

/**
 * Focus return for a dialog opened without a Radix Trigger (a menu item, an empty state): remembers what had focus
 * when it opened and returns there on close, or to `fallback` when that element is gone. Spread on the Content.
 */
function useReturnFocus(fallback: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current?.isConnected && opener.current !== document.body ? opener.current : fallback();
      target?.focus();
      opener.current = null;
    },
  };
}

/** After a list is created, renamed or deleted, the keyboard goes to the open list's search (else its tab). */
function watchlistFocusTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>('[data-slot="watchlist-search"] input') ??
    document.querySelector<HTMLElement>('[role="tab"][data-state="active"]')
  );
}

export interface WatchlistNameDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "rename";
  defaultName?: string | undefined;
  /** Resolves when saved; rejects with the message to show (a plan limit, a duplicate name). */
  onSubmit: (name: string) => Promise<void>;
}

function NameForm({
  mode,
  defaultName,
  onSubmit,
  onCancel,
}: Omit<WatchlistNameDialogProps, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const id = useId();
  const form = useForm<CreateWatchlist>({
    resolver: zodResolver(CreateWatchlistSchema, { error: watchlistNameErrors }),
    defaultValues: { name: defaultName ?? "" },
  });
  const { errors, isSubmitting } = form.formState;
  const nameError = errors.name?.message;

  return (
    <form
      noValidate
      className="mt-5 space-y-4"
      onSubmit={form.handleSubmit(async ({ name }) => {
        try {
          await onSubmit(name);
        } catch (error) {
          form.setError("root", { message: error instanceof Error ? error.message : "That didn't save. Try again." });
        }
      })}
    >
      <div className="space-y-1.5">
        <label htmlFor={`${id}-name`} className="block text-sm font-medium text-fg">
          Name
        </label>
        <Input
          id={`${id}-name`}
          autoComplete="off"
          maxLength={60}
          invalid={nameError !== undefined}
          aria-describedby={nameError === undefined ? undefined : `${id}-error`}
          {...form.register("name")}
        />
        {nameError === undefined ? null : (
          <p id={`${id}-error`} className="text-sm text-loss">
            {nameError}
          </p>
        )}
      </div>
      {errors.root?.message ? (
        <p role="alert" className="rounded-sm bg-loss/10 px-3 py-2 text-sm text-fg">
          {errors.root.message}
        </p>
      ) : null}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {mode === "create" ? "Create watchlist" : "Save name"}
        </Button>
      </div>
    </form>
  );
}

/** Create or rename a watchlist (react-hook-form + Zod; server errors such as a plan limit show in the dialog). */
export function WatchlistNameDialog({ open, onOpenChange, mode, defaultName, onSubmit }: WatchlistNameDialogProps) {
  const returnFocus = useReturnFocus(watchlistFocusTarget);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={overlayClasses} />
        <Dialog.Content data-slot="watchlist-name-dialog" className={contentClasses} {...returnFocus}>
          <Dialog.Title className="pr-8 text-lg font-semibold">
            {mode === "create" ? "New watchlist" : "Rename watchlist"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">
            {mode === "create" ? "Group instruments you follow together." : "Up to 40 characters."}
          </Dialog.Description>
          {/* Mounted only while open: every opening starts from the current name. */}
          {open ? (
            <NameForm
              mode={mode}
              defaultName={defaultName}
              onSubmit={onSubmit}
              onCancel={() => {
                onOpenChange(false);
              }}
            />
          ) : null}
          <Dialog.Close aria-label="Close" className={closeClasses}>
            <X aria-hidden="true" className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export interface DeleteWatchlistDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  count: number;
  onConfirm: () => void;
}

/** Confirms deleting a watchlist (an alert dialog: focus starts on Cancel). */
export function DeleteWatchlistDialog({ open, onOpenChange, name, count, onConfirm }: DeleteWatchlistDialogProps) {
  const returnFocus = useReturnFocus(watchlistFocusTarget);
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClasses} />
        <AlertDialog.Content className={contentClasses} {...returnFocus}>
          <AlertDialog.Title className="pr-8 text-lg font-semibold">Delete “{name}”?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
            {count === 0
              ? "It's empty. This can't be undone."
              : `Its ${String(count)} instrument${count === 1 ? "" : "s"} go with it. This can't be undone.`}
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Cancel</Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button variant="loss" onClick={onConfirm}>
                Delete watchlist
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
