"use client";

import { ChevronRight, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useRef } from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG, CONNECTABLE } from "../config";
import type { ConnectableBroker } from "../schemas";

import { DhanConnectForm, UpstoxConnectForm } from "./connect-forms";
import { BrokerMonogram } from "./broker-monogram";

/** What the wizard shows: the broker picker, or one broker's form (optionally renewing a named account). */
export interface WizardState {
  broker?: ConnectableBroker | undefined;
  /** Dhan renewal: the account's label, so the new token replaces the old one. */
  label?: string | undefined;
}

export interface AddBrokerDialogProps {
  /** Null when closed. */
  state: WizardState | null;
  onStateChange: (state: WizardState | null) => void;
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

export const dialogOverlayClasses =
  "fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0";
export const dialogContentClasses = cn(
  "fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2",
  "overflow-y-auto rounded-md bg-surface-1 p-5 text-fg ring-1 ring-surface-3 sm:p-6",
  "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:zoom-in-95",
);
/**
 * Focus return for a dialog opened without a Radix Trigger (from an empty state, a card, a toolbar): remembers what
 * had focus when it opened and returns there on close, or to `fallback` when that element is gone (the empty state
 * that opened it was replaced). Spread the result on `Dialog.Content`.
 */
export function useReturnFocus(fallback?: () => HTMLElement | null | undefined) {
  const opener = useRef<HTMLElement | null>(null);
  return {
    onOpenAutoFocus: () => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    },
    onCloseAutoFocus: (event: Event) => {
      event.preventDefault();
      const target = opener.current?.isConnected ? opener.current : fallback?.();
      target?.focus();
      opener.current = null;
    },
  };
}

export const dialogCloseClasses =
  "absolute top-3 right-3 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-[color,background-color] hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid";

/**
 * The add-broker wizard (docs/05 Brokers): pick Upstox or Dhan, then its form. A Radix Dialog: focus moves in and is
 * trapped, Escape closes, focus returns to the button that opened it.
 */
export function AddBrokerDialog({ state, onStateChange, navigate }: AddBrokerDialogProps) {
  const broker = state?.broker;
  const title = broker ? `Connect ${BROKER_CONFIG[broker].name}` : "Add a broker";
  const description = broker
    ? BROKER_CONFIG[broker].blurb
    : "Connect once. Finlytics keeps the session fresh and never shows your credentials again.";
  const back = state?.label === undefined ? () => onStateChange({}) : undefined;
  const returnFocus = useReturnFocus(() => document.querySelector<HTMLElement>('[data-slot="add-broker-button"]'));

  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onStateChange(null);
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content data-slot="add-broker-dialog" className={dialogContentClasses} {...returnFocus}>
          <Dialog.Title className="pr-8 text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{description}</Dialog.Description>
          <div className="mt-5">
            {broker === undefined ? (
              <ul className="space-y-2" aria-label="Brokers">
                {CONNECTABLE.map(({ broker: code, config }) => (
                  <li key={code}>
                    <button
                      type="button"
                      data-slot="broker-option"
                      className="flex w-full cursor-pointer items-center gap-3 rounded-md bg-surface-2 p-3 text-left transition-[background-color] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
                      onClick={() => {
                        onStateChange({ broker: code });
                      }}
                    >
                      <BrokerMonogram broker={code} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-fg">{config.name}</span>
                        <span className="block text-xs text-fg-muted">
                          {config.login === "oauth" ? "Log in with Upstox" : "Paste an access token"}
                        </span>
                      </span>
                      <ChevronRight aria-hidden="true" className="size-4 text-fg-muted" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : broker === "UPSTOX" ? (
              <UpstoxConnectForm onBack={back} navigate={navigate} />
            ) : (
              <DhanConnectForm
                onBack={back}
                defaultLabel={state?.label}
                onConnected={(account) => {
                  onStateChange(null);
                  toast.success("Dhan connected", `“${account.label}” is ready.`);
                }}
              />
            )}
          </div>
          <Dialog.Close aria-label="Close" className={dialogCloseClasses}>
            <X aria-hidden="true" className="size-4" />
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
