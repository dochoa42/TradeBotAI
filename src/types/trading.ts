import type { TvCandlePoint } from "../components/TvCandles";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type EquityPoint = {
  ts: number;
  equity: number;
};

export type MultiChartState = {
  id: string;
  symbol: string;
  interval: Interval;
  candles: TvCandlePoint[];
  loading: boolean;
  error: string | null;
  detached?: boolean;
};
