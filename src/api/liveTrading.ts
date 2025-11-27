import {
  LiveStatus,
  PlacePaperOrderRequest,
  PaperTradeRecord,
  EquitySnapshot,
  PaperPerformanceSummary,
  ExecutionModeResponse,
  StrategyPerformanceRow,
  StrategyComparisonRow,
  Interval,
} from "../types/trading";

type KillSwitchState = {
  tripped: boolean;
  reason?: string | null;
};

const BASE_URL = "/api/live";

export type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
};

type CandleProvider = "api" | "csv";

type FetchCandlesParams = {
  symbol: string;
  interval: Interval;
  limit?: number;
  provider?: CandleProvider;
};

export async function fetchSymbolCandles({
  symbol,
  interval,
  limit = 500,
  provider = "api",
}: FetchCandlesParams): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
    provider,
  });
  const res = await fetch(`/api/candles?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch candles: ${res.status}`);
  }
  const payload = await res.json();
  return Array.isArray(payload?.candles) ? (payload.candles as Candle[]) : [];
}

export async function fetchPaperStatus(): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/status`);
  if (!res.ok) {
    throw new Error(`Failed to fetch paper status: ${res.status}`);
  }
  return res.json();
}

export async function fetchExecutionMode(): Promise<ExecutionModeResponse> {
  const res = await fetch(`${BASE_URL}/execution-mode`);
  if (!res.ok) {
    throw new Error("Failed to fetch execution mode");
  }
  return res.json();
}

export async function placePaperOrder(
  body: PlacePaperOrderRequest
): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/place_order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to place paper order: ${res.status}`);
  }
  return res.json();
}

export async function cancelPaperOrder(orderId: string): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/cancel_order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ order_id: orderId }),
  });
  if (!res.ok) {
    throw new Error(`Failed to cancel paper order: ${res.status}`);
  }
  return res.json();
}

export type ResetPaperEquityBody = {
  target_equity?: number;
  note?: string;
};

export async function resetPaperEquity(
  body: ResetPaperEquityBody = {}
): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/reset-equity`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Failed to reset paper equity: ${res.status}`);
  }
  return res.json();
}

export async function fetchKillSwitch(): Promise<KillSwitchState> {
  const res = await fetch(`${BASE_URL}/paper/kill-switch`);
  if (!res.ok) {
    throw new Error(`Failed to fetch kill switch: ${res.status}`);
  }
  return res.json();
}

export async function toggleKillSwitch(
  tripped: boolean,
  reason?: string
): Promise<KillSwitchState> {
  const res = await fetch(`${BASE_URL}/paper/kill-switch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tripped, reason }),
  });
  if (!res.ok) {
    throw new Error(`Failed to toggle kill switch: ${res.status}`);
  }
  return res.json();
}

export async function flattenPaperPosition(
  symbol: string,
  side: "long" | "short",
  exitPrice: number
): Promise<LiveStatus> {
  const res = await fetch(`${BASE_URL}/paper/flatten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ symbol, side, exit_price: exitPrice }),
  });
  if (!res.ok) {
    throw new Error(`Failed to flatten position: ${res.status}`);
  }
  return res.json();
}

export type PaperTradeQuery = {
  symbol?: string;
  strategy?: string;
  limit?: number;
  offset?: number;
};

export async function fetchPaperTrades(
  limit = 100,
  offset = 0,
  filters: PaperTradeQuery = {}
): Promise<PaperTradeRecord[]> {
  const params = new URLSearchParams();
  params.set("limit", String(filters.limit ?? limit));
  params.set("offset", String(filters.offset ?? offset));
  if (filters.symbol) {
    params.set("symbol", filters.symbol);
  }
  if (filters.strategy) {
    params.set("strategy", filters.strategy);
  }
  const res = await fetch(`/api/live/paper/trades?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch paper trades: ${res.status}`);
  }
  return res.json();
}

export async function fetchEquityHistory(
  limit = 200
): Promise<EquitySnapshot[]> {
  const res = await fetch(`/api/live/paper/equity-history?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Failed to fetch equity history: ${res.status}`);
  }
  return res.json();
}

export type PaperSummaryFilters = {
  symbol?: string;
  strategy?: string;
  start_ts?: number;
  end_ts?: number;
};

export async function fetchPaperSummary(
  filters: PaperSummaryFilters = {}
): Promise<PaperPerformanceSummary> {
  const params = new URLSearchParams();
  (Object.entries(filters) as [
    keyof PaperSummaryFilters,
    string | number | undefined
  ][])
    .forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") {
        return;
      }
      params.set(key, String(value));
    });
  const qs = params.toString();
  const url = `${BASE_URL}/paper/summary${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch paper summary: ${res.status}`);
  }
  return res.json();
}

export async function fetchStrategyPerformance(
  symbol?: string
): Promise<StrategyPerformanceRow[]> {
  const params = new URLSearchParams();
  if (symbol && symbol !== "ALL") {
    params.set("symbol", symbol);
  }
  const qs = params.toString();
  const url = `${BASE_URL}/paper/strategy-performance${qs ? `?${qs}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error("Failed to fetch strategy performance");
  }
  return res.json();
}

export async function fetchPaperStrategies(symbol?: string): Promise<string[]> {
  const params = new URLSearchParams();
  if (symbol && symbol.trim().length > 0) {
    params.set("symbol", symbol.trim());
  }
  const qs = params.toString();
  const res = await fetch(
    `${BASE_URL}/paper/strategies${qs ? `?${qs}` : ""}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch paper strategies");
  }
  const payload = await res.json();
  return Array.isArray(payload?.strategies)
    ? (payload.strategies as string[])
    : [];
}

export type StrategyComparisonParams = {
  symbol?: string;
  strategy?: string;
};

export async function fetchStrategyComparison(
  params: StrategyComparisonParams = {}
): Promise<StrategyComparisonRow[]> {
  const search = new URLSearchParams();
  if (params.symbol && params.symbol !== "ALL") {
    search.set("symbol", params.symbol);
  }
  if (params.strategy) {
    search.set("strategy", params.strategy);
  }

  const qs = search.toString();
  const res = await fetch(
    `${BASE_URL}/paper/strategy-comparison${qs ? `?${qs}` : ""}`
  );
  if (!res.ok) {
    throw new Error("Failed to fetch strategy comparison");
  }
  const payload = await res.json();
  return Array.isArray(payload) ? payload : [payload];
}
