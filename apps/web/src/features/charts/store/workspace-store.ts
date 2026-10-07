"use client";

import { createContext, useContext } from "react";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { StoreApi } from "zustand/vanilla";

import { commit, initHistory, redo, undo } from "../lib/drawings/history";
import type { DrawingHistory } from "../lib/drawings/history";
import { MAX_NOTE_LENGTH } from "../lib/drawings/types";
import type { AnchorPoint, Drawing, DrawingPatch, DrawingTool } from "../lib/drawings/types";
import { MAX_INDICATORS, createInstance, newId, sanitizeInputs } from "../lib/indicators/registry";
import type { IndicatorInstance, IndicatorKind, InputValue, PlotStyleValue } from "../lib/indicators/registry";
import type { ChartLayout } from "../lib/storage";
import type { ChartInterval, ChartSettings, ChartType, ScaleMode } from "../schemas";

/** A text note waiting for its text: a new one at `point`, or an existing one. */
export type TextRequest = { point: AnchorPoint } | { id: string };

export type WorkspaceDialog = "symbol" | "indicators" | "settings" | "drawing" | null;

export interface WorkspaceState extends ChartLayout {
  tool: DrawingTool;
  magnet: boolean;
  locked: boolean;
  drawingsHidden: boolean;
  history: DrawingHistory;
  selectedId: string | null;
  textRequest: TextRequest | null;
  dialog: WorkspaceDialog;
  /** The first character typed on the chart, which opened the symbol search. */
  symbolQuery: string;
  /** The indicator whose settings dialog is open. */
  editingIndicator: string | null;

  setInterval: (interval: ChartInterval) => void;
  setChartType: (chartType: ChartType) => void;
  setScale: (patch: { scaleMode?: ScaleMode; autoScale?: boolean }) => void;
  setSettings: (settings: ChartSettings) => void;
  togglePanel: () => void;
  openDialog: (dialog: WorkspaceDialog, symbolQuery?: string) => void;

  addIndicator: (kind: IndicatorKind) => IndicatorInstance | undefined;
  updateIndicator: (
    id: string,
    patch: { inputs?: Record<string, InputValue>; styles?: Record<string, PlotStyleValue> },
  ) => void;
  toggleIndicator: (id: string) => void;
  removeIndicator: (id: string) => void;
  editIndicator: (id: string | null) => void;

  setTool: (tool: DrawingTool) => void;
  toggleMagnet: () => void;
  toggleLocked: () => void;
  toggleDrawingsHidden: () => void;
  commitDrawings: (drawings: readonly Drawing[], selectedId?: string | null) => void;
  selectDrawing: (id: string | null) => void;
  deleteSelected: () => boolean;
  removeAllDrawings: () => void;
  /** Restyles or moves one drawing (one undo step). */
  updateDrawing: (id: string, patch: DrawingPatch) => void;
  /** A copy of the drawing, nudged right, selected. */
  cloneDrawing: (id: string) => void;
  /** Removes every indicator (the toolbar's remove menu). */
  removeAllIndicators: () => void;
  /** The tool each toolbar group shows (its last pick). */
  groupTools: Readonly<Record<string, DrawingTool>>;
  setGroupTool: (group: string, tool: DrawingTool) => void;
  undo: () => void;
  redo: () => void;
  requestText: (request: TextRequest | null) => void;
  saveText: (text: string) => void;
}

