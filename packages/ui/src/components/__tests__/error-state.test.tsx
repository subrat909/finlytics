import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Component } from "react";
import type * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { ErrorState } from "../error-state";

/** The route's error boundary (error.tsx in the app): what the page would fall back to if a retry's error escaped. */
class RouteErrorBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): React.ReactNode {
    return this.state.failed ? <p>Route error boundary</p> : this.props.children;
  }
}

describe("ErrorState", () => {
  it("calls onRetry when Try again is pressed", async () => {
    const onRetry = vi.fn();
    render(<ErrorState onRetry={onRetry} />);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows a pending button until an async onRetry settles", async () => {
    let settle: () => void = () => undefined;
    const onRetry = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          settle = resolve;
        }),
    );
    render(<ErrorState onRetry={onRetry} retryLabel="Reload positions" />);
    const button = screen.getByRole("button", { name: "Reload positions" });

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);

    act(() => {
      settle();
    });

    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
  });

  it("stays on the error state, ready to retry again, when an async onRetry rejects", async () => {
    const onRetry = vi.fn(() => Promise.reject(new Error("positions still unavailable")));
    render(
      <RouteErrorBoundary>
        <ErrorState onRetry={onRetry} />
      </RouteErrorBoundary>,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    await userEvent.click(button);

    await waitFor(() => {
      expect(button).not.toHaveAttribute("aria-busy");
    });
    expect(screen.queryByText("Route error boundary")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByRole("alert")).not.toHaveTextContent("positions still unavailable");

    await userEvent.click(button);

    await waitFor(() => {
      expect(onRetry).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("Route error boundary")).toBeNull();
  });

  it("stays on the error state when onRetry throws synchronously", async () => {
    const onRetry = vi.fn((): void => {
      throw new Error("no broker session");
    });
    render(
      <RouteErrorBoundary>
        <ErrorState onRetry={onRetry} />
      </RouteErrorBoundary>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Try again" })).not.toHaveAttribute("aria-busy");
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Route error boundary")).toBeNull();
  });

  it("shows the reference id when given", () => {
    render(<ErrorState reference="7f3c9a2e-5b1d-4c8e-9f0a-2d6b8e4c1a73" />);

    expect(screen.getByText(/^Reference:/)).toHaveTextContent("Reference: 7f3c9a2e-5b1d-4c8e-9f0a-2d6b8e4c1a73");
  });

  it("renders no retry button without onRetry", () => {
    render(<ErrorState title="Needs a broker" />);

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("announces itself with role=alert", () => {
    render(<ErrorState />);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(alert).toHaveTextContent("This didn't load. Try again in a moment.");
  });

  it("uses the requested heading level", () => {
    render(<ErrorState title="Chain unavailable" headingLevel={3} size="inline" />);

    expect(screen.getByRole("heading", { name: "Chain unavailable", level: 3 })).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(<ErrorState reference="req-42" onRetry={vi.fn()} />);

    await expectNoAxeViolations(container);
  });
});
