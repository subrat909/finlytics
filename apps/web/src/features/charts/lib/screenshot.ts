/**
 * The screenshot button: the chart's canvas (drawings included) under a header line with the symbol, interval and the
 * last bar's OHLC, saved as a PNG. Falls back to the bare chart canvas where a 2D context isn't available.
 */
import type { Bar } from "./bars";
import { formatNumber } from "./format";
import type { ChartColors } from "./theme-colors";
import { fileStamp, formatBarTime } from "./time";

export interface ScreenshotMeta {
  symbol: string;
  exchange: string;
  interval: string;
  intraday: boolean;
  bar: Bar | null;
  precision: number;
  colors: ChartColors;
  fontFamily: string;
}

const HEADER = 32;

export function screenshotFileName(
  meta: Pick<ScreenshotMeta, "symbol" | "interval" | "bar">,
  nowSeconds: number,
): string {
  const symbol = meta.symbol.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${symbol || "chart"}_${meta.interval}_${fileStamp(meta.bar?.time ?? nowSeconds)}.png`;
}

export function composeScreenshot(chart: HTMLCanvasElement, meta: ScreenshotMeta): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = chart.width;
  const scale = chart.width / Math.max(1, chart.clientWidth || chart.width);
  const header = Math.round(HEADER * scale);
  canvas.height = chart.height + header;
  const context = canvas.getContext("2d");
  if (context === null) return chart;
  const { colors, bar } = meta;
  context.fillStyle = colors.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = `600 ${String(13 * scale)}px ${meta.fontFamily}`;
  context.textBaseline = "middle";
  context.fillStyle = colors.textStrong;
  const title = `${meta.symbol} · ${meta.interval} · ${meta.exchange}`;
  context.fillText(title, 10 * scale, header / 2);
  if (bar !== null) {
    let x = 10 * scale + context.measureText(title).width + 16 * scale;
    context.font = `500 ${String(12 * scale)}px ${meta.fontFamily}`;
    const parts: [string, string][] = [
      ["O", formatNumber(bar.open, meta.precision)],
      ["H", formatNumber(bar.high, meta.precision)],
      ["L", formatNumber(bar.low, meta.precision)],
      ["C", formatNumber(bar.close, meta.precision)],
    ];
    for (const [label, value] of parts) {
      context.fillStyle = colors.text;
      context.fillText(label, x, header / 2);
      x += context.measureText(label).width + 4 * scale;
      context.fillStyle = bar.close >= bar.open ? colors.up : colors.down;
      context.fillText(value, x, header / 2);
      x += context.measureText(value).width + 10 * scale;
    }
    context.fillStyle = colors.text;
    context.fillText(`${formatBarTime(bar.time, meta.intraday)} IST`, x + 6 * scale, header / 2);
  }
  context.drawImage(chart, 0, header);
  return canvas;
}

/** Saves a canvas as a PNG through a temporary object URL (revoked right after). */
export function downloadCanvas(canvas: HTMLCanvasElement, fileName: string): Promise<void> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (blob === null) {
        resolve();
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => {
        URL.revokeObjectURL(url);
      }, 0);
      resolve();
    }, "image/png");
  });
}
