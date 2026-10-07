/**
 * Undo/redo for drawings (pure): every committed change (draw, move, edit, delete, remove all) is one step.
 */
import type { Drawing } from "./types";

export const HISTORY_LIMIT = 100;

export interface DrawingHistory {
  past: readonly (readonly Drawing[])[];
  present: readonly Drawing[];
  future: readonly (readonly Drawing[])[];
}

export function initHistory(present: readonly Drawing[] = []): DrawingHistory {
  return { past: [], present, future: [] };
}

/** A new present; the redo stack is dropped and the oldest step falls off past {@link HISTORY_LIMIT}. */
export function commit(history: DrawingHistory, next: readonly Drawing[]): DrawingHistory {
  if (next === history.present) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: [] };
}

export function undo(history: DrawingHistory): DrawingHistory {
  const previous = history.past.at(-1);
  if (previous === undefined) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future] };
}

export function redo(history: DrawingHistory): DrawingHistory {
  const [next, ...rest] = history.future;
  if (next === undefined) return history;
  return { past: [...history.past, history.present].slice(-HISTORY_LIMIT), present: next, future: rest };
}

export function canUndo(history: DrawingHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: DrawingHistory): boolean {
  return history.future.length > 0;
}
