"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { KeyRound, LogIn, MoreHorizontal, Pencil, Star, Unplug, X } from "lucide-react";
import { AlertDialog, Dialog, DropdownMenu } from "radix-ui";
import { useRef, useState } from "react";
import { useForm } from "react-hook-form";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";
import { cn } from "@finlytics/ui/lib/utils";

import { isApiError } from "@/lib/api/client";
import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG, needsLogin } from "../config";
import { brokerErrorMessage } from "../errors";
import { useRelogin, useRemoveBrokerAccount, useUpdateBrokerAccount } from "../hooks/use-brokers";
import { RenameFormSchema, connectFormErrors } from "../schemas";
import type { BrokerAccountView, ConnectPaper } from "../schemas";

import { FormActions, FormAlert } from "./connect-forms";
import { dialogCloseClasses, dialogContentClasses, dialogOverlayClasses, useReturnFocus } from "./dialog";
import { FormField } from "./form-field";

/** A menu surface: surface-1 with the 1px border token, no shadow. */
export const menuContentClasses =
  "z-50 min-w-48 rounded-md border border-border bg-surface-1 p-1 text-fg motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0";

/** A menu row: borderless, tinted when highlighted, the solid focus outline for keyboard users. */
export const menuItemClasses = cn(
  "flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm select-none",
  "data-[highlighted]:bg-surface-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
  "[&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
);

export interface AccountActionsProps {
  account: BrokerAccountView;
  /** Dhan: open the wizard on the token step with this account's label. */
  onRenewToken: (account: BrokerAccountView) => void;
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
  /** Hide the inline login button (the dashboard shows its own). */
  showLoginButton?: boolean | undefined;
}

/**
 * One account's actions: an inline "Log in again" / "Paste new token" while the session needs the user, and a menu
 * with re-login or token renewal, set as default, rename and disconnect (confirmed).
 */
