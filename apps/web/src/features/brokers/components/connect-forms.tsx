"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ExternalLink } from "lucide-react";
import { useForm } from "react-hook-form";
import type { FieldValues, Path, UseFormSetError } from "react-hook-form";

import { Button } from "@finlytics/ui/components/button";
import { Input } from "@finlytics/ui/components/input";

import { isApiError } from "@/lib/api/client";

import { BROKER_CONFIG } from "../config";
import { brokerErrorMessage } from "../errors";
import { useConnectDhan, useConnectUpstox } from "../hooks/use-brokers";
import { DhanFormSchema, UpstoxFormSchema, connectFormErrors } from "../schemas";
import type { BrokerAccountView, ConnectDhan, ConnectUpstox } from "../schemas";

import { FormField } from "./form-field";

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

function FormAlert({ message }: { message: string | undefined }) {
  if (!message) return null;
  return (
    <p role="alert" data-slot="form-alert" className="rounded-md bg-loss/10 px-3 py-2 text-sm text-fg">
      {message}
    </p>
  );
}

interface FormActionsProps {
  submitting: boolean;
  submitLabel: string;
  onBack?: (() => void) | undefined;
}

function FormActions({ submitting, submitLabel, onBack }: FormActionsProps) {
  return (
    <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
      {onBack ? (
        <Button variant="secondary" onClick={onBack}>
          Back
        </Button>
      ) : null}
      <Button type="submit" loading={submitting}>
        {submitLabel}
      </Button>
    </div>
  );
}

export interface UpstoxConnectFormProps {
  onBack?: (() => void) | undefined;
  /** Where the browser goes after the api returns the login URL (tests pass a spy). */
  navigate?: ((url: string) => void) | undefined;
}

/**
 * Upstox: the user's own Upstox app (registered once at Upstox), then the Upstox login. The secret is sent once to our
 * api, encrypted there and never shown again.
 */
export function UpstoxConnectForm({ onBack, navigate }: UpstoxConnectFormProps) {
  const connect = useConnectUpstox(navigate);
  const form = useForm<ConnectUpstox>({
    resolver: zodResolver(UpstoxFormSchema, { error: connectFormErrors }),
    defaultValues: { label: "Upstox", apiKey: "", apiSecret: "" },
  });
  const { errors } = form.formState;
  const redirectUri = `${window.location.origin}/v1/brokers/upstox/callback`;
  const formError =
    connect.isError && !(isApiError(connect.error) && connect.error.fieldErrors.length > 0)
      ? brokerErrorMessage(connect.error, "Upstox")
      : undefined;

  return (
    <form
      noValidate
      data-slot="upstox-connect-form"
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          await connect.mutateAsync(values);
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
            From your app in the{" "}
            <a
              className="inline-flex items-center gap-0.5 font-medium text-highlight underline-offset-2 hover:underline"
              href={BROKER_CONFIG.UPSTOX.docsUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              Upstox developer console
              <ExternalLink aria-hidden="true" className="size-3" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            .
          </>
        }
      >
        {(control) => <Input {...control} autoComplete="off" spellCheck={false} {...form.register("apiKey")} />}
      </FormField>
      <FormField label="API secret" error={errors.apiSecret?.message}>
        {(control) => (
          <Input {...control} type="password" autoComplete="off" spellCheck={false} {...form.register("apiSecret")} />
        )}
      </FormField>
      <div className="space-y-1 rounded-md bg-surface-2 px-3 py-2 text-xs text-fg-muted">
        <p>Set your Upstox app&apos;s redirect URL to exactly:</p>
        <p className="tabular break-all text-fg select-all">{redirectUri}</p>
      </div>
      <FormAlert message={formError} />
      <FormActions
        submitting={connect.isPending || connect.isSuccess}
        submitLabel="Continue to Upstox"
        onBack={onBack}
      />
    </form>
  );
}

export interface DhanConnectFormProps {
  onBack?: (() => void) | undefined;
  /** Renewing an account: the same label replaces its token (plan P5, relogin for Dhan). */
  defaultLabel?: string | undefined;
  onConnected: (account: BrokerAccountView) => void;
}

/** Dhan: the client ID and a 30-day access token from the Dhan dashboard, checked with Dhan before it's saved. */
export function DhanConnectForm({ onBack, defaultLabel, onConnected }: DhanConnectFormProps) {
  const connect = useConnectDhan();
  const form = useForm<ConnectDhan>({
    resolver: zodResolver(DhanFormSchema, { error: connectFormErrors }),
    defaultValues: { label: defaultLabel ?? "Dhan", clientId: "", accessToken: "" },
  });
  const { errors } = form.formState;
  const formError =
    connect.isError && !(isApiError(connect.error) && connect.error.fieldErrors.length > 0)
      ? brokerErrorMessage(connect.error, "Dhan")
      : undefined;

  return (
    <form
      noValidate
      data-slot="dhan-connect-form"
      className="space-y-4"
      onSubmit={form.handleSubmit(async (values) => {
        try {
          onConnected(await connect.mutateAsync(values));
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
      <FormField label="Client ID" error={errors.clientId?.message}>
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
        hint="Dhan → My Profile → Access DhanHQ APIs → generate a token (valid 30 days)."
      >
        {(control) => (
          <Input {...control} type="password" autoComplete="off" spellCheck={false} {...form.register("accessToken")} />
        )}
      </FormField>
      <FormAlert message={formError} />
      <FormActions submitting={connect.isPending} submitLabel="Connect Dhan" onBack={onBack} />
    </form>
  );
}
