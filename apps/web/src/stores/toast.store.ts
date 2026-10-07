/**
 * Toasts for mutations (frontend.md "Error": toast for mutations). A small queue anything can push to; `<Toaster>`
 * renders it with Radix Toast (a polite live region, F8 to reach it, swipe or Escape to dismiss). App-local until a
 * Toast primitive lands in packages/ui (docs/05 lists Toast).
 */
import { create } from "zustand";

export type ToastTone = "success" | "error" | "info";

export interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string | undefined;
}

interface ToastState {
  toasts: readonly ToastItem[];
}

/** At most this many on screen; the oldest goes first. */
const MAX_TOASTS = 3;
let nextId = 1;

export const useToastStore = create<ToastState>()(() => ({ toasts: [] }));

function push(tone: ToastTone, title: string, description?: string): number {
  const id = nextId++;
  useToastStore.setState((state) => ({
    toasts: [...state.toasts, { id, tone, title, description }].slice(-MAX_TOASTS),
  }));
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push("success", title, description),
  error: (title: string, description?: string) => push("error", title, description),
  info: (title: string, description?: string) => push("info", title, description),
  dismiss: (id: number) => {
    useToastStore.setState((state) => ({ toasts: state.toasts.filter((item) => item.id !== id) }));
  },
  clear: () => {
    useToastStore.setState({ toasts: [] });
  },
};
