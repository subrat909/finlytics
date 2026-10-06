"use client";

import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
import { Toast } from "radix-ui";
import type * as React from "react";

import { cn } from "@finlytics/ui/lib/utils";

import { toast, useToastStore } from "@/stores/toast.store";
import type { ToastTone } from "@/stores/toast.store";

const ICONS: Readonly<Record<ToastTone, React.ReactNode>> = {
  success: <CircleCheck aria-hidden="true" className="size-5 shrink-0 text-profit" />,
  error: <CircleAlert aria-hidden="true" className="size-5 shrink-0 text-loss" />,
  info: <Info aria-hidden="true" className="size-5 shrink-0 text-info" />,
};

/**
 * Renders the toast queue: bottom-right (bottom, full width, on phones), surface-1 with a ring, no shadow. Errors stay
 * until dismissed and are announced assertively; the rest close after five seconds.
 */
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  return (
    <Toast.Provider swipeDirection="right" duration={5_000}>
      {toasts.map((item) => (
        <Toast.Root
          key={item.id}
          data-slot="toast"
          data-tone={item.tone}
          type={item.tone === "error" ? "foreground" : "background"}
          duration={item.tone === "error" ? Number.POSITIVE_INFINITY : 5_000}
          onOpenChange={(open) => {
            if (!open) toast.dismiss(item.id);
          }}
          className={cn(
            "flex items-start gap-3 rounded-md bg-surface-1 p-4 text-fg ring-1 ring-surface-3",
            "motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=open]:slide-in-from-bottom-2",
            "data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x)",
          )}
        >
          {ICONS[item.tone]}
          <div className="min-w-0 flex-1 space-y-1">
            <Toast.Title className="text-sm font-semibold">{item.title}</Toast.Title>
            {item.description ? (
              <Toast.Description className="text-sm text-fg-muted">{item.description}</Toast.Description>
            ) : null}
          </div>
          <Toast.Close
            aria-label="Dismiss"
            className="-m-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-fg-muted transition-[color,background-color] hover:bg-surface-2 hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid"
          >
            <X aria-hidden="true" className="size-4" />
          </Toast.Close>
        </Toast.Root>
      ))}
      <Toast.Viewport className="fixed right-0 bottom-0 z-50 flex w-full flex-col gap-2 p-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-solid sm:max-w-sm" />
    </Toast.Provider>
  );
}
