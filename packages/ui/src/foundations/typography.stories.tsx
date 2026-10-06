import type { Meta, StoryObj } from "@storybook/react-vite";

/** Inter for the interface, JetBrains Mono for numbers, prices and instrument keys, always with tabular numerals. */
const meta = {
  title: "Foundations/Typography",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const SIZES = [
  ["text-3xl font-semibold", "Portfolio overview"],
  ["text-2xl font-semibold", "Option chain"],
  ["text-xl font-semibold", "Positions"],
  ["text-lg font-medium", "Active strategies"],
  ["text-base", "Connect a broker to see your portfolio."],
  ["text-sm text-fg-muted", "Prices update in real time while the market is open."],
  ["text-xs text-fg-muted", "Retail broker latency is about 50–300 ms."],
] as const;

const PRICES = [
  ["NIFTY 50", "₹24,812.35", "▲ 1.24%", "text-profit"],
  ["BANKNIFTY", "₹51,107.90", "▼ 0.38%", "text-loss"],
  ["SENSEX", "₹81,224.75", "▲ 0.91%", "text-profit"],
  ["RELIANCE", "₹2,911.10", "▼ 11.62%", "text-loss"],
] as const;

export const Scale: Story = {
  render: () => (
    <div className="space-y-10 text-fg">
      <section aria-labelledby="sans-heading" className="space-y-3">
        <h2 id="sans-heading" className="text-sm font-medium text-fg-muted">
          Inter Variable (font-sans): the interface
        </h2>
        {SIZES.map(([className, text]) => (
          <p key={className} className={className}>
            {text}
          </p>
        ))}
      </section>

      <section aria-labelledby="mono-heading" className="space-y-3">
        <h2 id="mono-heading" className="text-sm font-medium text-fg-muted">
          JetBrains Mono Variable (font-mono, tabular): numbers, prices, instrument keys
        </h2>
        <p className="font-mono text-sm">NSE_FO|NIFTY|2025-10-30|24000|CE</p>
        <table className="text-sm">
          <caption className="sr-only">Index prices with tabular numerals</caption>
          <thead className="text-left text-fg-muted">
            <tr>
              <th scope="col" className="pr-8 pb-2 font-medium">
                Instrument
              </th>
              <th scope="col" className="pr-8 pb-2 text-right font-medium">
                LTP
              </th>
              <th scope="col" className="pb-2 text-right font-medium">
                Change
              </th>
            </tr>
          </thead>
          <tbody>
            {PRICES.map(([name, price, change, tone]) => (
              <tr key={name}>
                <th scope="row" className="pr-8 py-1 text-left font-normal">
                  {name}
                </th>
                <td className="tabular pr-8 py-1 text-right">{price}</td>
                <td className={`tabular py-1 text-right ${tone}`}>{change}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="max-w-xl text-sm text-fg-muted">
          Tabular numerals keep digits the same width, so columns of prices line up and a ticking price doesn&apos;t
          jitter. Profit and loss always carry a ▲ or ▼ glyph as well as a colour.
        </p>
      </section>
    </div>
  ),
};
