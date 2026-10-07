import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { NotificationsMenu, timeAgo } from "../components/notifications-menu";

const ITEM = {
  id: "n1",
  title: "Upstox session ended",
  body: "Log in again on Brokers to stream live prices.",
  severity: "warning",
  category: "broker",
  createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  readAt: null,
};

describe("NotificationsMenu", () => {
  it("shows the unread count, lists the notifications and marks them all read", async () => {
    const actor = userEvent.setup();
    const api = mockApi([
      { path: "/v1/notifications", respond: () => Response.json({ items: [ITEM], unread: 1 }) },
      { path: "/v1/notifications/read", method: "POST", respond: () => Response.json({ unread: 0 }) },
    ]);
    const { container } = renderWithProviders(<NotificationsMenu />);
    const trigger = await screen.findByRole("button", { name: "Notifications, 1 unread" });
    await actor.click(trigger);
    expect(await screen.findByText("Upstox session ended")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    await expectNoAxeViolations(container);
    await actor.click(screen.getByRole("button", { name: "Mark all read" }));
    await waitFor(() => {
      expect(api.filter((call) => call.path === "/v1/notifications/read" && call.method === "POST")).toHaveLength(1);
    });
  });

  it("says when there's nothing new", async () => {
    mockApi([{ path: "/v1/notifications", respond: () => Response.json({ items: [], unread: 0 }) }]);
    renderWithProviders(<NotificationsMenu />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("You're all caught up")).toBeInTheDocument();
  });

  it("formats times relative to now", () => {
    const now = Date.parse("2026-10-07T10:00:00.000Z");
    expect(timeAgo("2026-10-07T09:59:30.000Z", now)).toBe("just now");
    expect(timeAgo("2026-10-07T07:00:00.000Z", now)).toBe("3h ago");
    expect(timeAgo("2026-10-05T10:00:00.000Z", now)).toBe("2d ago");
  });
});
