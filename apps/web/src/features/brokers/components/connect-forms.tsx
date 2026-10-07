"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";
import type * as React from "react";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";

import { isApiError } from "@/lib/api/client";

import { BROKER_CONFIG } from "../config";
import { brokerErrorMessage } from "../errors";
import { DhanFormSchema, PaperFormSchema, UpstoxFormSchema, connectFormErrors } from "../schemas";
import type { BrokerAccountView, ConnectPaper, ConnectUpstox, DhanConnectInput, DhanFormValues } from "../schemas";

import { FormField } from "./form-field";

/** What a form needs from its TanStack mutation (the wizard owns it, to drive the stepper). */
export interface FormMutation<TInput, TResult> {
  mutateAsync: (input: TInput) => Promise<TResult>;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
}

/** Puts the api's field errors (`errors[].path`) on the matching fields; true when any matched. */
function applyFieldErrors<T extends FieldValues>(
  error: unknown,
  fields: readonly Path<T>[],
  setError: UseFormSetError<T>,
) {
  if (!isApiError(error)) return false;
  let matched = false;
  for (const { path, message } of error.fieldErrors) {
    const field = fields.find((candidate) => candidate === path);
    if (field === undefined) continue;
    setError(field, { type: "server", message });
    matched = true;
  }
  return matched;
}

/** The form-level message: the server's reason (plan limit, broker refusal), unless it was about a field. */
function formErrorOf(mutation: FormMutation<never, unknown>, broker: string): string | undefined {
  if (!mutation.isError) return undefined;
  if (isApiError(mutation.error) && mutation.error.fieldErrors.length > 0) return undefined;
  return brokerErrorMessage(mutation.error, broker);
}

export function FormAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" data-slot="form-alert" className="rounded-sm bg-loss/10 px-3 py-2 text-sm text-fg">
      {message}
    </p>
  );
}

interface FormActionsProps {
  submitting: boolean;
  submitLabel: string;
  onBack?: (() => void) | undefined;
  /** Default "Back". */
  backLabel?: string | undefined;
}

export function FormActions({ submitting, submitLabel, onBack, backLabel = "Back" }: FormActionsProps) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          {backLabel}
        </Button>
      ) : null}
      <Button type="submit" loading={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}

/** A link to a broker's site, opening in a new tab (announced). */
export function ExternalBrokerLink({ href, children }: { href: string | undefined; children: React.ReactNode }) {
  return (
    <a
      className="inline-flex items-center gap-0.5 font-medium text-highlight underline-offset-2 hover:underline"
      href={href}
      target="_blank"
      rel="noreferrer noopener"
    >
      {children}
      <ExternalLink aria-hidden="true" className="size-3" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

export interface UpstoxConnectFormProps {
  mutation: FormMutation<ConnectUpstox, unknown>;
  onBack?: (() => void) | undefined;
}

/**
 * Upstox: the user's own Upstox app (its key and secret), then the Upstox login. The secret is sent once to our api,
 * encrypted there and never shown again.
 */
export function UpstoxConnectForm({ mutation, onBack }: UpstoxConnectFormProps) {
  const form = useForm<ConnectUpstox>({
    resolver: zodResolver(UpstoxFormSchema, { error: connectFormErrors }),
    defaultValues: { label: "Upstox", apiKey: "", apiSecret: "" },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      data-slot="upstox-connect-form"
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await mutation.mutateAsync(values);
        } catch (error) {
          applyFieldErrors(error, ["label", "apiKey", "apiSecret"], form.setError);
        }
      })}
    >
      <FormField label="Account name" error={errors.label?.message}>
        {(control) => <Input {...control} autoComplete="off" {...form.register("label")} />}
      </FormField>
      <FormField
        label="API key"
        error={errors.apiKey?.message}
        hint={
          <>
            Shown on your app in the{" "}
            <ExternalBrokerLink href={BROKER_CONFIG.UPSTOX.docsUrl}>Upstox developer console</ExternalBrokerLink>.
          </>
        }
      >
        {(control) => <Input {...control} autoComplete="off" spellCheck={false} {...form.register("apiKey")} />}
      </FormField>
      <FormField
        label="API secret"
        error={errors.apiSecret?.message}
        hint="Encrypted on our server; never shown again."
      >
        {(control) => (
          <Input {...control} type="password" autoComplete="off" spellCheck={false} {...form.register("apiSecret")} />
        )}
      </FormField>
      <FormAlert message={formErrorOf(mutation, "Upstox")} />
      <FormActions
        submitting={mutation.isPending || mutation.isSuccess}
        submitLabel="Continue to Upstox"
        onBack={onBack}
      />
    </form>
  );
}

