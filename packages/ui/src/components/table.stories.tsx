import type { Meta, StoryObj } from "@storybook/react-vite";

import { expectNoHorizontalScroll } from "../test/stories";

import { Badge } from "./badge";
import { Table, TableBody, TableCaption, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "./table";

interface Row {
  symbol: string;
  exchange: string;
  qty: number;
  avg: string;
  ltp: string;
  pnl: string;
  direction: "up" | "down";
}

const ROWS: readonly Row[] = [
  {
    symbol: "NIFTY 24000 CE",
    exchange: "NFO",
    qty: 75,
    avg: "164.20",
    ltp: "182.40",
    pnl: "+1,365.00",
    direction: "up",
  },
  {
    symbol: "BANKNIFTY 52000 PE",
    exchange: "NFO",
    qty: 30,
    avg: "212.55",
    ltp: "198.10",
    pnl: "-433.50",
    direction: "down",
  },
  { symbol: "RELIANCE", exchange: "NSE", qty: 10, avg: "2,901.35", ltp: "2,945.10", pnl: "+437.50", direction: "up" },
  { symbol: "HDFCBANK", exchange: "NSE", qty: 25, avg: "1,688.00", ltp: "1,672.45", pnl: "-388.75", direction: "down" },
];

/**
 * A positions table in a bordered panel: 13px text, 36px rows, uppercase muted headers, numbers right-aligned in
 * tabular mono, and ▲/▼ with the profit/loss colour (never colour alone). At 360 px it scrolls inside its panel.
 */
const meta = {
  title: "Components/Table",
  component: Table,
  tags: ["responsive"],
  render: () => (
    <div className="rounded-md border border-border bg-surface-1">
      <div className="flex h-10 items-center justify-between border-b border-border px-3 text-sm font-medium">
        Positions
        <Badge size="sm" tone="primary">
          Paper
        </Badge>
      </div>
      <Table scrollAreaLabel="Open positions, scrollable">
        <TableCaption className="sr-only">Open positions</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Instrument</TableHead>
            <TableHead numeric>Qty</TableHead>
            <TableHead numeric>Avg</TableHead>
            <TableHead numeric>LTP</TableHead>
            <TableHead numeric>P&amp;L</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ROWS.map((row, index) => (
            <TableRow key={row.symbol} data-state={index === 0 ? "selected" : undefined}>
              <TableCell>
                <span className="font-medium">{row.symbol}</span>{" "}
                <span className="text-2xs text-fg-muted">{row.exchange}</span>
              </TableCell>
              <TableCell numeric>{row.qty}</TableCell>
              <TableCell numeric>{row.avg}</TableCell>
              <TableCell numeric>{row.ltp}</TableCell>
              <TableCell numeric className={row.direction === "up" ? "text-profit" : "text-loss"}>
                <span aria-hidden="true">{row.direction === "up" ? "▲ " : "▼ "}</span>
                {row.pnl}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow>
            <TableCell colSpan={4}>Total</TableCell>
            <TableCell numeric className="text-profit">
              <span aria-hidden="true">▲ </span>+980.25
            </TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </div>
  ),
  play: async () => {
    await expectNoHorizontalScroll();
  },
} satisfies Meta<typeof Table>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Positions: Story = {};
