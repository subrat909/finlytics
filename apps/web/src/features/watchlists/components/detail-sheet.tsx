"use client";

import type { Instrument } from "@finlytics/shared";
import { Dialog } from "radix-ui";

import { displaySymbol } from "@/features/instruments/lib/describe";

import { InstrumentDetail } from "./instrument-detail";

export interface DetailSheetProps {
  instrument: Instrument | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove?: (() => void) | undefined;
  removeLabel?: string | undefined;
}

/**
 * The selected instrument's details below 1024 px (frontend.md: sheets on small screens): a bottom sheet on phones, a
 * side sheet on tablets. A Radix Dialog (focus moves in and is trapped, Escape closes, focus returns to the row);
 * its content mounts only while open, so depth and the chart stream only then.
 */
export function DetailSheet({ instrument, open, onOpenChange, onRemove, removeLabel }: DetailSheetProps) {
  return (
    <Dialog.Root open={open && instrument !== undefined} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-bg/80 backdrop-blur-sm motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0" />
        <Dialog.Content
          data-slot="instrument-sheet"
          className="fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-t-md border-t border-border bg-surface-1 text-fg motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:slide-in-from-bottom sm:inset-y-0 sm:right-0 sm:left-auto sm:max-h-none sm:w-[28rem] sm:rounded-none sm:border-t-0 sm:border-l motion-safe:sm:data-[state=open]:slide-in-from-right"
        >
          {instrument === undefined ? null : (
            <>
              <Dialog.Description className="sr-only">
                {`The live quote, market depth and intraday chart of ${displaySymbol(instrument)}.`}
              </Dialog.Description>
              <InstrumentDetail
                instrument={instrument}
                onClose={() => {
                  onOpenChange(false);
                }}
                onRemove={onRemove}
                removeLabel={removeLabel}
                renderTitle={(heading) => <Dialog.Title asChild>{heading}</Dialog.Title>}
              />
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