export interface DhanConnectFormProps {
  mutation: FormMutation<DhanConnectInput, BrokerAccountView>;
  onBack?: (() => void) | undefined;
  /** Renewing an account: the same label replaces its token. */
  defaultLabel?: string | undefined;
  onConnected: (account: BrokerAccountView) => void;
}

/** Dhan: the client ID and an access token from web.dhan.co, checked with Dhan before anything is saved. */
export function DhanConnectForm({ mutation, onBack, defaultLabel, onConnected }: DhanConnectFormProps) {
  const form = useForm<DhanFormValues, unknown, DhanConnectInput>({
    resolver: zodResolver(DhanFormSchema, { error: connectFormErrors }),
    defaultValues: { label: defaultLabel ?? "Dhan", clientId: "", accessToken: "" },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      data-slot="dhan-connect-form"
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          onConnected(await mutation.mutateAsync(values));
        } catch (error) {
          applyFieldErrors(error, ["label", "clientId", "accessToken"], form.setError);
        }
      })}
    >
      <FormField
        label="Account name"
        error={errors.label?.message}
        hint={defaultLabel ? "Keep the name to replace this account's token." : undefined}
      >
        {(control) => <Input {...control} autoComplete="off" {...form.register("label")} />}
      </FormField>
      <FormField label="Client ID" error={errors.clientId?.message} hint="Optional — read from your token.">
        {(control) => (
          <Input
            {...control}
            autoComplete="off"
            spellCheck={false}
            inputMode="numeric"
            {...form.register("clientId")}
          />
        )}
      </FormField>
      <FormField
        label="Access token"
        error={errors.accessToken?.message}
        hint="Valid 24 hours, renewed automatically. Paste it as copied; Finlytics encrypts it and never shows it again."
      >
        {(control) => (
          <Input {...control} type="password" autoComplete="off" spellCheck={false} {...form.register("accessToken")} />
        )}
      </FormField>
      <FormAlert message={formErrorOf(mutation, "Dhan")} />
      <FormActions submitting={mutation.isPending} submitLabel="Connect Dhan" onBack={onBack} />
    </form>
  );
}

export interface PaperConnectFormProps {
  mutation: FormMutation<ConnectPaper, BrokerAccountView>;
  onBack?: (() => void) | undefined;
  onConnected: (account: BrokerAccountView) => void;
}

/** Paper: a name, nothing else. */
export function PaperConnectForm({ mutation, onBack, onConnected }: PaperConnectFormProps) {
  const form = useForm<ConnectPaper>({
    resolver: zodResolver(PaperFormSchema, { error: connectFormErrors }),
    defaultValues: { label: "Paper" },
  });
  const { errors } = form.formState;

  return (
    <form
      noValidate
      data-slot="paper-connect-form"
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          onConnected(await mutation.mutateAsync(values));
        } catch (error) {
          applyFieldErrors(error, ["label"], form.setError);
        }
      })}
    >
      <FormField
        label="Account name"
        error={errors.label?.message}
        hint="Orders are simulated against live prices; nothing reaches an exchange."
      >
        {(control) => <Input {...control} autoComplete="off" {...form.register("label")} />}
      </FormField>
      <FormAlert message={formErrorOf(mutation, "Paper")} />
      <FormActions submitting={mutation.isPending} submitLabel="Add paper account" onBack={onBack} />
    </form>
  );
}
