import React, { useEffect, useMemo, useState } from "react";
import { SimulationDesk } from "./components/SimulationDesk";
import DashboardView from "./components/DashboardView";
import MultiChartGrid from "./components/MultiChartGrid";
import TvCandles, { TvMarkerData, TvOverlayLine } from "./components/TvCandles";
import type {
  IndicatorToggle,
  ChartPanelStatus,
} from "./components/ChartPanel";
import type {
  Interval,
  EquityPoint,
  MultiChartState,
  BacktestResponse,
  BacktestSummary,
  ChartPoint,
  Trade,
} from "./types/trading";

// =============================================
// Types & Constants
// =============================================
type AppView = "dashboard" | "multichart" | "simulation";
type DataSource = "csv" | "api";
type StrategyPreset = {
  id: string;
  name: string;
  symbol: string;
  interval: Interval;
  thr: number;
  tp: number;
  sl: number;
};

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type BacktestTrade = Trade;

type AiSignalApi = {
  ts: number;
  side: "long" | "short" | "flat";
  prob_long: number;
  prob_short: number;
  prob_flat: number;
};

type AiSignal = {
  ts: number;
  signal: "long" | "short" | "flat";
  prob_long: number;
  prob_short: number;
  prob_flat: number;
};

type AiSignalsResponseApi = {
  symbol: string;
  interval: Interval;
  signals: AiSignalApi[];
};

type HistoryDownloadResponse = {
  symbol: string;
  interval: Interval;
  rows: number;
  path: string;
  note?: string;
};

type ModelSignal = {
  ts: number;
  signal: number; // -1, 0, 1
};

type ModelPredictResponse = {
  signals: ModelSignal[];
  meta: {
    model_type: string;
    model_version: string;
    symbol_trained?: string | null;
    interval_trained?: string | null;
    trained_at?: string | null;
    horizon?: number | null;
    threshold?: number | null;
    feature_cols: string[];
  };
};

// Single, central API base
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  (import.meta as any).env?.VITE_API_BASE ??
  "http://127.0.0.1:8000";
const ALLOWED_SYMBOLS = [
  "BTCUSDT",
  "ETHUSDT",
  "BNBUSDT",
  "SOLUSDT",
  "XRPUSDT",
] as const;

const TIMEFRAME_OPTIONS: Interval[] = [
  "1m",
  "5m",
  "15m",
  "1h",
  "4h",
  "1d",
];

const NAV_ITEMS: { key: AppView; label: string; hint: string }[] = [
  { key: "dashboard", label: "Dashboard", hint: "Overview" },
  { key: "multichart", label: "Multi-Chart Grid", hint: "Compare symbols" },
  { key: "simulation", label: "Simulation Desk", hint: "Playback" },
];

const VIEW_TITLES: Record<AppView, string> = {
  dashboard: "Dashboard",
  multichart: "Multi-Chart Grid",
  simulation: "Simulation Desk",
};

// =============================================
// Utilities
// =============================================

function fmtTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleString();
}

function sma(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (period <= 1) return values.slice();
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  if (!values.length) return out;
  if (period <= 1) return values.slice();

  const k = 2 / (period + 1);
  let emaPrev: number | null = null;

  for (let i = 0; i < values.length; i++) {
    const price = values[i];
    if (i < period - 1) continue;
    if (emaPrev == null) {
      let seed = 0;
      for (let j = i - period + 1; j <= i; j++) {
        seed += values[j];
      }
      emaPrev = seed / period;
      out[i] = emaPrev;
      continue;
    }
    emaPrev = price * k + emaPrev * (1 - k);
    out[i] = emaPrev;
  }

  return out;
}

function stddev(values: number[], period: number, means: number[]): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let s2 = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = values[j] - means[i];
      s2 += diff * diff;
    }
    out[i] = Math.sqrt(s2 / period);
  }
  return out;
}

function computeChartPoints(
  candles: Candle[],
  period: number,
  bandStd: number
): ChartPoint[] {
  if (!candles?.length) return [];
  const close = candles.map((c) => c.close);
  const sm = sma(close, period);
  const em = ema(close, period);
  const sd = stddev(close, period, sm);
  const upper = sd.map((v, i) => (isFinite(v) ? sm[i] + bandStd * v : NaN));
  const lower = sd.map((v, i) => (isFinite(v) ? sm[i] - bandStd * v : NaN));

  return candles.map((c, i) => ({
    ts: c.ts,
    time: fmtTime(c.ts),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    sma: sm[i],
    ema: em[i],
    bbU: upper[i],
    bbL: lower[i],
  }));
}

