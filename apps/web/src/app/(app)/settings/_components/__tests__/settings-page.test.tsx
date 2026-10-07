import { DEFAULT_USER_SETTINGS } from "@finlytics/shared";
import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import SettingsPage from "../../page";

function renderPage() {
  mockApi([{ path: "/v1/me/settings", respond: () => Response.json(DEFAULT_USER_SETTINGS) }]);
  return renderWithProviders(<SettingsPage />);
}

describe("SettingsPage", () => {
  it("lists its sections beside them, the ones still to come marked", async () => {
    renderPage();

    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["#appearance", "#profile", "#security", "#trading", "#notifications"]);
    expect(within(nav).getByRole("link", { name: "Appearance" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Trading, coming soon" })).toBeInTheDocument();
    expect(await screen.findByRole("radiogroup", { name: "Theme" })).toBeInTheDocument();
  });

  it("describes each section still to come under its anchor, and links to Brokers", () => {
    renderPage();

    for (const [id, name] of [
      ["profile", "Profile"],
      ["security", "Security"],
      ["trading", "Trading"],
      ["notifications", "Notifications"],
    ] as const) {
      const section = screen.getByRole("heading", { level: 2, name }).closest("section");
      expect(section).toHaveAttribute("id", id);
      expect(within(section as HTMLElement).getByText("Soon")).toBeInTheDocument();
    }
    expect(screen.getByText(/You're paper trading/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Manage brokers" })).toHaveAttribute("href", "/brokers");
  });

  it("has no axe violations once loaded", async () => {
    const { container } = renderPage();
    await screen.findByRole("radiogroup", { name: "Density" });

    await expectNoAxeViolations(container);
  });
});
