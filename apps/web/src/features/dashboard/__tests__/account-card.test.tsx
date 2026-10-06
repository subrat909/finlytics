import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";
import { renderWithProviders } from "@/test/render";

import { AccountCard } from "../components/account-card";

const ME = {
  id: "u1",
  email: "asha@example.com",
  name: "Asha",
  image: null,
  timezone: "Asia/Kolkata",
  createdAt: "2026-10-06T10:00:00.000Z",
};

function problem(status: number, code: string) {
  return new Response(JSON.stringify({ type: "about:blank", title: code, status, code, requestId: "req-42" }), {
    status,
    headers: { "content-type": "application/problem+json" },
  });
}

describe("AccountCard", () => {
  it("shows a shaped skeleton, then the user from /v1/me", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(ME)));
    const { container } = renderWithProviders(<AccountCard />);

    expect(screen.getByRole("status", { name: "Loading your account" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Welcome, Asha" })).toBeInTheDocument();
    expect(screen.getByText("asha@example.com")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith("/v1/me", expect.objectContaining({ credentials: "same-origin" }));
    await expectNoAxeViolations(container);
  });

  it("shows a retryable error with the request id, and recovers", async () => {
    const actor = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValueOnce(problem(503, "SERVICE_UNAVAILABLE"));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderWithProviders(<AccountCard />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Your account didn't load");
    expect(screen.getByText("req-42")).toBeInTheDocument();
    await expectNoAxeViolations(container);

    fetchMock.mockResolvedValueOnce(Response.json({ ...ME, name: null }));
    await actor.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Welcome" })).toBeInTheDocument();
    });
  });
});
