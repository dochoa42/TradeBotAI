import type { TvCandlePoint } from "../components/TvCandles";

export type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

export type EquityPoint = {
  ts: number;
  equity: number;
};

export type ChartPoint = TvCandlePoint & {
  volume: number;
  sma: number;
  ema: number;
  bbU: number;
  bbL: number;
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
  candles: ChartPoint[];
  loading: boolean;
  error: string | null;
  detached?: boolean;
};

// ============================
// Live / Paper Trading (Phase 10)
// ============================

export type TradingMode = "backtest" | "paper" | "live";

export interface LivePosition {
  symbol: string;
  side: "long" | "short";
  size: number;
  entry_price: number;
  current_price: number;
  unrealized_pnl: number;
}

export interface LiveOrder {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type: "market" | "limit";
  price?: number | null;
  status: "new" | "filled" | "canceled";
}

export interface LiveStatus {
  mode: TradingMode;
  equity: number;
  daily_pnl: number;
  positions: LivePosition[];
  orders: LiveOrder[];
  kill_switch_tripped: boolean;
  kill_switch_reason?: string | null;
  daily_loss_limit?: number | null;
  max_position_size?: number | null;
  max_open_positions?: number | null;
}

export interface PlacePaperOrderRequest {
  symbol: string;
  side: "buy" | "sell";
  qty: number;
  type?: "market" | "limit";
  price?: number;
}

// ============================
// Paper trading history (Phase 10.8)
// ============================

export interface PaperTradeRecord {
  ts: string; // ISO timestamp from backend
  symbol: string;
  side: string;
  qty: number;
  entry_price: number;
  exit_price: number;
  pnl: number;
  strategy_name?: string | null;
  alpha_score?: number | null;
  entry_signal_time?: string | number | null;
  holding_minutes?: number | null;
  tags?: Record<string, unknown> | null;
}

export interface EquitySnapshot {
  ts: string; // ISO timestamp from backend
  equity: number;
  daily_pnl: number;
}

export interface PaperPerformanceSummary {
  total_trades: number;
  win_trades: number;
  loss_trades: number;
  win_rate: number;
  gross_pnl: number;
  net_pnl: number;
  max_drawdown: number;
  avg_r_multiple: number | null;
  best_trade_pnl: number | null;
  worst_trade_pnl: number | null;
  avg_holding_minutes: number | null;
}
