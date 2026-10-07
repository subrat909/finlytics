"use client";

import { createContext, useContext } from "react";

import type { Session } from "../lib/bars";
import type { ChartController } from "../lib/chart/controller";

/** What the workspace's panels know about the instrument on the chart. */
export interface ChartInfo {
  instrumentKey: string;
  symbol: string;
  name: string;
  exchange: string;
  precision: number;
  session: Session;
}

export const ChartControllerContext = createContext<ChartController | null>(null);
export const ChartInfoContext = createContext<ChartInfo | null>(null);

/** The live chart engine, or null until the canvas has mounted. */
export function useChartController(): ChartController | null {
  return useContext(ChartControllerContext);
}

export function useChartInfo(): ChartInfo {
  const info = useContext(ChartInfoContext);
  if (info === null) throw new Error("useChartInfo() needs a <ChartInfoContext> provider");
  return info;
}
