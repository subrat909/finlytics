import { render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { forbiddenControlUtilities } from "../../test/classes";
import { Input } from "../input";

describe("Input", () => {
  it("is named by its associated label", () => {
    render(
      <>
        <label htmlFor="qty">Quantity</label>
        <Input id="qty" />
      </>,
    );

    const input = screen.getByRole("textbox", { name: "Quantity" });
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("data-slot", "input");
  });

  it("sets aria-invalid when invalid", () => {
    render(<Input aria-label="Stop-loss" invalid aria-describedby="sl-error" />);

    const input = screen.getByRole("textbox", { name: "Stop-loss" });
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute("aria-describedby", "sl-error");
  });

  it("is not marked invalid by default", () => {
    render(<Input aria-label="Stop-loss" />);

    expect(screen.getByRole("textbox", { name: "Stop-loss" })).not.toHaveAttribute("aria-invalid");
  });

  it("uses tabular numerals and inputMode=decimal when numeric", () => {
    render(
      <>
        <Input aria-label="Limit price" numeric />
        <Input aria-label="Lots" numeric inputMode="numeric" />
      </>,
    );

    const price = screen.getByRole("textbox", { name: "Limit price" });
    expect(price).toHaveClass("tabular");
    expect(price).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByRole("textbox", { name: "Lots" })).toHaveAttribute("inputmode", "numeric");
  });

  it("passes ref to the input element", () => {
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="Quantity" ref={ref} />);

    expect(ref.current).toBe(screen.getByRole("textbox", { name: "Quantity" }));
  });

  it("uses no border, shadow or ring utilities", () => {
    render(<Input aria-label="Quantity" invalid numeric />);

    expect(forbiddenControlUtilities(screen.getByRole("textbox", { name: "Quantity" }).className)).toEqual([]);
  });

  it("has no axe violations", async () => {
    const { container } = render(
      <div>
        <label htmlFor="qty">Quantity</label>
        <Input id="qty" placeholder="Lots" />
        <label htmlFor="sl">Stop-loss</label>
        <Input id="sl" invalid aria-describedby="sl-error" defaultValue="0" />
        <p id="sl-error">Enter a stop-loss above ₹0.</p>
        <label htmlFor="disabled">Disabled</label>
        <Input id="disabled" disabled />
      </div>,
    );

    await expectNoAxeViolations(container);
  });
});
