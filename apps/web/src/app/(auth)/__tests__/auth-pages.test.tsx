import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";

import AuthLayout from "../layout";
import VerifyPage from "../verify/page";

describe("auth layout", () => {
  it("puts the product highlights beside the form, with the risk line", async () => {
    const { container } = render(
      <AuthLayout>
        <h1>Sign in to Finlytics</h1>
      </AuthLayout>,
    );

    const about = screen.getByRole("complementary", { name: "About Finlytics" });
    expect(about).toHaveClass("hidden", "lg:flex");
    for (const title of ["Live markets", "Option chains", "Strategies and backtests", "AI agents"]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText("Paper trading by default")).toBeInTheDocument();
    expect(screen.getAllByText("Investments in securities are subject to market risks.")).toHaveLength(2);
    expect(screen.getByRole("main")).toContainElement(screen.getByRole("heading", { level: 1 }));
    await expectNoAxeViolations(container);
  });
});

describe("verify page", () => {
  it("says the link is on its way and offers another email", async () => {
    const { container } = render(<VerifyPage />);

    expect(screen.getByRole("heading", { level: 1, name: "Check your email" })).toBeVisible();
    expect(screen.getByText(/expires in 10 minutes|expires in \d+ minutes/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Use a different email" })).toHaveAttribute("href", "/login");
    await expectNoAxeViolations(container);
  });
});
