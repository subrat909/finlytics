"use client";

import type { BrokerLimits } from "@finlytics/shared";
import { Check, ChevronRight, Copy, LoaderCircle, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useId, useState } from "react";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { cn } from "@finlytics/ui/lib/utils";

import { toast } from "@/stores/toast.store";

import { BROKER_CONFIG, CATALOG, CONNECTABLE } from "../config";
import { useConnectDhan, useConnectPaper, useConnectUpstox } from "../hooks/use-brokers";
import { limitReason } from "../lib/limits";
import type { BrokerAccountView, ConnectableBroker } from "../schemas";

import { BrokerMonogram } from "./broker-monogram";
import { DhanConnectForm, ExternalBrokerLink, PaperConnectForm, UpstoxConnectForm } from "./connect-forms";
import { dialogCloseClasses, dialogContentClasses, dialogOverlayClasses, useReturnFocus } from "./dialog";

/** What the wizard shows: the broker picker, or one broker's steps (optionally renewing a named Dhan account). */
export interface WizardState {
  broker?: ConnectableBroker | undefined;
  /** Dhan renewal: the account's label, so the new token replaces the old one. */
  label?: string | undefined;
}

export interface ConnectWizardProps {
  /** Null when closed. */
  state: WizardState | null;
  onStateChange: (state: WizardState | null) => void;
  /** The plan's limits, when known: brokers at the limit are disabled in the picker, with the reason. */
  limits?: BrokerLimits | undefined;
  /** Upstox's redirect (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

const UPSTOX_STEPS = ["Create app", "Redirect URL", "API keys", "Log in"] as const;
const DHAN_STEPS = ["Generate token", "Enter details", "Verify"] as const;

/** The progress strip: done steps ticked, the current one marked for assistive technology. */
function Stepper({ steps, current }: { steps: readonly string[]; current: number }) {
  return (
    <ol aria-label="Steps" data-slot="wizard-steps" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {steps.map((label, index) => {
        const state = index < current ? "done" : index === current ? "current" : "todo";
        return (
          <li
            key={label}
            data-state={state}
            aria-current={state === "current" ? "step" : undefined}
            className="flex items-center gap-2"
          >
            {index > 0 ? <span aria-hidden="true" className="h-px w-3 bg-border sm:w-5" /> : null}
            <span
              aria-hidden="true"
              className={cn(
                "flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular",
                state === "todo" ? "bg-surface-2 text-fg-muted" : "bg-primary text-primary-fg",
              )}
            >
              {state === "done" ? <Check className="size-3" /> : index + 1}
            </span>
            <span
              className={cn(
                "text-xs",
                state === "current" ? "font-medium text-fg" : "text-fg-muted",
                // Small screens: only the current step's name.
                state === "current" ? undefined : "sr-only sm:not-sr-only",
              )}
            >
              {label}
              {state === "done" ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Numbered instructions inside a step. */
function Instructions({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal space-y-2 rounded-sm border border-border bg-surface-2/50 py-3 pr-3 pl-8 text-sm text-fg marker:text-fg-muted">
      {children}
    </ol>
  );
}

function StepActions({
  onBack,
  onNext,
  nextLabel = "Next",
}: {
  onBack?: (() => void) | undefined;
  onNext: () => void;
  nextLabel?: string;
}) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <Button onClick={onNext}>
        {nextLabel}
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}

/** Copies `text`; false when the browser refuses (no clipboard outside a secure context, permission denied). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The exact redirect URL with a copy button (Upstox refuses a login whose redirect differs by a character). */
function RedirectUrl() {
  const inputId = useId();
  const [copied, setCopied] = useState<"idle" | "copied" | "failed">("idle");
  const url = `${window.location.origin}/v1/brokers/upstox/callback`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={inputId} className="block text-sm font-medium text-fg">
        Redirect URL
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          readOnly
          value={url}
          data-slot="upstox-redirect-url"
          onFocus={(event) => {
            event.currentTarget.select();
          }}
          className="h-10 w-full min-w-0 rounded-sm border border-border-strong bg-surface-2 px-3 text-sm text-fg tabular focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
        />
        <Button
          variant="secondary"
          onClick={async () => {
            setCopied((await copyText(url)) ? "copied" : "failed");
          }}
        >
          {copied === "copied" ? <Check aria-hidden="true" className="text-profit" /> : <Copy aria-hidden="true" />}
          {copied === "copied" ? "Copied" : "Copy"}
        </Button>
      </div>
      <p role="status" className="text-xs text-fg-muted">
        {copied === "failed"
          ? "Couldn't copy: select the URL and copy it yourself."
          : "Paste it into the app's redirect URL field, exactly as shown."}
      </p>
    </div>
  );
}

interface FlowProps {
  onBack?: (() => void) | undefined;
  onDone: () => void;
}

function UpstoxFlow({ onBack, navigate }: FlowProps & { navigate?: ((url: string) => void) | undefined }) {
  const [step, setStep] = useState(0);
  const connect = useConnectUpstox(navigate);
  const current = connect.isSuccess ? 3 : step;
  return (
    <div className="space-y-5">
      <Stepper steps={UPSTOX_STEPS} current={current} />
      {current === 0 ? (
        <div className="space-y-4">
          <Instructions>
            <li>
              Open the{" "}
              <ExternalBrokerLink href={BROKER_CONFIG.UPSTOX.docsUrl}>Upstox developer console</ExternalBrokerLink> and
              sign in with your Upstox account.
            </li>
            <li>Choose “New app” and give it any name, such as Finlytics.</li>
            <li>Keep that page open: the app needs our redirect URL next.</li>
          </Instructions>
          <StepActions onBack={onBack} onNext={() => setStep(1)} />
        </div>
      ) : current === 1 ? (
        <div className="space-y-4">
          <RedirectUrl />
          <StepActions onBack={() => setStep(0)} onNext={() => setStep(2)} nextLabel="I've set it" />
        </div>
      ) : current === 2 ? (
        <UpstoxConnectForm mutation={connect} onBack={() => setStep(1)} />
      ) : (
        <p role="status" className="flex items-center gap-2 text-sm text-fg">
          <LoaderCircle aria-hidden="true" className="size-4 text-primary motion-safe:animate-spin" />
          Opening the Upstox login. Approve Finlytics there and you&apos;ll come straight back here.
        </p>
      )}
    </div>
  );
}

function DhanFlow({ onBack, onDone, label }: FlowProps & { label?: string | undefined }) {
  const renewing = label !== undefined;
  const [step, setStep] = useState(renewing ? 1 : 0);
  const connect = useConnectDhan();
  const current = step === 1 && connect.isPending ? 2 : step;
  return (
    <div className="space-y-5">
      <Stepper steps={DHAN_STEPS} current={current} />
      {current === 0 ? (
        <div className="space-y-4">
          <Instructions>
            <li>
              Log in to <ExternalBrokerLink href={BROKER_CONFIG.DHAN.docsUrl}>web.dhan.co</ExternalBrokerLink>.
            </li>
            <li>Open My Profile, then “Access DhanHQ APIs”.</li>
            <li>
              Generate an access token and copy it. Your client ID is optional: Finlytics reads it from the token.
            </li>
          </Instructions>
          <p className="text-xs text-fg-muted">
            Dhan tokens are valid 24 hours. Finlytics renews yours automatically before it expires, so you paste it
            once.
          </p>
          <StepActions onBack={onBack} onNext={() => setStep(1)} />
        </div>
      ) : (
        <DhanConnectForm
          mutation={connect}
          defaultLabel={label}
          onBack={() => setStep(0)}
          onConnected={(account: BrokerAccountView) => {
            onDone();
            toast.success(renewing ? "Dhan token renewed" : "Dhan connected", `“${account.label}” is ready.`);
          }}
        />
      )}
    </div>
  );
}

function PaperFlow({ onBack, onDone }: FlowProps) {
  const connect = useConnectPaper();
  return (
    <PaperConnectForm
      mutation={connect}
      onBack={onBack}
      onConnected={(account) => {
        onDone();
        toast.success("Paper account added", `“${account.label}” is ready for simulated orders.`);
      }}
    />
  );
}

/** Which brokers the picker offers, and why one is unavailable. */
function BrokerPicker({
  limits,
  onPick,
}: {
  limits?: BrokerLimits | undefined;
  onPick: (broker: ConnectableBroker) => void;
}) {
  const soon = CATALOG.filter((code) => BROKER_CONFIG[code].availability === "soon");
  return (
    <div className="space-y-4">
      <ul className="space-y-2" aria-label="Brokers">
        {CONNECTABLE.map(({ broker, config }) => {
          const reason = limitReason(limits, broker);
          const reasonId = `connect-${broker.toLowerCase()}-reason`;
          return (
            <li key={broker}>
              <button
                type="button"
                data-slot="broker-option"
                data-broker={broker}
                disabled={reason !== undefined}
                aria-describedby={reason === undefined ? undefined : reasonId}
                className="flex w-full cursor-pointer items-center gap-3 rounded-sm bg-surface-2 p-3 text-left transition-[background-color] hover:bg-surface-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-surface-2"
                onClick={() => {
                  onPick(broker);
                }}
              >
                <BrokerMonogram broker={broker} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">{config.name}</span>
                  <span className="block text-xs text-fg-muted">{config.blurb}</span>
                  {reason === undefined ? null : (
                    <span id={reasonId} className="mt-1 block text-xs font-medium text-warning">
                      {reason}
                    </span>
                  )}
                </span>
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-fg-muted">Coming soon: {soon.map((code) => BROKER_CONFIG[code].name).join(", ")}.</p>
    </div>
  );
}

const TITLES: Readonly<Record<ConnectableBroker, string>> = {
  UPSTOX: "Connect Upstox",
  DHAN: "Connect Dhan",
  PAPER: "Add a paper account",
};

/**
 * The connect wizard (plan phase-1b "Brokers"): pick a broker, then its steps (Upstox: create app → redirect URL →
 * API keys → log in; Dhan: generate token → details → verify; paper: a name). A Radix Dialog: focus moves in and is
 * trapped, Escape closes, focus returns to what opened it.
 */
export function ConnectWizard({ state, onStateChange, limits, navigate }: ConnectWizardProps) {
  const broker = state?.broker;
  const renewing = broker === "DHAN" && state?.label !== undefined;
  const title = broker === undefined ? "Connect a broker" : renewing ? "Renew Dhan token" : TITLES[broker];
  const description =
    broker === undefined
      ? "Connect once. Finlytics keeps the session fresh and never shows your credentials again."
      : BROKER_CONFIG[broker].blurb;
  const back = state?.label === undefined ? () => onStateChange({}) : undefined;
  const close = () => onStateChange(null);
  const returnFocus = useReturnFocus(() => document.querySelector<HTMLElement>('[data-slot="connect-broker-button"]'));

  return (
    <Dialog.Root
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClasses} />
        <Dialog.Content data-slot="connect-wizard" className={dialogContentClasses} {...returnFocus}>
          <Dialog.Title className="pr-8 text-lg font-semibold">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-fg-muted">{description}</Dialog.Description>
          <div className="mt-5">
            {broker === undefined ? (
              <BrokerPicker limits={limits} onPick={(picked) => onStateChange({ broker: picked })} />
            ) : broker === "UPSTOX" ? (
              <UpstoxFlow onBack={back} onDone={close} navigate={navigate} />
            ) : broker === "DHAN" ? (
              <DhanFlow onBack={back} onDone={close} label={state?.label} />
            ) : (
              <PaperFlow onBack={back} onDone={close} />
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
