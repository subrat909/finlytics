import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import DashboardError from "../error";
import DashboardLoading from "../loading";
import DashboardPage from "../page";

vi.mock("next/navigation", () => nextNavigationMock);

describe("/dashboard route", () => {
  it("renders the page in the standard container", async () => {
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([]) }]);
    renderWithProviders(<DashboardPage />);
    expect(document.querySelector('[data-slot="page"]')).toContainElement(
      screen.getByRole("heading", { level: 1, name: "Dashboard" }),
    );
    expect(await screen.findByRole("region", { name: "Get started" })).toBeInTheDocument();
  });

  it("has a shaped loading skeleton", async () => {
    const { container } = renderWithProviders(<DashboardLoading />);
    expect(screen.getByRole("status", { name: "Loading dashboard" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="dashboard-skeleton"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it("offers a retry when the page fails, without the error's message", async () => {
    const actor = userEvent.setup();
    const retry = vi.fn();
    renderWithProviders(<DashboardError error={Object.assign(new Error("secret"), { digest: "d1" })} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The dashboard didn't load");
    expect(screen.queryByText("secret")).toBeNull();
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});
