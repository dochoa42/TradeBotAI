import type { TvCandlePoint } from "../components/TvCandles";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type EquityPoint = {
  ts: number;
  equity: number;
};

export type Trade = {
  id: number;
  symbol: string;
  side: "long" | "short";
  entry_ts: number;
  exit_ts: number | null;
  entry_price: number;
  exit_price: number | null;
  qty: number;
  pnl: number;
  max_drawdown_during_trade: number | null;
};

export type BacktestSummary = {
  starting_balance: number;
  ending_balance: number;
  total_pnl: number;
  win_pct: number;
  max_drawdown: number;
  sharpe_ratio: number;
};

export type BacktestResponse = {
  summary: BacktestSummary;
  equity_curve: EquityPoint[];
  trades: Trade[];
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