function buildOverlays(
  data: ChartPoint[],
  options: { showSMA: boolean; showEMA: boolean; showBB: boolean }
): TvOverlayLine[] {
  if (!data.length) return [];

  const lines: TvOverlayLine[] = [];

  if (options.showSMA) {
    lines.push({
      id: "sma20",
      color: "#38bdf8",
      data: data
        .filter((d) => Number.isFinite(d.sma))
        .map((d) => ({
          ts: d.ts,
          value: Number(d.sma),
        })),
    });
  }

  if (options.showEMA) {
    lines.push({
      id: "ema20",
      color: "#f97316",
      data: data
        .filter((d) => Number.isFinite(d.ema))
        .map((d) => ({
          ts: d.ts,
          value: Number(d.ema),
        })),
    });
  }

  if (options.showBB) {
    const upperLine: TvOverlayLine = {
      id: "bbU",
      color: "#a855f7",
      data: data
        .filter((d) => Number.isFinite(d.bbU))
        .map((d) => ({
          ts: d.ts,
          value: Number(d.bbU),
        })),
    };
    const lowerLine: TvOverlayLine = {
      id: "bbL",
      color: "#a855f7",
      data: data
        .filter((d) => Number.isFinite(d.bbL))
        .map((d) => ({
          ts: d.ts,
          value: Number(d.bbL),
        })),
    };
    lines.push(upperLine, lowerLine);
  }

  return lines;
}


