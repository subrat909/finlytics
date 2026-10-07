import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { mockApi } from "@/test/api-mock";
import { expectNoAxeViolations } from "@/test/axe";
import { nextNavigationMock } from "@/test/next-mocks";
import { renderWithProviders } from "@/test/render";

import BrokersError from "../error";
import BrokersLoading from "../loading";
import BrokersPage from "../page";

vi.mock("next/navigation", () => nextNavigationMock);

describe("/brokers route", () => {
  it("passes the callback's parameters to the view, ignoring arrays and oversized values", async () => {
    mockApi([{ path: "/v1/brokers", respond: () => Response.json([]) }]);
    const page = await BrokersPage({
      searchParams: Promise.resolve({ error: "state_invalid", connected: ["a", "b"] }),
    });
    renderWithProviders(page);
    expect(document.querySelector('[data-slot="page"]')).toContainElement(
      screen.getByRole("heading", { level: 1, name: "Brokers" }),
    );
    expect(await screen.findByText("The broker login didn't finish")).toBeInTheDocument();
  });

  it("has a shaped loading skeleton", async () => {
    const { container } = renderWithProviders(<BrokersLoading />);
    expect(screen.getByRole("status", { name: "Loading brokers" })).toBeInTheDocument();
    expect(container.querySelector('[data-slot="broker-accounts-skeleton"]')).not.toBeNull();
    await expectNoAxeViolations(container);
  });

  it("offers a retry when the page fails", async () => {
    const actor = userEvent.setup();
    const retry = vi.fn();
    renderWithProviders(<BrokersError error={new Error("secret")} retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Brokers didn't load");
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalled();
  });
});