export function createWorkspaceStore(layout: ChartLayout, drawings: readonly Drawing[]): StoreApi<WorkspaceState> {
  return createStore<WorkspaceState>()((set, get) => ({
    ...layout,
    tool: "crosshair",
    magnet: false,
    locked: false,
    drawingsHidden: false,
    history: initHistory(drawings),
    selectedId: null,
    textRequest: null,
    dialog: null,
    symbolQuery: "",
    editingIndicator: null,
    groupTools: {},

    setInterval: (interval) => {
      set({ interval });
    },
    setChartType: (chartType) => {
      set({ chartType });
    },
    setScale: (patch) => {
      const { scaleMode, autoScale } = get();
      set({ scaleMode: patch.scaleMode ?? scaleMode, autoScale: patch.autoScale ?? autoScale });
    },
    setSettings: (settings) => {
      set({ settings });
    },
    togglePanel: () => {
      set({ panelOpen: !get().panelOpen });
    },
    openDialog: (dialog, symbolQuery = "") => {
      set({ dialog, symbolQuery });
    },

    addIndicator: (kind) => {
      const { indicators } = get();
      if (indicators.length >= MAX_INDICATORS) return undefined;
      // One volume histogram is enough: adding it again shows the hidden one.
      const existing = kind === "volume" ? indicators.find((item) => item.kind === "volume") : undefined;
      if (existing !== undefined) {
        set({ indicators: indicators.map((item) => (item === existing ? { ...item, hidden: false } : item)) });
        return existing;
      }
      const instance = createInstance(kind);
      set({ indicators: [...indicators, instance] });
      return instance;
    },
    updateIndicator: (id, patch) => {
      set({
        indicators: get().indicators.map((item) =>
          item.id === id
            ? {
                ...item,
                inputs: patch.inputs === undefined ? item.inputs : sanitizeInputs(item.kind, patch.inputs),
                styles: patch.styles ?? item.styles,
              }
            : item,
        ),
      });
    },
    toggleIndicator: (id) => {
      set({ indicators: get().indicators.map((item) => (item.id === id ? { ...item, hidden: !item.hidden } : item)) });
    },
    removeIndicator: (id) => {
      const { editingIndicator, indicators } = get();
      set({
        indicators: indicators.filter((item) => item.id !== id),
        editingIndicator: editingIndicator === id ? null : editingIndicator,
      });
    },
    editIndicator: (id) => {
      set({ editingIndicator: id });
    },

    setTool: (tool) => {
      set({ tool, selectedId: tool === "cursor" || tool === "crosshair" ? get().selectedId : null });
    },
    toggleMagnet: () => {
      set({ magnet: !get().magnet });
    },
    toggleLocked: () => {
      set({ locked: !get().locked });
    },
    toggleDrawingsHidden: () => {
      set({ drawingsHidden: !get().drawingsHidden, selectedId: null });
    },
    commitDrawings: (drawings, selectedId) => {
      const { history, selectedId: current } = get();
      set({ history: commit(history, drawings), selectedId: selectedId === undefined ? current : selectedId });
    },
    selectDrawing: (id) => {
      set({ selectedId: id });
    },
    deleteSelected: () => {
      const { history, selectedId } = get();
      if (selectedId === null || !history.present.some((drawing) => drawing.id === selectedId)) return false;
      set({
        history: commit(
          history,
          history.present.filter((drawing) => drawing.id !== selectedId),
        ),
        selectedId: null,
      });
      return true;
    },
    removeAllDrawings: () => {
      const { history } = get();
      if (history.present.length === 0) return;
      set({ history: commit(history, []), selectedId: null });
    },
    updateDrawing: (id, patch) => {
      const { history } = get();
      if (!history.present.some((drawing) => drawing.id === id)) return;
      set({
        history: commit(
          history,
          history.present.map((drawing) => (drawing.id === id ? { ...drawing, ...patch } : drawing)),
        ),
      });
    },
    cloneDrawing: (id) => {
      const { history } = get();
      const original = history.present.find((drawing) => drawing.id === id);
      if (original === undefined) return;
      const span =
        original.points.length > 1 ? Math.abs((original.points[1]?.time ?? 0) - (original.points[0]?.time ?? 0)) : 0;
      const shift = Math.max(60, Math.round(span * 0.15));
      const copy: Drawing = {
        ...original,
        id: newId("drawing"),
        locked: false,
        points: original.points.map((point) => ({ ...point, time: point.time + shift })),
      };
      set({ history: commit(history, [...history.present, copy]), selectedId: copy.id });
    },
    removeAllIndicators: () => {
      set({ indicators: [], editingIndicator: null });
    },
    setGroupTool: (group, tool) => {
      set({ groupTools: { ...get().groupTools, [group]: tool } });
    },
    undo: () => {
      set({ history: undo(get().history), selectedId: null });
    },
    redo: () => {
      set({ history: redo(get().history), selectedId: null });
    },
    requestText: (request) => {
      set({ textRequest: request });
    },
    saveText: (text) => {
      const { textRequest, history } = get();
      const value = text.trim().slice(0, MAX_NOTE_LENGTH);
      if (textRequest === null) return;
      if ("id" in textRequest) {
        const target = history.present.find((drawing) => drawing.id === textRequest.id);
        const next =
          value === "" && target?.kind !== "pricelabel"
            ? history.present.filter((drawing) => drawing.id !== textRequest.id)
            : history.present.map((drawing) => (drawing.id === textRequest.id ? { ...drawing, text: value } : drawing));
        set({ history: commit(history, next), textRequest: null });
        return;
      }
      if (value === "") {
        set({ textRequest: null });
        return;
      }
      const drawing: Drawing = {
        id: newId("drawing"),
        kind: "text",
        color: "fg",
        points: [textRequest.point],
        text: value,
      };
      set({ history: commit(history, [...history.present, drawing]), textRequest: null, selectedId: drawing.id });
    },
  }));
}

export const WorkspaceStoreContext = createContext<StoreApi<WorkspaceState> | null>(null);

export function useWorkspaceStore(): StoreApi<WorkspaceState> {
  const store = useContext(WorkspaceStoreContext);
  if (store === null) throw new Error("useWorkspace() needs a <WorkspaceStoreContext> provider");
  return store;
}

/** One value from the workspace store; the component re-renders only when it changes. */
export function useWorkspace<T>(selector: (state: WorkspaceState) => T): T {
  return useStore(useWorkspaceStore(), selector);
}

/** The layout fields, as persisted. */
export function layoutOf(state: WorkspaceState): ChartLayout {
  const { interval, chartType, indicators, scaleMode, autoScale, settings, panelOpen } = state;
  return { interval, chartType, indicators, scaleMode, autoScale, settings, panelOpen };
}