async function fetchCandlesFromBackend(
  symbol: string,
  interval: Interval,
  limit = 500,
  provider: DataSource = "api"
): Promise<Candle[]> {
  const url = `${API_BASE}/api/candles?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=${limit}&provider=${provider}`;
  const r = await fetch(url);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Backend error ${r.status}: ${t}`);
  }
  const data = await r.json();
  return (data?.candles || []) as Candle[];
}

function buildDemoCandles(n = 200): Candle[] {
  const out: Candle[] = [];
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const ts = now - (n - i) * 60_000;
    const base = 60000 + Math.sin(i / 10) * 200;
    const open = base + (i % 2 === 0 ? 5 : -5);
    const close = base + (i % 2 === 0 ? 10 : -10);
    const high = Math.max(open, close) + 30;
    const low = Math.min(open, close) - 30;
    const volume = 1_000 + (i % 5) * 100;
    out.push({ ts, open, high, low, close, volume });
  }
  return out;
}

function getInitialView(): AppView {
  if (typeof window === "undefined") return "dashboard";
  const params = new URLSearchParams(window.location.search);
  const v = params.get("view");
  if (v === "multichart" || v === "simulation" || v === "dashboard") {
    return v;
  }
  return "dashboard";
}

const DEFAULT_MULTI_INTERVALS: Interval[] = ["1m", "5m", "15m", "1h"];
const MIN_MULTI_TILES = 2;
const MAX_MULTI_TILES = 6;

function generateTileId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // ignore
  }
  return `tile-${Math.random().toString(36).slice(2, 10)}`;
}

function createMultiTile(symbol: string, interval: Interval): MultiChartState {
  return {
    id: generateTileId(),
    symbol,
    interval,
    candles: [],
    loading: false,
    error: null,
    detached: false,
  };
}

// =============================================
// UI
// =============================================
export default function App() {
  // App-level view (tabs)
  const [activeView, setActiveView] = useState<AppView>(() => getInitialView());

  // Core state
  const [symbol, setSymbol] = useState<string>("BTCUSDT");
  const [tf, setTf] = useState<Interval>("1m");
  const [thr, setThr] = useState<number>(50);
  const [tp, setTp] = useState<number>(100);
  const [sl, setSl] = useState<number>(50);
  const [walkForward, setWalkForward] = useState<boolean>(false);
  // Data source: 'api' (Binance) or 'csv' (local history)
  const [dataSource, setDataSource] = useState<DataSource>("api");
  // Strategy presets
  const [presets, setPresets] = useState<StrategyPreset[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  // Candles
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loadingCandles, setLoadingCandles] = useState<boolean>(false);
  const [candlesError, setCandlesError] = useState<string | null>(null);

  // Indicators toggles
  const [showSMA, setShowSMA] = useState<boolean>(true);
  const [showEMA, setShowEMA] = useState<boolean>(false);
  const [showBB, setShowBB] = useState<boolean>(true);
  const smaPeriod = 20;
  const bbStd = 2;

  // AI / backtest state
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(
    null
  );
  const [backtestCandles, setBacktestCandles] = useState<ChartPoint[]>([]);
  const [backtestEquity, setBacktestEquity] = useState<EquityPoint[]>([]);
  const [backtestTrades, setBacktestTrades] = useState<Trade[]>([]);
  const [aiSignals, setAiSignals] = useState<AiSignal[]>([]);
  const [showAiSignals, setShowAiSignals] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isLoadingSignals, setIsLoadingSignals] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [lastBacktestAt, setLastBacktestAt] = useState<string | null>(null);
  const [startingBalance, setStartingBalance] = useState<number>(2000);
  const [riskPerTradePct, setRiskPerTradePct] = useState<number>(1);
  const [maxDailyLossPct, setMaxDailyLossPct] = useState<number>(5);

  // Multi-chart state
  const [multiViewEnabled, setMultiViewEnabled] = useState(false);
  const [multiCharts, setMultiCharts] = useState<MultiChartState[]>(() =>
    DEFAULT_MULTI_INTERVALS.map((interval) => createMultiTile("BTCUSDT", interval))
  );
  const [showFullscreenChart, setShowFullscreenChart] = useState(false);

  // Keep ?view in sync for deep links / new tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    window.history.replaceState(null, "", url.toString());
  }, [activeView]);

  const presetsForCurrent = useMemo(
    () =>
      presets.filter(
        (p) => p.symbol === symbol && p.interval === tf
      ),
    [presets, symbol, tf]
  );

  const activePreset = useMemo(
    () => presets.find((p) => p.id === activePresetId) ?? null,
    [presets, activePresetId]
  );

  const activePresetLabel = useMemo(
    () =>
      activePreset
        ? `${activePreset.name} · ${activePreset.symbol} ${activePreset.interval}`
        : null,
    [activePreset]
  );

  // Load presets from localStorage on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem("tb2_strategy_presets_v1");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setPresets(parsed);
      }
    } catch (err) {
      console.error("Failed to load strategy presets:", err);
    }
  }, []);

  // Persist presets to localStorage whenever they change
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        "tb2_strategy_presets_v1",
        JSON.stringify(presets)
      );
    } catch (err) {
      console.error("Failed to save strategy presets:", err);
    }
  }, [presets]);

  // Fetch candles when symbol/tf changes
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingCandles(true);
      setCandlesError(null);
      try {
        const s = (ALLOWED_SYMBOLS as readonly string[]).includes(symbol)
          ? symbol
          : "BTCUSDT";
        const data = await fetchCandlesFromBackend(s, tf, 500, dataSource);
        if (!cancelled) setCandles(data);
      } catch (err: any) {
        console.error("fetchCandlesFromBackend failed:", err);
        if (!cancelled) {
          setCandlesError(err?.message || "Failed to load candles");
          setCandles(buildDemoCandles());
        }
      } finally {
        if (!cancelled) setLoadingCandles(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [symbol, tf, dataSource]);

  // Reload AI signals when toggled on / symbol / tf change
  useEffect(() => {
    if (showAiSignals) {
      void loadAiSignals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, showAiSignals]);

  const multiChartFetchKey = useMemo(() => {
    return multiCharts
      .map((tile) => `${tile.id}:${tile.symbol}:${tile.interval}`)
      .join("|");
  }, [multiCharts]);

  useEffect(() => {
    if (!multiViewEnabled || !multiCharts.length) return;
    let cancelled = false;

    const tilesToFetch = multiCharts.map((tile) => ({
      id: tile.id,
      symbol: tile.symbol,
      interval: tile.interval,
    }));
    const fallbackSeries = computeChartPoints(buildDemoCandles(), smaPeriod, bbStd);

    tilesToFetch.forEach((tileInfo) => {
      setMultiCharts((prev) =>
        prev.map((tile) =>
          tile.id === tileInfo.id ? { ...tile, loading: true, error: null } : tile
        )
      );

      (async () => {
        try {
          const sym = (ALLOWED_SYMBOLS as readonly string[]).includes(tileInfo.symbol)
            ? tileInfo.symbol
            : "BTCUSDT";
          const fetched = await fetchCandlesFromBackend(
            sym,
            tileInfo.interval,
            300,
            dataSource
          );
          const chartPoints = computeChartPoints(fetched, smaPeriod, bbStd);
          if (cancelled) return;
          setMultiCharts((prev) =>
            prev.map((tile) =>
              tile.id === tileInfo.id
                ? { ...tile, candles: chartPoints, loading: false, error: null }
                : tile
            )
          );
        } catch (err: any) {
          if (cancelled) return;
          setMultiCharts((prev) =>
            prev.map((tile) =>
              tile.id === tileInfo.id
                ? {
                    ...tile,
                    candles: fallbackSeries,
                    loading: false,
                    error: err?.message || "Failed to load chart",
                  }
                : tile
            )
          );
        }
      })();
    });

    return () => {
      cancelled = true;
    };
  }, [multiViewEnabled, multiChartFetchKey, smaPeriod, bbStd, dataSource]);

  const handleTileChange = (id: string, patch: Partial<MultiChartState>) => {
    setMultiCharts((prev) =>
      prev.map((tile) => (tile.id === id ? { ...tile, ...patch } : tile))
    );
  };

  const addMultiChartTile = () => {
    setMultiCharts((prev) => {
      if (prev.length >= MAX_MULTI_TILES) return prev;
      const template = prev[prev.length - 1] ?? prev[0] ?? createMultiTile(symbol, tf);
      const nextInterval =
        DEFAULT_MULTI_INTERVALS[prev.length % DEFAULT_MULTI_INTERVALS.length] ??
        template.interval;
      return [...prev, createMultiTile(template.symbol, nextInterval)];
    });
  };

  const removeMultiChartTile = () => {
    setMultiCharts((prev) => {
      if (prev.length <= MIN_MULTI_TILES) return prev;
      return prev.slice(0, prev.length - 1);
    });
  };

  const handleSavePreset = () => {
    const defaultName =
      activePreset?.name ?? `${symbol} ${tf} • THR ${thr} • TP ${tp} • SL ${sl}`;

    const name = window.prompt("Preset name", defaultName);
    if (!name) return;

    const existing = presets.find(
      (p) => p.id === activePresetId && p.symbol === symbol && p.interval === tf
    );

    const id =
      existing?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const next: StrategyPreset = {
      id,
      name,
      symbol,
      interval: tf,
      thr,
      tp,
      sl,
    };

    setPresets((prev) => {
      const filtered = prev.filter((p) => p.id !== id);
      return [...filtered, next];
    });
    setActivePresetId(id);
  };

  const handleDeletePreset = () => {
    if (!activePresetId) return;
    if (!window.confirm("Delete selected preset?")) return;
    setPresets((prev) => prev.filter((p) => p.id !== activePresetId));
    setActivePresetId(null);
  };

  // ----- AI backtest -----
  async function runAiBacktest() {
    try {
      setIsRunningBacktest(true);
      setApiError(null);

      const body = {
        symbol,
        interval: tf,
        params: {
          thr,
          tp, // % TP
          sl, // % SL
          walkForward,
        },
          starting_balance: startingBalance,
          risk_per_trade_percent: riskPerTradePct,
          max_daily_loss_percent: maxDailyLossPct,
      };

      const res = await fetch(`${API_BASE}/api/backtest?provider=${dataSource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backtest failed: ${res.status} ${text}`);
      }

      const data: BacktestResponse = await res.json();
      setBacktestResult(data);
      setBacktestCandles(chartData);
      setBacktestEquity(data.equity_curve ?? []);
      setBacktestTrades(data.trades ?? []);
      setLastBacktestAt(new Date().toLocaleString());
    } catch (err: any) {
      console.error(err);
      setApiError(err.message ?? "Backtest error");
    } finally {
      setIsRunningBacktest(false);
    }
  }

  async function handleDownloadHistory() {
    try {
      setIsDownloadingHistory(true);
      setHistoryMessage(null);
      setApiError(null);

      const body = { symbol, interval: tf, limit: 2000 };

      const res = await fetch(`${API_BASE}/api/history/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`History download failed: ${res.status} ${text}`);
      }

      const data: HistoryDownloadResponse = await res.json();

      setHistoryMessage(
        `History updated: ${data.symbol} ${data.interval} · ${data.rows} rows → ${data.path}`
      );

      try {
        setLoadingCandles(true);
        setCandlesError(null);
        const refreshed = await fetchCandlesFromBackend(symbol, tf, 500, dataSource);
        setCandles(refreshed);
      } catch (refreshErr: any) {
        console.error(
          "Failed to reload candles after history download:",
          refreshErr
        );
        setCandlesError(
          refreshErr?.message ||
            "History downloaded, but failed to reload candles automatically."
        );
      } finally {
        setLoadingCandles(false);
      }
    } catch (err: any) {
      console.error(err);
      setApiError(err.message ?? "History download error");
    } finally {
      setIsDownloadingHistory(false);
    }
  }

  // ----- AI signals (overlay) -----
  async function loadAiSignals() {
    try {
      setIsLoadingSignals(true);
      setApiError(null);

      const body = {
        symbol,
        interval: tf,
        limit: 500,
      };

      const res = await fetch(`${API_BASE}/api/ai/signals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`AI signals request failed: ${res.status} ${text}`);
      }

      const data: AiSignalsResponseApi = await res.json();
      const normalized: AiSignal[] = data.signals.map((sig) => ({
        ts: sig.ts,
        signal: sig.side,
        prob_long: sig.prob_long,
        prob_short: sig.prob_short,
        prob_flat: sig.prob_flat,
      }));
      setAiSignals(normalized);
    } catch (err: any) {
      console.error(err);
      setApiError(err.message ?? "Failed to load AI signals");
    } finally {
      setIsLoadingSignals(false);
    }
  }

  // ----- Derived series / indicators -----
  const chartData = useMemo<ChartPoint[]>(() => {
    return computeChartPoints(candles, smaPeriod, bbStd);
  }, [candles, smaPeriod, bbStd]);

  const overlays = useMemo<TvOverlayLine[]>(() => {
    return buildOverlays(chartData, { showSMA, showEMA, showBB });
  }, [chartData, showSMA, showEMA, showBB]);

  const multiChartTilesWithOverlays = useMemo(() => {
    return multiCharts.map((tile) => {
      const chartPoints = tile.candles;
      const overlaysForTile = buildOverlays(chartPoints, {
        showSMA,
        showEMA,
        showBB,
      });
      return {
        ...tile,
        candles: chartPoints,
        overlays: overlaysForTile,
      };
    });
  }, [multiCharts, showSMA, showEMA, showBB]);

  const indicatorToggles = useMemo<IndicatorToggle[]>(
    () => [
      {
        key: "sma",
        label: "SMA",
        active: showSMA,
        onToggle: () => setShowSMA((prev) => !prev),
      },
      {
        key: "ema",
        label: "EMA",
        active: showEMA,
        onToggle: () => setShowEMA((prev) => !prev),
      },
      {
        key: "bb",
        label: "Boll",
        active: showBB,
        onToggle: () => setShowBB((prev) => !prev),
      },
    ],
    [showSMA, showEMA, showBB]
  );

  const tvAiMarkers = useMemo<TvMarkerData[]>(() => {
    if (!showAiSignals || !aiSignals.length || !candles.length) return [];

    const byTs = new Map(aiSignals.map((s) => [s.ts, s.signal]));

    return candles
      .map((c) => {
        const sig = byTs.get(c.ts);
        if (!sig || sig === "flat") return null;
        const isLong = sig === "long";
        return {
          ts: c.ts,
          position: isLong ? "belowBar" : "aboveBar",
          color: isLong ? "#22c55e" : "#ef4444",
          shape: isLong ? "arrowUp" : "arrowDown",
          text: isLong ? "L" : "S",
        };
      })
      .filter(Boolean) as TvMarkerData[];
  }, [showAiSignals, aiSignals, candles]);

  // Last price + statuses
  const lastPrice = candles.length ? candles[candles.length - 1].close : null;
  const prevPrice =
    candles.length > 1 ? candles[candles.length - 2].close : null;
  const priceChangePct =
    lastPrice != null && prevPrice && prevPrice !== 0
      ? ((lastPrice - prevPrice) / prevPrice) * 100
      : null;

  const chartStatus: ChartPanelStatus = {
    lastPrice,
    changePct: priceChangePct,
    bars: candles.length,
    interval: tf,
    isLoading: loadingCandles,
    error: candlesError,
  };

  const accountSummary: BacktestSummary | null = backtestResult
    ? backtestResult.summary
    : null;
  const equityChartData: EquityPoint[] = backtestResult?.equity_curve ?? [];

  const dashboardMetrics = useMemo(() => {
    if (!accountSummary) return null;
    return {
      pnl: accountSummary.total_pnl,
      winPct: accountSummary.win_pct * 100,
      maxDrawdown: Math.abs(accountSummary.max_drawdown * 100),
      sharpe: accountSummary.sharpe_ratio,
    };
  }, [accountSummary]);

  // API status pill for header
  const apiStatusLabel = candlesError
    ? "API error"
    : loadingCandles
    ? "Syncing"
    : "API live";
  const apiStatusColor = candlesError
    ? "bg-rose-400"
    : loadingCandles
    ? "bg-amber-400"
    : "bg-emerald-400";

  const activeNav = NAV_ITEMS.find((item) => item.key === activeView) ?? NAV_ITEMS[0];

  // New-tab opener for multi-chart view
  const openMultiChartInNewTab = () => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "multichart");
    window.open(url.toString(), "_blank", "noopener,noreferrer");
  };

  // ---------------- Sections composed by view ----------------
  const controlPanelSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4">
      <div className="rounded-2xl bg-neutral-900/80 border border-neutral-800 px-4 py-3 flex flex-col gap-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-400">
              <span>Symbol</span>
              <select
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                className="bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
              >
                {ALLOWED_SYMBOLS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              {TIMEFRAME_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => setTf(t)}
                  className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition ${
                    tf === t
                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-100"
                      : "border-neutral-700 text-slate-300 hover:border-neutral-500"
                  }`}
                  aria-label={`Set timeframe ${t}`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="uppercase tracking-wider text-slate-400">Source</span>
              <select
                value={dataSource}
                onChange={(e) => setDataSource(e.target.value as DataSource)}
                className="bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                aria-label="Select data source"
              >
                <option value="api">API (Binance)</option>
                <option value="csv">CSV (Local)</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showSMA}
                  onChange={(e) => setShowSMA(e.target.checked)}
                  aria-label="Toggle SMA(20)"
                />
                <span>SMA(20)</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showEMA}
                  onChange={(e) => setShowEMA(e.target.checked)}
                  aria-label="Toggle EMA(20)"
                />
                <span>EMA(20)</span>
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showBB}
                  onChange={(e) => setShowBB(e.target.checked)}
                  aria-label="Toggle Bollinger Bands"
                />
                <span>Boll ±2σ</span>
              </label>
            </div>
          </div>

          <div className="flex flex-col gap-2 w-full lg:w-auto lg:items-end">
            {/* THR / TP / SL inputs */}
            <div className="grid grid-cols-3 gap-2 text-xs sm:text-sm w-full lg:w-auto">
              <label className="flex flex-col gap-1">
                <span className="opacity-70">THR</span>
                <input
                  className="bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-1"
                  type="number"
                  value={thr}
                  onChange={(e) => setThr(Number(e.target.value))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="opacity-70">TP (%)</span>
                <input
                  className="bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-1"
                  type="number"
                  value={tp}
                  onChange={(e) => setTp(Number(e.target.value))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="opacity-70">SL (%)</span>
                <input
                  className="bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-1"
                  type="number"
                  value={sl}
                  onChange={(e) => setSl(Number(e.target.value))}
                />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2 justify-end text-xs sm:text-sm">
              <label className="flex items-center gap-2">
                <span className="opacity-70">Preset</span>
                <select
                  value={activePresetId ?? ""}
                  onChange={(e) => {
                    const id = e.target.value || null;
                    setActivePresetId(id);
                    if (!id) return;
                    const preset = presets.find((p) => p.id === id);
                    if (!preset) return;
                    setThr(preset.thr);
                    setTp(preset.tp);
                    setSl(preset.sl);
                  }}
                  className="bg-neutral-950 border border-neutral-700 rounded-xl px-2 py-1 min-w-[160px]"
                >
                  <option value="">No preset</option>
                  {presetsForCurrent.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                onClick={handleSavePreset}
                className="px-3 py-1.5 rounded-xl border border-indigo-500 text-indigo-100 text-xs sm:text-sm hover:bg-indigo-500/10"
              >
                Save preset
              </button>
              <button
                type="button"
                onClick={handleDeletePreset}
                disabled={!activePresetId}
                className="px-3 py-1.5 rounded-xl border border-red-500 text-red-200 text-xs sm:text-sm disabled:opacity-40 hover:bg-red-500/10"
              >
                Delete
              </button>
              {activePresetLabel && (
                <span className="text-[11px] text-slate-400 truncate max-w-[220px]">
                  {activePresetLabel}
                </span>
              )}
            </div>
            {/* Walk-forward / Run AI / Overlay AI signals */}
            <div className="flex flex-wrap items-center gap-3 justify-end text-xs sm:text-sm">
              <label className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={walkForward}
                  onChange={(e) => setWalkForward(e.target.checked)}
                  aria-label="Enable walk-forward"
                />
                <span>Walk-forward</span>
              </label>
              <button
                onClick={runAiBacktest}
                disabled={isRunningBacktest}
                className="px-4 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-sm font-semibold"
              >
                {isRunningBacktest ? "Running AI Backtest..." : "Run AI Backtest"}
              </button>
              <label className="inline-flex items-center gap-1.5 text-slate-200">
                <input
                  type="checkbox"
                  checked={showAiSignals}
                  onChange={async (e) => {
                    const checked = e.target.checked;
                    setShowAiSignals(checked);
                    if (checked) {
                      await loadAiSignals();
                    }
                  }}
                  className="rounded"
                  disabled={isLoadingSignals || !candles.length}
                  aria-label="Overlay AI signals"
                />
                <span className="flex items-center gap-1">
                  Overlay AI signals
                  {isLoadingSignals && (
                    <span className="text-[10px] opacity-70">Loading…</span>
                  )}
                </span>
              </label>
            </div>
            {apiError && (
              <span className="text-xs text-rose-400 mt-1" role="alert">
                {apiError}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2 text-xs text-slate-300 sm:flex-row sm:items-center sm:justify-end border-t border-neutral-800 pt-2">
          <button
            onClick={handleDownloadHistory}
            disabled={isDownloadingHistory}
            className="px-3 py-1.5 rounded-xl bg-neutral-950 border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
          >
            {isDownloadingHistory
              ? "Downloading history..."
              : "Download / Update History"}
          </button>
          {historyMessage && (
            <span className="opacity-70 truncate" title={historyMessage}>
              {historyMessage}
            </span>
          )}
        </div>
      </div>
    </section>
  );


  const multiChartSection = (
    <section className="max-w-7xl mx-auto px-4 mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold">Multi-Chart Grid</h3>
          <p className="text-sm text-slate-400">
            Compare up to six symbols or timeframes side-by-side with shared
            indicators.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3 justify-end">
          <div className="inline-flex items-center gap-2 rounded-full border border-neutral-800 bg-neutral-900/80 px-3 py-1 text-xs">
            <button
              type="button"
              onClick={removeMultiChartTile}
              disabled={multiCharts.length <= MIN_MULTI_TILES}
              className="px-2 py-0.5 rounded-full border border-neutral-700 hover:border-neutral-500 disabled:opacity-40"
            >
              –
            </button>
            <span className="font-semibold text-slate-300">
              {multiCharts.length} charts
            </span>
            <button
              type="button"
              onClick={addMultiChartTile}
              disabled={multiCharts.length >= MAX_MULTI_TILES}
              className="px-2 py-0.5 rounded-full border border-neutral-700 hover:border-neutral-500 disabled:opacity-40"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={openMultiChartInNewTab}
            className="px-3 py-1.5 rounded-xl border border-neutral-700 bg-neutral-900 text-xs font-semibold hover:border-indigo-400 hover:text-indigo-200"
          >
            Open grid in new tab
          </button>
          <label className="inline-flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={multiViewEnabled}
              onChange={(e) => setMultiViewEnabled(e.target.checked)}
              className="rounded"
            />
            <span>Enable multi-chart view</span>
          </label>
        </div>
      </div>
      {multiViewEnabled ? (
        <MultiChartGrid
          tiles={multiChartTilesWithOverlays}
          symbols={ALLOWED_SYMBOLS}
          timeframeOptions={TIMEFRAME_OPTIONS}
          indicators={indicatorToggles}
          onTileChange={handleTileChange}
        />
      ) : (
        <div className="text-sm text-slate-400 border border-dashed border-neutral-800 rounded-2xl p-6 text-center">
          Toggle the switch above to load multi-asset charts.
        </div>
      )}
    </section>
  );

  const simulationSection = (
    <section className="max-w-7xl mx-auto px-4 mt-6">
      <div className="rounded-2xl bg-neutral-900/80 border border-neutral-800 p-6">
        <div className="flex flex-col gap-2 mb-4">
          <h3 className="text-xl font-semibold">Simulation Desk</h3>
          <p className="text-sm text-slate-400">
            Uses the most recent backtest result for playback. If no backtest has
            been run yet, it will fall back to the current chart.
          </p>
        </div>
        <SimulationDesk
          candles={backtestCandles.length ? backtestCandles : chartData}
          equityCurve={backtestEquity}
          trades={backtestTrades}
          presetLabel={activePresetLabel}
        />
      </div>
    </section>
  );

  const footerSection = (
    <footer className="max-w-7xl mx-auto px-4 py-6 opacity-60 text-xs">
      <div>
        Data source: Binance (via FastAPI backend). If backend is offline, a demo
        fallback renders.
      </div>
      <div className="mt-1">API = {API_BASE}</div>
    </footer>
  );

  let viewContent: React.ReactNode;
  switch (activeView) {
    case "multichart":
      viewContent = <>{multiChartSection}</>;
      break;
    case "simulation":
      viewContent = (
        <>
          {controlPanelSection}
          {simulationSection}
        </>
      );
      break;
    default:
      viewContent = (
        <DashboardView
          symbol={symbol}
          interval={tf}
          symbols={ALLOWED_SYMBOLS}
          timeframeOptions={TIMEFRAME_OPTIONS}
          onSymbolChange={setSymbol}
          onIntervalChange={(next) => setTf(next)}
          indicatorToggles={indicatorToggles}
          chartStatus={chartStatus}
          candles={chartData}
          overlays={overlays}
          markers={showAiSignals ? tvAiMarkers : []}
          metrics={dashboardMetrics}
          equityCurve={equityChartData}
          showAiSignals={showAiSignals}
          onToggleAiSignals={async (checked) => {
            setShowAiSignals(checked);
            if (checked) {
              await loadAiSignals();
            }
          }}
          isLoadingSignals={isLoadingSignals}
          thr={thr}
          tp={tp}
          sl={sl}
          onThrChange={setThr}
          onTpChange={setTp}
          onSlChange={setSl}
          walkForward={walkForward}
          onToggleWalkForward={setWalkForward}
          onRunBacktest={runAiBacktest}
          onStartSimulation={() => setActiveView("simulation")}
          onDownloadHistory={handleDownloadHistory}
          isRunningBacktest={isRunningBacktest}
          isDownloadingHistory={isDownloadingHistory}
          historyMessage={historyMessage}
          lastPrice={lastPrice}
          priceChangePct={priceChangePct}
          onOpenFullscreen={() => setShowFullscreenChart(true)}
          startingBalance={startingBalance}
          riskPerTradePct={riskPerTradePct}
          maxDailyLossPct={maxDailyLossPct}
          onStartingBalanceChange={(value) =>
            setStartingBalance(Number.isFinite(value) ? value : 0)
          }
          onRiskPerTradeChange={(value) =>
            setRiskPerTradePct(Number.isFinite(value) ? value : 0)
          }
          onMaxDailyLossChange={(value) =>
            setMaxDailyLossPct(Number.isFinite(value) ? value : 0)
          }
          lastBacktestAt={lastBacktestAt}
          accountSummary={accountSummary}
        />
      );
  }

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100 flex">
      {/* Sidebar */}
      <aside className="hidden md:flex w-60 flex-col border-r border-neutral-900 bg-gradient-to-b from-neutral-950 via-neutral-950 to-black/90">
        <div className="px-4 py-4 flex items-center gap-3 border-b border-neutral-800">
          <div className="h-8 w-8 rounded-2xl bg-gradient-to-tr from-indigo-500 via-sky-400 to-emerald-400 shadow-[0_0_20px_rgba(56,189,248,0.7)]" />
          <div>
            <div className="text-sm font-semibold tracking-tight">
              Trading Bot 2
            </div>
            <div className="text-[11px] text-slate-400">
              ML + Backtesting Console
            </div>
          </div>
        </div>
        <nav className="mt-4 flex-1 px-3 space-y-1">
          {NAV_ITEMS.map((item) => {
            const active = item.key === activeView;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => setActiveView(item.key)}
                className={`w-full text-left px-3 py-2 rounded-xl text-sm flex flex-col border transition ${
                  active
                    ? "bg-indigo-600/20 border-indigo-500 text-indigo-100 shadow-[0_0_12px_rgba(79,70,229,0.7)]"
                    : "border-neutral-800 text-slate-300 hover:border-neutral-600 hover:bg-neutral-900"
                }`}
              >
                <span className="font-semibold">{item.label}</span>
                <span className="text-[11px] opacity-70">{item.hint}</span>
              </button>
            );
          })}
        </nav>
        <div className="px-4 py-4 border-t border-neutral-800 text-xs text-slate-400 flex items-center justify-between">
          <span>Theme</span>
          <span className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-2 py-0.5">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
            Dark
          </span>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-h-screen">
        {/* Header */}
        <header className="border-b border-neutral-800 sticky top-0 z-10 backdrop-blur bg-neutral-950/80">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-slate-500 mb-0.5">
                Trading Bot 2
              </div>
              <div className="flex items-center gap-3">
                <h1 className="text-lg md:text-xl font-semibold tracking-tight">
                  {VIEW_TITLES[activeView]}
                </h1>
                <span className="hidden sm:inline text-[11px] text-slate-400">
                  Binance candles · React + Vite + TS + Tailwind + Recharts
                </span>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1">
              {lastBacktestAt && (
                <div className="text-[11px] text-slate-400">
                  Last AI backtest:{" "}
                  <span className="text-slate-200">{lastBacktestAt}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px]">
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${apiStatusColor} text-neutral-900 font-semibold`}
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-neutral-900" />
                  {apiStatusLabel}
                </span>
                <span className="hidden sm:inline text-slate-500">
                  {symbol} · {tf}
                </span>
              </div>
            </div>
          </div>

          {/* Mobile nav */}
          <div className="md:hidden max-w-7xl mx-auto px-4 pb-2 flex gap-2">
            {NAV_ITEMS.map((item) => {
              const active = item.key === activeView;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setActiveView(item.key)}
                  className={`flex-1 px-2 py-1 rounded-full text-[11px] border ${
                    active
                      ? "bg-indigo-600/30 border-indigo-500 text-indigo-100"
                      : "border-neutral-700 text-slate-300"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
        </header>

        {/* Content views */}
        <main className="flex-1 pb-8">{viewContent}</main>

        {/* Fullscreen chart overlay */}
        {showFullscreenChart && (
          <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col">
            <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800">
              <div className="text-sm text-slate-300">
                Candle Playback Viewer — {symbol} · {tf}
              </div>
              <button
                type="button"
                onClick={() => setShowFullscreenChart(false)}
                className="px-3 py-1.5 rounded-xl border border-slate-700 text-xs text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            <div className="flex-1 p-4">
              <div className="w-full h-full rounded-2xl border border-slate-800 bg-slate-950/80">
                <TvCandles
                  data={chartData}
                  markers={showAiSignals ? tvAiMarkers : []}
                  overlays={overlays}
                  className="w-full h-full"
                />
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {footerSection}
      </div>
    </div>
  );
}
