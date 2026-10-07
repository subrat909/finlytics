import { DEFAULT_USER_SETTINGS } from "@finlytics/shared";
import type { UserSettings } from "@finlytics/shared";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { AppearanceSettings } from "../appearance-settings";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The JSON body apiRequest sent (always a string). */
function jsonBody(init: RequestInit | undefined): unknown {
  return typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
}

function settingsWith(appearance: Partial<UserSettings["appearance"]> = {}): UserSettings {
  const settings = structuredClone(DEFAULT_USER_SETTINGS) as UserSettings;
  return { ...settings, appearance: { ...settings.appearance, ...appearance } };
}

/** A fake api: GET answers `settings`, PATCH merges the body's appearance (or answers `patchStatus`). */
function mockApi(options: { settings?: UserSettings; getStatus?: number; patchStatus?: number } = {}) {
  let settings = options.settings ?? settingsWith();
  const fetchMock = vi.fn<Fetch>((_input, init) => {
    if (init?.method === "PATCH") {
      if (options.patchStatus) return Promise.resolve(new Response("{}", { status: options.patchStatus }));
      const body = jsonBody(init) as { appearance: Partial<UserSettings["appearance"]> };
      settings = { ...settings, appearance: { ...settings.appearance, ...body.appearance } };
      return Promise.resolve(Response.json(settings));
    }
    if (options.getStatus) return Promise.resolve(new Response("{}", { status: options.getStatus }));
    return Promise.resolve(Response.json(settings));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function patches(fetchMock: ReturnType<typeof mockApi>): unknown[] {
  return fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => jsonBody(init));
}

beforeEach(() => {
  document.documentElement.removeAttribute("data-density");
});

describe("AppearanceSettings", () => {
  it("shows a skeleton shaped like the card while the settings load", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<Fetch>(() => new Promise<Response>(() => undefined)),
    );
    renderWithProviders(<AppearanceSettings />);

    const loading = screen.getByRole("status", { name: "Loading your appearance settings" });
    expect(loading.querySelector('[data-slot="appearance-skeleton"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("offers a retry when the settings don't load, and shows them once they do", async () => {
    const actor = userEvent.setup();
    const fetchMock = mockApi({ getStatus: 500 });
    renderWithProviders(<AppearanceSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your settings didn't load");
    mockApi();
    await actor.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/v1/me/settings", expect.objectContaining({ method: "GET" }));
  });

  it("applies the theme at once and saves it to the account", async () => {
    const actor = userEvent.setup();
    const fetchMock = mockApi();
    renderWithProviders(<AppearanceSettings />);

    const theme = await screen.findByRole("radiogroup", { name: "Theme" });
    expect(theme).toHaveAccessibleDescription(/System follows your device/);
    await actor.click(within(theme).getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute("data-theme", "dark");
    });
    expect(await screen.findByText("Saved to your account.")).toBeInTheDocument();
    expect(patches(fetchMock)).toEqual([{ appearance: { theme: "dark" } }]);
  });

  it("applies the density at once, keeps the hint cookie in step and saves it", async () => {
    const actor = userEvent.setup();
    const fetchMock = mockApi();
    renderWithProviders(<AppearanceSettings />);

    const density = await screen.findByRole("radiogroup", { name: "Density" });
    expect(within(density).getByRole("radio", { name: "Comfortable" })).toBeChecked();
    await actor.click(within(density).getByRole("radio", { name: "Compact" }));

    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(document.cookie).toContain("finlytics-density=compact");
    await waitFor(() => {
      expect(patches(fetchMock)).toEqual([{ appearance: { density: "compact" } }]);
    });
  });

  it("takes the account's density when the settings arrive", async () => {
    mockApi({ settings: settingsWith({ density: "compact" }) });
    renderWithProviders(<AppearanceSettings />);

    const density = await screen.findByRole("radiogroup", { name: "Density" });

    await waitFor(() => {
      expect(within(density).getByRole("radio", { name: "Compact" })).toBeChecked();
    });
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(document.cookie).toContain("finlytics-density=compact");
  });

  it("says when a save fails, keeps the choice on this device, and saves it on retry", async () => {
    const actor = userEvent.setup();
    mockApi({ patchStatus: 500 });
    renderWithProviders(<AppearanceSettings />);

    const density = await screen.findByRole("radiogroup", { name: "Density" });
    await actor.click(within(density).getByRole("radio", { name: "Compact" }));

    const status = await screen.findByText("Applied on this device, but not saved to your account.");
    expect(document.documentElement).toHaveAttribute("data-density", "compact");
    expect(within(density).getByRole("radio", { name: "Compact" })).toBeChecked();

    const fetchMock = mockApi();
    await actor.click(within(status.parentElement as HTMLElement).getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Saved to your account.")).toBeInTheDocument();
    expect(patches(fetchMock)).toEqual([{ appearance: { density: "compact" } }]);
  });

  it("has no axe violations once loaded", async () => {
    mockApi();
    const { container } = renderWithProviders(<AppearanceSettings />);
    expect(await screen.findByRole("heading", { level: 2, name: "Appearance" })).toBeInTheDocument();

    await expectNoAxeViolations(container);
  });
});
