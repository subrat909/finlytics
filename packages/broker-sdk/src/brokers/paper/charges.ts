/**
 * Paper charges are a pluggable function (plan B13): brokerage, STT, exchange and SEBI fees, stamp duty and GST differ
 * by broker, segment and year, so the platform (or a backtest profile) supplies them. The default charges nothing.
 */
import type { DecimalLike, InstrumentKey, ProductType } from "@finlytics/shared";

import type { OrderSide } from "../../models";

/** One paper fill, as the charges function sees it. */
export interface PaperFill {
  readonly instrumentKey: InstrumentKey;
  readonly side: OrderSide;
  readonly product: ProductType;
  readonly qty: number;
  /** The fill price, a decimal string. */
  readonly price: string;
}

/** Charges for one fill: a non-negative amount (decimal string or Decimal). */
export type PaperChargesFn = (fill: PaperFill) => DecimalLike;

/** The default: no charges. */
export const zeroCharges: PaperChargesFn = () => "0";
