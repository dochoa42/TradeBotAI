import {
  LiveStatus,
  PlacePaperOrderRequest,
  PaperTradeRecord,
  EquitySnapshot,
  PaperPerformanceSummary,
  ExecutionModeResponse,
  StrategyPerformanceRow,
} from "../types/trading";

type KillSwitchState = {
  tripped: boolean;
  reason?: string | null;
};

const BASE_URL = "/api/live";

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

export async function fetchPaperTrades(
  limit = 100
): Promise<PaperTradeRecord[]> {
  const res = await fetch(`/api/live/paper/trades?limit=${limit}`);
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
