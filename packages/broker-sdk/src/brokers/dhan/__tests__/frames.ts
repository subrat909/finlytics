/**
 * Binary market-feed frames for tests, written with DataView exactly as the live-market-feed page lays them out
 * (little endian; header u8 code, u16 length, u8 segment, u32 security id).
 */
import { DHAN_FEED_RESPONSE, DHAN_PACKET } from "../types";

function frame(code: number, size: number, segment: number, securityId: number): [ArrayBuffer, DataView] {
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  view.setUint8(0, code);
  view.setUint16(1, size, true);
  view.setUint8(3, segment);
  view.setUint32(4, securityId, true);
  return [buffer, view];
}

export function tickerFrame(segment: number, securityId: number, ltp: number, ltt: number, code = 2): ArrayBuffer {
  const [buffer, view] = frame(code, DHAN_PACKET.TICKER_BYTES, segment, securityId);
  view.setFloat32(8, ltp, true);
  view.setUint32(12, ltt, true);
  return buffer;
}

export function prevCloseFrame(segment: number, securityId: number, prevClose: number, prevOi: number): ArrayBuffer {
  const [buffer, view] = frame(DHAN_FEED_RESPONSE.PREV_CLOSE, DHAN_PACKET.TICKER_BYTES, segment, securityId);
  view.setFloat32(8, prevClose, true);
  view.setUint32(12, prevOi, true);
  return buffer;
}

export function oiFrame(segment: number, securityId: number, oi: number): ArrayBuffer {
  const [buffer, view] = frame(DHAN_FEED_RESPONSE.OI, DHAN_PACKET.OI_BYTES, segment, securityId);
  view.setUint32(8, oi, true);
  return buffer;
}

export interface QuoteValues {
  readonly ltp: number;
  readonly ltq?: number;
  readonly ltt: number;
  readonly atp?: number;
  readonly volume?: number;
  readonly totalSellQty?: number;
  readonly totalBuyQty?: number;
  readonly open?: number;
  readonly close?: number;
  readonly high?: number;
  readonly low?: number;
}

export function quoteFrame(segment: number, securityId: number, values: QuoteValues): ArrayBuffer {
  const [buffer, view] = frame(DHAN_FEED_RESPONSE.QUOTE, DHAN_PACKET.QUOTE_BYTES, segment, securityId);
  view.setFloat32(8, values.ltp, true);
  view.setUint16(12, values.ltq ?? 0, true);
  view.setUint32(14, values.ltt, true);
  view.setFloat32(18, values.atp ?? 0, true);
  view.setUint32(22, values.volume ?? 0, true);
  view.setUint32(26, values.totalSellQty ?? 0, true);
  view.setUint32(30, values.totalBuyQty ?? 0, true);
  view.setFloat32(34, values.open ?? 0, true);
  view.setFloat32(38, values.close ?? 0, true);
  view.setFloat32(42, values.high ?? 0, true);
  view.setFloat32(46, values.low ?? 0, true);
  return buffer;
}

export interface DepthValues {
  readonly bidQty: number;
  readonly askQty: number;
  readonly bidOrders: number;
  readonly askOrders: number;
  readonly bid: number;
  readonly ask: number;
}

export function fullFrame(
  segment: number,
  securityId: number,
  values: QuoteValues & { readonly oi: number; readonly depth: readonly DepthValues[] },
): ArrayBuffer {
  const [buffer, view] = frame(DHAN_FEED_RESPONSE.FULL, DHAN_PACKET.FULL_BYTES, segment, securityId);
  view.setFloat32(8, values.ltp, true);
  view.setUint16(12, values.ltq ?? 0, true);
  view.setUint32(14, values.ltt, true);
  view.setFloat32(18, values.atp ?? 0, true);
  view.setUint32(22, values.volume ?? 0, true);
  view.setUint32(26, values.totalSellQty ?? 0, true);
  view.setUint32(30, values.totalBuyQty ?? 0, true);
  view.setUint32(34, values.oi, true);
  view.setUint32(38, values.oi, true); // highest OI
  view.setUint32(42, values.oi, true); // lowest OI
  view.setFloat32(46, values.open ?? 0, true);
  view.setFloat32(50, values.close ?? 0, true);
  view.setFloat32(54, values.high ?? 0, true);
  view.setFloat32(58, values.low ?? 0, true);
  for (const [level, depth] of values.depth.slice(0, DHAN_PACKET.DEPTH_LEVELS).entries()) {
    const base = DHAN_PACKET.FULL_DEPTH_OFFSET + level * DHAN_PACKET.DEPTH_LEVEL_BYTES;
    view.setUint32(base, depth.bidQty, true);
    view.setUint32(base + 4, depth.askQty, true);
    view.setUint16(base + 8, depth.bidOrders, true);
    view.setUint16(base + 10, depth.askOrders, true);
    view.setFloat32(base + 12, depth.bid, true);
    view.setFloat32(base + 16, depth.ask, true);
  }
  return buffer;
}

export function statusFrame(): ArrayBuffer {
  return frame(DHAN_FEED_RESPONSE.MARKET_STATUS, DHAN_PACKET.HEADER_BYTES, 0, 0)[0];
}

export function disconnectFrame(code: number): ArrayBuffer {
  const [buffer, view] = frame(DHAN_FEED_RESPONSE.DISCONNECT, DHAN_PACKET.DISCONNECT_BYTES, 0, 0);
  view.setUint16(8, code, true);
  return buffer;
}

/** Several packets in one WebSocket message. */
export function concatFrames(...frames: ArrayBuffer[]): ArrayBuffer {
  const out = new Uint8Array(frames.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of frames) {
    out.set(new Uint8Array(part), at);
    at += part.byteLength;
  }
  return out.buffer;
}
