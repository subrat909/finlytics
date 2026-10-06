/**
 * The shell's polite announcements (docs/05 Accessibility, plan W12): route loading, saved settings. One persistent
 * live region (`<ShellAnnouncer>`) reads `message`; anything can `announce()` into it.
 */
import { create } from "zustand";

export interface AnnouncerState {
  message: string;
  announce: (message: string) => void;
}

export const useAnnouncer = create<AnnouncerState>()((set) => ({
  message: "",
  announce: (message) => {
    set({ message });
  },
}));

/** For non-React callers (mutation callbacks). */
export function announce(message: string): void {
  useAnnouncer.getState().announce(message);
}
