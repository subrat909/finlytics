"use client";

import { CreateWatchlistSchema } from "@finlytics/shared";
import type { CreateWatchlist } from "@finlytics/shared";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { AlertDialog, Dialog } from "radix-ui";
import { useForm } from "react-hook-form";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";

import {
  dialogCloseClasses,
  dialogContentClasses,
  dialogOverlayClasses,
  useReturnFocus,
} from "@/features/brokers/components/add-broker-dialog";
import { FormField } from "@/features/brokers/components/form-field";

import { watchlistNameErrors } from "../schemas";

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
  const form = useForm<CreateWatchlist>({
    resolver: zodResolver(CreateWatchlistSchema, { error: watchlistNameErrors }),
    defaultValues: { name: defaultName ?? "" },
  });
  const { errors, isSubmitting } = form.formState;

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
      <FormField label="Name" error={errors.name?.message}>
        {(control) => <Input {...control} autoComplete="off" maxLength={60} {...form.register("name")} />}
      </FormField>
      {errors.root?.message ? (
        <p role="alert" className="rounded-md bg-loss/10 px-3 py-2 text-sm text-fg">
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
  // A new list opens its tab: the search is where the user goes next.
  const returnFocus = useReturnFocus(() =>
    document.querySelector<HTMLElement>('[data-slot="instrument-search"] input'),
  );
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content data-slot="watchlist-name-dialog" className={dialogContentClasses} {...returnFocus}>
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
          <Dialog.Close aria-label="Close" className={dialogCloseClasses}>
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
  // The deleted list's tab is gone: land on the tabs.
  const returnFocus = useReturnFocus(() => document.querySelector<HTMLElement>('[role="tab"][data-state="active"]'));
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClasses} />
        <AlertDialog.Content className={dialogContentClasses} {...returnFocus}>
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
