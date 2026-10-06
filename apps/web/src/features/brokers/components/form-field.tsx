"use client";

import { useId } from "react";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

export interface FormFieldProps {
  label: string;
  /** Validation message; sets `aria-invalid` and is announced with the field (`aria-describedby`). */
  error?: string | undefined;
  hint?: React.ReactNode | undefined;
  className?: string | undefined;
  /** Renders the control with the ids it needs. */
  children: (control: { id: string; "aria-describedby": string | undefined; invalid: boolean }) => React.ReactNode;
}

/** A labelled control with its hint and error, wired for screen readers. */
export function FormField({ label, error, hint, className, children }: FormFieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : undefined, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div data-slot="form-field" className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-sm font-medium text-fg">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: error !== undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-fg-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-loss" data-slot="form-field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
