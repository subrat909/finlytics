import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { DrawingSettingsDialog } from "../components/drawing-settings-dialog";
import { DrawingStyleBar } from "../components/drawing-style-bar";
import { ChartSettingsDialog } from "../components/settings-dialogs";
import type { Drawing } from "../lib/drawings/types";
import { defaultLayout } from "../lib/storage";
import { WorkspaceStoreContext, createWorkspaceStore } from "../store/workspace-store";

const RECT: Drawing = {
  id: "r1",
  kind: "rect",
  color: "primary",
  points: [
    { time: 1_700_000_000, price: 100 },
    { time: 1_700_003_600, price: 110 },
  ],
};
const TREND: Drawing = { ...RECT, id: "t1", kind: "trend" };
const LABEL: Drawing = { id: "p1", kind: "pricelabel", color: "info", points: [{ time: 1_700_000_000, price: 105 }] };

function renderWith(drawings: Drawing[], selectedId: string | null) {
  const store = createWorkspaceStore(defaultLayout(), drawings);
  store.getState().selectDrawing(selectedId);
  const view = renderWithProviders(
    <WorkspaceStoreContext value={store}>
      <DrawingStyleBar />
      <DrawingSettingsDialog />
      <ChartSettingsDialog />
    </WorkspaceStoreContext>,
  );
  return { store, ...view };
}

describe("DrawingStyleBar", () => {
  it("restyles the selected shape: colour, width, style, fill, lock, clone and remove", async () => {
    const actor = userEvent.setup();
    const { store, container } = renderWith([RECT], "r1");
    const bar = screen.getByRole("toolbar", { name: "Rectangle style" });
    await expectNoAxeViolations(container);

    await actor.click(within(bar).getByRole("button", { name: /^Colour/ }));
    await actor.click(await screen.findByRole("radio", { name: "Rose" }));
    expect(store.getState().history.present[0]?.color).toBe("loss");

    await actor.click(within(bar).getByRole("button", { name: /^Line width/ }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /3px/ }));
    expect(store.getState().history.present[0]?.width).toBe(3);

    await actor.click(within(bar).getByRole("button", { name: /^Line style/ }));
    await actor.click(await screen.findByRole("menuitemradio", { name: /Dotted/ }));
    expect(store.getState().history.present[0]?.dash).toBe("dotted");

    await actor.click(within(bar).getByRole("button", { name: "Hide background" }));
    expect(store.getState().history.present[0]?.fill).toBe(false);
    await actor.click(within(bar).getByRole("button", { name: "Lock" }));
    expect(store.getState().history.present[0]?.locked).toBe(true);
    await actor.click(within(bar).getByRole("button", { name: "Clone" }));
    expect(store.getState().history.present).toHaveLength(2);
    await actor.click(screen.getByRole("button", { name: "Remove" }));
    expect(store.getState().history.present).toHaveLength(1);
  });

  it("extends lines, hides labels and edits text where the kind has them", async () => {
    const actor = userEvent.setup();
    const { store } = renderWith([TREND, LABEL], "t1");
    await actor.click(screen.getByRole("button", { name: "Extend the line" }));
    await actor.click(await screen.findByRole("menuitemcheckbox", { name: /Extend right/ }));
    expect(store.getState().history.present[0]?.extendRight).toBe(true);

    store.getState().selectDrawing("p1");
    await actor.click(await screen.findByRole("button", { name: "Hide labels" }));
    expect(store.getState().history.present[1]?.labels).toBe(false);
    await actor.click(screen.getByRole("button", { name: /^Font size/ }));
    await actor.click(await screen.findByRole("menuitemradio", { name: "16" }));
    expect(store.getState().history.present[1]?.fontSize).toBe(16);
    await actor.click(screen.getByRole("button", { name: "Edit text" }));
    expect(store.getState().textRequest).toEqual({ id: "p1" });
  });

  it("shows nothing without a selection", () => {
    renderWith([RECT], null);
    expect(screen.queryByRole("toolbar")).toBeNull();
  });
});

describe("DrawingSettingsDialog", () => {
  it("edits style, text and coordinates, applied once on Ok; Cancel changes nothing", async () => {
    const actor = userEvent.setup();
    const { store } = renderWith([RECT, LABEL], "r1");
    await actor.click(screen.getByRole("button", { name: "Settings" }));
    const dialog = await screen.findByRole("dialog", { name: "Rectangle" });
    await actor.click(within(dialog).getByRole("radio", { name: "Violet" }));
    await actor.click(within(dialog).getByRole("radio", { name: "4 px" }));
    await actor.click(within(dialog).getByRole("switch", { name: "Lock (can't be moved)" }));
    await actor.click(within(dialog).getByRole("tab", { name: "Coordinates" }));
    const price = within(dialog).getByRole("textbox", { name: "Price of point 1" });
    await actor.clear(price);
    await actor.type(price, "101.5");
    await actor.click(within(dialog).getByRole("button", { name: "Ok" }));
    const saved = store.getState().history.present[0];
    expect(saved).toMatchObject({ color: "violet", locked: true, width: 4 });
    expect(saved?.points[0]?.price).toBe(101.5);

    store.getState().selectDrawing("p1");
    store.getState().openDialog("drawing");
    const labelDialog = await screen.findByRole("dialog", { name: "Price label" });
    await actor.click(within(labelDialog).getByRole("tab", { name: "Text" }));
    await actor.type(within(labelDialog).getByRole("textbox"), "Target");
    await actor.click(within(labelDialog).getByRole("button", { name: "Cancel" }));
    expect(store.getState().history.present[1]?.text).toBeUndefined();
  });
});

describe("ChartSettingsDialog", () => {
  it("changes symbol colours, the status line, the scale side and the canvas, and resets", async () => {
    const actor = userEvent.setup();
    const { store, container } = renderWith([], null);
    store.getState().openDialog("settings");
    const dialog = await screen.findByRole("dialog", { name: "Chart settings" });
    await expectNoAxeViolations(container);
    const upColours = within(dialog).getByRole("radiogroup", { name: "Up colour" });
    await actor.click(within(upColours).getByRole("radio", { name: "Cyan" }));
    await actor.click(within(dialog).getByRole("switch", { name: "Borders" }));
    await actor.click(within(dialog).getByRole("tab", { name: "Status line" }));
    await actor.click(within(dialog).getByRole("switch", { name: "Volume" }));
    await actor.click(within(dialog).getByRole("tab", { name: "Scales" }));
    await actor.click(within(dialog).getByRole("radio", { name: "Left" }));
    await actor.click(within(dialog).getByRole("tab", { name: "Canvas" }));
    await actor.click(within(dialog).getByRole("switch", { name: "Symbol watermark" }));
    await actor.click(within(dialog).getByRole("radio", { name: "Snap to OHLC" }));
    expect(store.getState().settings).toMatchObject({
      upColor: "highlight",
      candleBorders: true,
      legendVolume: false,
      priceScale: "left",
      watermark: true,
      crosshair: "magnet",
    });
    await actor.click(within(dialog).getByRole("button", { name: "Reset to defaults" }));
    expect(store.getState().settings.priceScale).toBe("right");
  });
});
