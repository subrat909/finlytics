import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { expectNoAxeViolations } from "@/test/axe";

import SectionPage, { generateMetadata } from "../page";

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

function params(section: string) {
  return { params: Promise.resolve({ section }) };
}

describe("coming-soon section page", () => {
  it("says what the section will do, when it arrives and what it will offer", async () => {
    const { container } = render(await SectionPage(params("backtests")));

    expect(screen.getByRole("heading", { level: 1, name: "Backtests" })).toBeInTheDocument();
    expect(screen.getByText("Soon")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Backtests is on its way" })).toBeInTheDocument();
    expect(screen.getByText(/roadmap item 4\.4/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "What's coming" })).toBeInTheDocument();
    expect(screen.getByText("Minute-level option-chain history")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to the dashboard" })).toHaveAttribute("href", "/dashboard");
    await expectNoAxeViolations(container);
  });

  it("is not found for sections that exist or never will", async () => {
    await expect(SectionPage(params("charts"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(SectionPage(params("nope"))).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(generateMetadata(params("nope"))).resolves.toEqual({ title: "Not found" });
    await expect(generateMetadata(params("agents"))).resolves.toEqual({ title: "AI Agents" });
  });
});
