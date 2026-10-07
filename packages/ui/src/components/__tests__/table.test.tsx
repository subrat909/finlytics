import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { expectNoAxeViolations } from "../../test/axe";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "../table";

function Positions() {
  return (
    <Table containerClassName="max-h-96">
      <TableCaption>Open positions</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Instrument</TableHead>
          <TableHead numeric>Qty</TableHead>
          <TableHead numeric>LTP</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow data-state="selected">
          <TableCell>NIFTY 24000 CE</TableCell>
          <TableCell numeric>75</TableCell>
          <TableCell numeric>182.40</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>RELIANCE</TableCell>
          <TableCell numeric>10</TableCell>
          <TableCell numeric>2,945.10</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell>Total</TableCell>
          <TableCell numeric>85</TableCell>
          <TableCell />
        </TableRow>
      </TableFooter>
    </Table>
  );
}

describe("Table", () => {
  it("is a captioned table in a scroll container, with every part's data-slot", () => {
    render(<Positions />);

    const table = screen.getByRole("table", { name: "Open positions" });
    expect(table).toHaveAttribute("data-slot", "table");
    expect(table.parentElement).toHaveAttribute("data-slot", "table-container");
    expect(table.parentElement).toHaveClass("overflow-x-auto", "max-h-96");
    const slots = new Set([...table.querySelectorAll("[data-slot]")].map((part) => part.getAttribute("data-slot")));
    expect([...slots].sort()).toEqual(
      ["table-body", "table-caption", "table-cell", "table-footer", "table-head", "table-header", "table-row"].sort(),
    );
  });

  it("uses column headers with col scope, right-aligned over numbers", () => {
    render(<Positions />);

    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.getAttribute("scope"))).toEqual(["col", "col", "col"]);
    expect(headers[0]).toHaveClass("text-left", "uppercase", "text-fg-muted");
    expect(headers[1]).toHaveClass("text-right");
    expect(headers[1]).not.toHaveClass("tabular");
  });

  it("right-aligns numeric cells in tabular numerals, in 36px rows", () => {
    render(<Positions />);

    const [first] = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    const cells = within(first as HTMLElement).getAllByRole("cell");
    expect(cells[0]).toHaveClass("text-left", "h-9");
    expect(cells[2]).toHaveClass("text-right", "tabular", "h-9");
    expect(first).toHaveAttribute("data-state", "selected");
    expect(first).toHaveClass("data-[state=selected]:bg-surface-2", "border-b", "border-border");
  });

  it("makes the scroll container a named, focusable region only when asked", () => {
    const { rerender } = render(<Table aria-label="Holdings" />);
    const container = screen.getByRole("table").parentElement;
    expect(container).not.toHaveAttribute("tabindex");
    expect(container).not.toHaveAttribute("role");

    rerender(<Table aria-label="Holdings" scrollAreaLabel="Holdings, scrollable" />);
    const region = screen.getByRole("region", { name: "Holdings, scrollable" });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toContainElement(screen.getByRole("table"));
  });

  it("has no axe violations", async () => {
    const { container } = render(<Positions />);

    await expectNoAxeViolations(container);
  });
});