export function AccountActions({ account, onRenewToken, navigate, showLoginButton = true }: AccountActionsProps) {
  const config = BROKER_CONFIG[account.broker];
  const relogin = useRelogin(navigate);
  const update = useUpdateBrokerAccount();
  const [dialog, setDialog] = useState<"rename" | "disconnect" | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const opening = useRef(false);

  const startLogin = () => {
    if (config.login === "token") {
      onRenewToken(account);
      return;
    }
    relogin.mutate(account, {
      onError: (error) =>
        toast.error(`Couldn't start the ${config.name} login`, brokerErrorMessage(error, config.name)),
    });
  };

  const openDialog = (which: "rename" | "disconnect") => {
    opening.current = true;
    setDialog(which);
  };

  return (
    <div className="flex items-center justify-end gap-1" data-slot="account-actions">
      {showLoginButton && needsLogin(account.status) && config.login !== "none" ? (
        <Button size="sm" onClick={startLogin} loading={relogin.isPending || relogin.isSuccess}>
          <LogIn aria-hidden="true" />
          {config.login === "token" ? "Paste new token" : "Log in again"}
        </Button>
      ) : null}
      <DropdownMenu.Root modal={false}>
        <DropdownMenu.Trigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${account.label}`}
            data-slot="account-actions-trigger"
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className={menuContentClasses}
            onCloseAutoFocus={(event) => {
              // A dialog is opening from the menu: it takes focus, and returns it to the trigger itself.
              if (opening.current) event.preventDefault();
              opening.current = false;
            }}
          >
            {config.login === "oauth" ? (
              <DropdownMenu.Item className={menuItemClasses} onSelect={startLogin}>
                <LogIn aria-hidden="true" />
                Log in again
              </DropdownMenu.Item>
            ) : null}
            {config.login === "token" ? (
              <DropdownMenu.Item className={menuItemClasses} onSelect={startLogin}>
                <KeyRound aria-hidden="true" />
                Renew token
              </DropdownMenu.Item>
            ) : null}
            {!account.isDefault && account.status === "ACTIVE" ? (
              <DropdownMenu.Item
                className={menuItemClasses}
                onSelect={() => {
                  update.mutate(
                    { id: account.id, isDefault: true },
                    {
                      onSuccess: () => toast.success(`“${account.label}” is now your default broker`),
                      onError: (error) =>
                        toast.error("Couldn't change the default", brokerErrorMessage(error, config.name)),
                    },
                  );
                }}
              >
                <Star aria-hidden="true" />
                Set as default
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item className={menuItemClasses} onSelect={() => openDialog("rename")}>
              <Pencil aria-hidden="true" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item
              className={cn(menuItemClasses, "text-loss [&_svg]:text-loss")}
              onSelect={() => openDialog("disconnect")}
            >
              <Unplug aria-hidden="true" />
              Disconnect
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      <RenameDialog
        account={account}
        open={dialog === "rename"}
        onOpenChange={(open) => setDialog(open ? "rename" : null)}
        returnTo={() => trigger.current}
      />
      <DisconnectDialog
        account={account}
        open={dialog === "disconnect"}
        onOpenChange={(open) => setDialog(open ? "disconnect" : null)}
        returnTo={() => trigger.current}
      />
    </div>
  );
}

interface AccountDialogProps {
  account: BrokerAccountView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the dialog closes (the menu item that opened it is gone by then). */
  returnTo: () => HTMLElement | null;
}

function RenameDialog({ account, open, onOpenChange, returnTo }: AccountDialogProps) {
  const returnFocus = useReturnFocus(returnTo);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content data-slot="rename-account-dialog" className={dialogContentClasses} {...returnFocus}>
          <Dialog.Title className="pr-8 text-lg font-semibold">Rename “{account.label}”</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">
            The name shows in the account switcher and on every order placed through it.
          </Dialog.Description>
          {open ? (
            <RenameForm
              account={account}
              onDone={() => {
                onOpenChange(false);
              }}
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

function RenameForm({
  account,
  onDone,
  onCancel,
}: {
  account: BrokerAccountView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const update = useUpdateBrokerAccount();
  const form = useForm<ConnectPaper>({
    resolver: zodResolver(RenameFormSchema, { error: connectFormErrors }),
    defaultValues: { label: account.label },
  });
  const config = BROKER_CONFIG[account.broker];
  const formError =
    update.isError && !(isApiError(update.error) && update.error.code === "CONFLICT")
      ? brokerErrorMessage(update.error, config.name)
      : undefined;
  return (
    <form
      noValidate
      className="mt-5 space-y-4"
      onSubmit={form.handleSubmit(async ({ label }) => {
        if (label === account.label) {
          onDone();
          return;
        }
        try {
          await update.mutateAsync({ id: account.id, label });
          onDone();
          toast.success(`Renamed to “${label}”`);
        } catch (error) {
          if (isApiError(error) && error.code === "CONFLICT") {
            form.setError("label", { type: "server", message: brokerErrorMessage(error, config.name) });
          }
        }
      })}
    >
      <FormField label="Account name" error={form.formState.errors.label?.message}>
        {(control) => <Input {...control} autoComplete="off" {...form.register("label")} />}
      </FormField>
      <FormAlert message={formError} />
      <FormActions submitting={update.isPending} submitLabel="Save" onBack={onCancel} backLabel="Cancel" />
    </form>
  );
}

function DisconnectDialog({ account, open, onOpenChange, returnTo }: AccountDialogProps) {
  const remove = useRemoveBrokerAccount();
  const config = BROKER_CONFIG[account.broker];
  const returnFocus = useReturnFocus(returnTo);
  const consequence: React.ReactNode =
    account.broker === "PAPER"
      ? "Its simulated orders and positions go with it."
      : `Finlytics deletes its encrypted credentials for this ${config.name} account, and strategies using it stop placing orders.`;
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={dialogOverlayClasses} />
        <AlertDialog.Content data-slot="disconnect-account-dialog" className={dialogContentClasses} {...returnFocus}>
          <AlertDialog.Title className="pr-8 text-lg font-semibold">Disconnect “{account.label}”?</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm text-fg-muted">
            {consequence} You can connect it again later.
          </AlertDialog.Description>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary">Keep it</Button>
            </AlertDialog.Cancel>
            <Button
              variant="loss"
              loading={remove.isPending}
              onClick={() => {
                remove.mutate(account, {
                  onSuccess: () => {
                    onOpenChange(false);
                    toast.success(`Disconnected “${account.label}”`);
                  },
                  onError: (error) => {
                    onOpenChange(false);
                    toast.error("Couldn't disconnect the account", brokerErrorMessage(error, config.name));
                  },
                });
              }}
            >
              Disconnect
            </Button>
          </div>
          <AlertDialog.Cancel aria-label="Close" className={dialogCloseClasses}>
            <X aria-hidden="true" className="size-4" />
          </AlertDialog.Cancel>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
