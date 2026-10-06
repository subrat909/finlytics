import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, within } from "storybook/test";

import { readToken, tokenContrast } from "./contrast";

/** Every colour token with its value and use, then the text pairs of the contrast matrix with live ratios. */
const meta = {
  title: "Foundations/Colors",
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

// Full class names, so Tailwind generates them (no dynamic class strings).
const SWATCH: Readonly<Record<string, string>> = {
  bg: "bg-bg",
  "surface-1": "bg-surface-1",
  "surface-2": "bg-surface-2",
  "surface-3": "bg-surface-3",
  fg: "bg-fg",
  "fg-muted": "bg-fg-muted",
  primary: "bg-primary",
  "primary-fg": "bg-primary-fg",
  highlight: "bg-highlight",
  profit: "bg-profit",
  "profit-fg": "bg-profit-fg",
  loss: "bg-loss",
  "loss-fg": "bg-loss-fg",
  warning: "bg-warning",
  info: "bg-info",
  violet: "bg-violet",
  orange: "bg-orange",
  ring: "bg-ring",
};

const TEXT: Readonly<Record<string, string>> = {
  fg: "text-fg",
  "fg-muted": "text-fg-muted",
  primary: "text-primary",
  highlight: "text-highlight",
  profit: "text-profit",
  loss: "text-loss",
  warning: "text-warning",
  info: "text-info",
  violet: "text-violet",
  orange: "text-orange",
};

const SURFACES = ["bg", "surface-1", "surface-2", "surface-3"] as const;

/** Where each token is used (the semantic accents also colour icons and chips, docs/05). */
const USES: ReadonlyArray<readonly [token: string, use: string]> = [
  ["bg", "Page background"],
  ["surface-1", "Cards"],
  ["surface-2", "Inputs, secondary buttons, toggle track"],
  ["surface-3", "Hover surface"],
  ["fg", "Primary text"],
  ["fg-muted", "Secondary text, placeholders"],
  ["primary", "Brand, primary buttons, active nav, strategies"],
  ["primary-fg", "Text on primary"],
  ["highlight", "Links, chips, watchlists"],
  ["profit", "Positive P&L, Buy"],
  ["profit-fg", "Text on Buy"],
  ["loss", "Negative P&L, Sell, errors, risk"],
  ["loss-fg", "Text on Sell"],
  ["warning", "Risk, expiring tokens, alerts"],
  ["info", "Informational, option chain"],
  ["violet", "AI agents"],
  ["orange", "Brokers"],
  ["ring", "Focus outline"],
];

const FILLS = [
  ["primary", "primary-fg", "bg-primary text-primary-fg", "Primary"],
  ["profit", "profit-fg", "bg-profit text-profit-fg", "Buy ▲"],
  ["loss", "loss-fg", "bg-loss text-loss-fg", "Sell ▼"],
] as const;

const SURFACE_CLASS: Readonly<Record<(typeof SURFACES)[number], string>> = {
  bg: "bg-bg",
  "surface-1": "bg-surface-1",
  "surface-2": "bg-surface-2",
  "surface-3": "bg-surface-3",
};

function Ratio({ foreground, background, min }: { foreground: string; background: string; min: number }) {
  const ratio = tokenContrast(foreground, background);
  if (ratio === undefined) return <span className="text-fg-muted">n/a</span>;
  return (
    <span className="tabular text-xs text-fg-muted">
      {ratio.toFixed(2)}:1 {ratio >= min ? "✓" : `✗ under ${String(min)}:1`}
    </span>
  );
}

function ColorTokens() {
  return (
    <div className="space-y-10 text-fg">
      <section aria-labelledby="tokens-heading" className="space-y-3">
        <h2 id="tokens-heading" className="text-lg font-semibold">
          Tokens
        </h2>
        <table className="w-full max-w-3xl text-left text-sm">
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-2 font-medium">
                Token
              </th>
              <th scope="col" className="py-2 font-medium">
                <span className="sr-only">Swatch</span>
              </th>
              <th scope="col" className="py-2 font-medium">
                Value
              </th>
              <th scope="col" className="py-2 font-medium">
                Use
              </th>
            </tr>
          </thead>
          <tbody>
            {USES.map(([token, use]) => (
              <tr key={token}>
                <td className="py-1.5 font-mono">--{token}</td>
                <td className="py-1.5">
                  <span aria-hidden="true" className="block size-8 rounded-lg bg-surface-2 p-1">
                    <span className={`block size-full rounded-md ${SWATCH[token] ?? ""}`} />
                  </span>
                </td>
                <td className="tabular py-1.5">{readToken(token)}</td>
                <td className="py-1.5 text-fg-muted">{use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="text-heading" className="space-y-3">
        <h2 id="text-heading" className="text-lg font-semibold">
          Text on surfaces (≥ 4.5:1)
        </h2>
        <p className="max-w-3xl text-sm text-fg-muted">
          Live ratios for the current theme. Accents never sit on the hover surface (surface-3), so those cells are
          empty. The CI gate is the contrast test in test/tokens.
        </p>
        <table className="text-left text-sm">
          <thead className="text-fg-muted">
            <tr>
              <th scope="col" className="py-2 pr-4 font-medium">
                Text
              </th>
              {SURFACES.map((surface) => (
                <th key={surface} scope="col" className="px-2 py-2 font-medium">
                  on {surface}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.keys(TEXT).map((token) => (
              <tr key={token}>
                <th scope="row" className="py-1 pr-4 text-left font-mono font-normal">
                  {token}
                </th>
                {SURFACES.map((surface) => {
                  const used = surface !== "surface-3" || token === "fg" || token === "fg-muted";
                  return (
                    <td key={surface} className="p-1">
                      {used ? (
                        <div className={`rounded-lg px-3 py-2 ${SURFACE_CLASS[surface]}`}>
                          <div className={`font-medium ${TEXT[token] ?? ""}`}>Aa ₹1,234.50</div>
                          <Ratio foreground={token} background={surface} min={4.5} />
                        </div>
                      ) : (
                        <span className="px-3 text-fg-muted">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="fills-heading" className="space-y-3">
        <h2 id="fills-heading" className="text-lg font-semibold">
          Text on fills (≥ 4.5:1)
        </h2>
        <div className="flex flex-wrap gap-4">
          {FILLS.map(([fill, text, className, label]) => (
            <div key={fill} className="space-y-1">
              <div className={`rounded-xl px-4 py-2 font-medium ${className}`}>{label}</div>
              <Ratio foreground={text} background={fill} min={4.5} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export const Tokens: Story = {
  // A key per theme remounts the tables when the toolbar theme changes, so the values and ratios are re-read.
  render: (_args, { globals }) => <ColorTokens key={String(globals["theme"])} />,
  play: async ({ canvasElement }) => {
    // Every pair has a ratio, in the dev server and in the minified build (which writes #ffffff as #fff).
    await expect(within(canvasElement).queryAllByText("n/a")).toEqual([]);
  },
};
