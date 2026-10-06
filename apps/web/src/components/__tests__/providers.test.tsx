import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnnounceLoading, ShellAnnouncer } from "@/components/shell/shell-announcer";
import { ApiError } from "@/lib/api/client";
import { announce } from "@/stores/announcer.store";
import { nextNavigationMock, router } from "@/test/next-mocks";

import { Providers, loginPathFor, makeQueryClient } from "../providers";
import { StyleNonce } from "../style-nonce";

vi.mock("next/navigation", () => nextNavigationMock);

describe("makeQueryClient", () => {
  it("sends the user to /login on a 401 and stays put on a 503", async () => {
    const navigate = vi.fn();
    const client = makeQueryClient(navigate);
    window.history.replaceState(null, "", "/charts?tf=5m");

    const fail = (key: string, error: ApiError) =>
      client.query({ queryKey: [key], queryFn: () => Promise.reject(error), retry: false }).catch(() => undefined);

    await fail("a", new ApiError(503, "SERVICE_UNAVAILABLE"));
    expect(navigate).not.toHaveBeenCalled();

    await fail("b", new ApiError(401, "UNAUTHENTICATED"));
    expect(navigate).toHaveBeenCalledWith("/login?callbackUrl=%2Fcharts%3Ftf%3D5m");
  });

  it("builds the login path from a location", () => {
    expect(loginPathFor({ pathname: "/dashboard", search: "" })).toBe("/login?callbackUrl=%2Fdashboard");
  });
});

describe("Providers", () => {
  it("renders its children without navigating", () => {
    render(
      <Providers>
        <p>child</p>
      </Providers>,
    );
    expect(screen.getByText("child")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe("ShellAnnouncer", () => {
  it("is a persistent polite region that AnnounceLoading fills and clears", () => {
    render(<ShellAnnouncer />);
    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");

    const { unmount } = render(<AnnounceLoading label="Loading dashboard" />);
    expect(region).toHaveTextContent("Loading dashboard");
    unmount();
    expect(region).toHaveTextContent("");

    act(() => {
      announce("Saved");
    });
    expect(region).toHaveTextContent("Saved");
  });
});

describe("StyleNonce", () => {
  it("exposes the nonce to runtime style insertion", () => {
    render(<StyleNonce nonce="abc123" />);
    expect((globalThis as { __webpack_nonce__?: string }).__webpack_nonce__).toBe("abc123");
  });
});
