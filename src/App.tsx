import React, { useEffect, useMemo, useState } from "react";
import { SimulationDesk } from "./components/SimulationDesk";
import ChartPanel from "./components/ChartPanel";
import TvCandles, {
  TvCandlePoint,
  TvMarkerData,
  TvOverlayLine,
} from "./components/TvCandles";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// =============================================
// Types & Constants
// =============================================
type Interval = "1m" | "5m" | "15m" | "1h" | "4h" | "1d";
type AppView = "dashboard" | "multichart" | "simulation";
type StrategyView = "baseline" | "ai" | "both";

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type ChartPoint = TvCandlePoint & {
  volume: number;
  sma: number;
  ema: number;
  bbU: number;
  bbL: number;
};

// --- AI / backtest types ---
type BacktestTrade = {
  entry_ts: number;
  exit_ts: number;
  side: number; // +1 long, -1 short
  entry_price: number;
  exit_price: number;
  pnl: number;
};

type EquityPoint = {
  ts: number;
  equity: number;
};

type BacktestMetrics = {
  win_rate: number;
  profit_factor: number;
  sharpe: number;
  max_drawdown: number;
};

type ConfusionCounts = {
  tp: number;
  fp: number;
  tn: number;
  fn: number;
};

type FeatureImportanceItem = {
  name: string;
  importance: number;
};

type StrategyBacktestSummary = {
  trades: BacktestTrade[];
  equity_curve: EquityPoint[];
  metrics: BacktestMetrics;
  confusion: ConfusionCounts;
  feature_importance: FeatureImportanceItem[];
};

type StrategyBacktestPair = {
  baseline: StrategyBacktestSummary;
  ai: StrategyBacktestSummary;
};

type BacktestResponse = {
  trades: BacktestTrade[];
  equity_curve: EquityPoint[];
  metrics: BacktestMetrics;
  confusion: ConfusionCounts;
  feature_importance: FeatureImportanceItem[];
  strategies?: StrategyBacktestPair | null;
};

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

type Preset = {
  name: string;
  symbol: string; // e.g., BTCUSDT
  tf: Interval;
  thr: number;
  tp: number;
  sl: number;
  walkForward: boolean;
};

// Single, central API base
const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  (import.meta as any).env?.VITE_API_BASE ??
  "http://127.0.0.1:8000";

const PRESET_KEY = "tb_presets_v1";
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
function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESET_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr as Preset[];
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

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

// Basic metrics from close-to-close returns (for demo donut)
function basicMetrics(candles: Candle[]) {
  if (candles.length < 2) {
    return { win: 0, loss: 0, flat: 0, winPct: 0, sharpe: 0, pf: 0 };
  }
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const r =
      (candles[i].close - candles[i - 1].close) / candles[i - 1].close;
    rets.push(r);
  }
  const wins = rets.filter((r) => r > 0).length;
  const losses = rets.filter((r) => r < 0).length;
  const flats = rets.length - wins - losses;
  const winPct = rets.length ? (wins / rets.length) * 100 : 0;
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const variance =
    rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) /
    (rets.length || 1);
  const stdev = Math.sqrt(variance) || 1e-9;
  const sharpe = mean / stdev;
  const sumPos = rets.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const sumNeg = Math.abs(
    rets.filter((r) => r < 0).reduce((a, b) => a + b, 0)
  );
  const pf = sumNeg > 0 ? sumPos / sumNeg : sumPos > 0 ? Infinity : 0;
  return { win: wins, loss: losses, flat: flats, winPct, sharpe, pf };
}

async function fetchCandlesFromBackend(
  symbol: string,
  interval: Interval,
  limit = 500
): Promise<Candle[]> {
  const url = `${API_BASE}/api/candles?symbol=${encodeURIComponent(
    symbol
  )}&interval=${interval}&limit=${limit}`;
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

  // Presets
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [newPresetName, setNewPresetName] = useState<string>("");

  // AI / backtest state
  const [strategyView, setStrategyView] = useState<StrategyView>("ai");
  const [backtestResult, setBacktestResult] = useState<BacktestResponse | null>(
    null
  );
  const [aiMetrics, setAiMetrics] = useState<BacktestMetrics | null>(null);
  const [aiEquityCurve, setAiEquityCurve] = useState<EquityPoint[]>([]);
  const [aiFeatureImportance, setAiFeatureImportance] = useState<
    FeatureImportanceItem[]
  >([]);
  const [aiConfusion, setAiConfusion] = useState<ConfusionCounts | null>(null);
  const [aiSignals, setAiSignals] = useState<AiSignal[]>([]);
  const [showAiSignals, setShowAiSignals] = useState(false);
  const [isRunningBacktest, setIsRunningBacktest] = useState(false);
  const [isLoadingSignals, setIsLoadingSignals] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [isDownloadingHistory, setIsDownloadingHistory] = useState(false);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);
  const [lastBacktestAt, setLastBacktestAt] = useState<string | null>(null);

  // Multi-chart state
  const [multiViewEnabled, setMultiViewEnabled] = useState(false);
  const [multiASymbol, setMultiASymbol] = useState<string>("BTCUSDT");
  const [multiATf, setMultiATf] = useState<Interval>("1h");
  const [multiBSymbol, setMultiBSymbol] = useState<string>("ETHUSDT");
  const [multiBTf, setMultiBTf] = useState<Interval>("1h");
  const [multiACandles, setMultiACandles] = useState<Candle[]>([]);
  const [multiALoading, setMultiALoading] = useState<boolean>(false);
  const [multiAError, setMultiAError] = useState<string | null>(null);
  const [multiBCandles, setMultiBCandles] = useState<Candle[]>([]);
  const [multiBLoading, setMultiBLoading] = useState<boolean>(false);
  const [multiBError, setMultiBError] = useState<string | null>(null);
  const [showFullscreenChart, setShowFullscreenChart] = useState(false);

  // Keep ?view in sync for deep links / new tab
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", activeView);
    window.history.replaceState(null, "", url.toString());
  }, [activeView]);

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
        const data = await fetchCandlesFromBackend(s, tf, 500);
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
  }, [symbol, tf]);

  // Reload AI signals when toggled on / symbol / tf change
  useEffect(() => {
    if (showAiSignals) {
      void loadAiSignals();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, showAiSignals]);

  // Multi-chart A
  useEffect(() => {
    if (!multiViewEnabled) return;
    let cancelled = false;
    async function load() {
      setMultiALoading(true);
      setMultiAError(null);
      try {
        const sym = (ALLOWED_SYMBOLS as readonly string[]).includes(multiASymbol)
          ? multiASymbol
          : "BTCUSDT";
        const data = await fetchCandlesFromBackend(sym, multiATf, 300);
        if (!cancelled) {
          setMultiACandles(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setMultiAError(err?.message || "Failed to load chart A");
          setMultiACandles(buildDemoCandles());
        }
      } finally {
        if (!cancelled) {
          setMultiALoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [multiViewEnabled, multiASymbol, multiATf]);

  // Multi-chart B
  useEffect(() => {
    if (!multiViewEnabled) return;
    let cancelled = false;
    async function load() {
      setMultiBLoading(true);
      setMultiBError(null);
      try {
        const sym = (ALLOWED_SYMBOLS as readonly string[]).includes(multiBSymbol)
          ? multiBSymbol
          : "BTCUSDT";
        const data = await fetchCandlesFromBackend(sym, multiBTf, 300);
        if (!cancelled) {
          setMultiBCandles(data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setMultiBError(err?.message || "Failed to load chart B");
          setMultiBCandles(buildDemoCandles());
        }
      } finally {
        if (!cancelled) {
          setMultiBLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [multiViewEnabled, multiBSymbol, multiBTf]);

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
      };

      const res = await fetch(`${API_BASE}/api/backtest`, {
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

      setAiEquityCurve(data.equity_curve);
      setAiMetrics(data.metrics);
      setAiFeatureImportance(data.feature_importance);
      setAiConfusion(data.confusion);
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
        const refreshed = await fetchCandlesFromBackend(symbol, tf, 500);
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

  const multiAChartData = useMemo<ChartPoint[]>(() => {
    return computeChartPoints(multiACandles, smaPeriod, bbStd);
  }, [multiACandles, smaPeriod, bbStd]);

  const multiBChartData = useMemo<ChartPoint[]>(() => {
    return computeChartPoints(multiBCandles, smaPeriod, bbStd);
  }, [multiBCandles, smaPeriod, bbStd]);

  const multiAOverlays = useMemo<TvOverlayLine[]>(() => {
    return buildOverlays(multiAChartData, { showSMA, showEMA, showBB });
  }, [multiAChartData, showSMA, showEMA, showBB]);

  const multiBOverlays = useMemo<TvOverlayLine[]>(() => {
    return buildOverlays(multiBChartData, { showSMA, showEMA, showBB });
  }, [multiBChartData, showSMA, showEMA, showBB]);

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

  const metrics = useMemo(() => basicMetrics(candles), [candles]);

  // Last price + statuses
  const lastPrice = candles.length ? candles[candles.length - 1].close : null;
  const prevPrice =
    candles.length > 1 ? candles[candles.length - 2].close : null;
  const priceChangePct =
    lastPrice != null && prevPrice && prevPrice !== 0
      ? ((lastPrice - prevPrice) / prevPrice) * 100
      : null;

  const multiALastPrice = multiACandles.length
    ? multiACandles[multiACandles.length - 1].close
    : null;
  const multiAPrevPrice =
    multiACandles.length > 1
      ? multiACandles[multiACandles.length - 2].close
      : null;
  const multiAPriceChangePct =
    multiALastPrice != null &&
    multiAPrevPrice &&
    multiAPrevPrice !== 0
      ? ((multiALastPrice - multiAPrevPrice) / multiAPrevPrice) * 100
      : null;

  const multiBLastPrice = multiBCandles.length
    ? multiBCandles[multiBCandles.length - 1].close
    : null;
  const multiBPrevPrice =
    multiBCandles.length > 1
      ? multiBCandles[multiBCandles.length - 2].close
      : null;
  const multiBPriceChangePct =
    multiBLastPrice != null &&
    multiBPrevPrice &&
    multiBPrevPrice !== 0
      ? ((multiBLastPrice - multiBPrevPrice) / multiBPrevPrice) * 100
      : null;

  const chartStatus = {
    lastPrice,
    changePct: priceChangePct,
    bars: candles.length,
    interval: tf,
    isLoading: loadingCandles,
    error: candlesError,
  };

  const multiAChartStatus = {
    lastPrice: multiALastPrice,
    changePct: multiAPriceChangePct,
    bars: multiACandles.length,
    interval: multiATf,
    isLoading: multiALoading,
    error: multiAError,
  };

  const multiBChartStatus = {
    lastPrice: multiBLastPrice,
    changePct: multiBPriceChangePct,
    bars: multiBCandles.length,
    interval: multiBTf,
    isLoading: multiBLoading,
    error: multiBError,
  };

  const volumeData = useMemo(
    () =>
      chartData.map((d) => ({
        time: d.time,
        volume: d.volume,
      })),
    [chartData]
  );

  // Preset actions
  function savePreset() {
    const name = newPresetName.trim();
    if (!name) return;
    const next: Preset = { name, symbol, tf, thr, tp, sl, walkForward };
    const filtered = presets.filter((p) => p.name !== name);
    const all = [...filtered, next];
    setPresets(all);
    savePresets(all);
    setNewPresetName("");
  }

  function loadPreset(p: Preset) {
    setSymbol(p.symbol);
    setTf(p.tf);
    setThr(p.thr);
    setTp(p.tp);
    setSl(p.sl);
    setWalkForward(p.walkForward);
  }

  function deletePreset(name: string) {
    const all = presets.filter((p) => p.name !== name);
    setPresets(all);
    savePresets(all);
  }

  // Strategy summaries + display helpers
  const hasStrategyPair = Boolean(backtestResult?.strategies);
  const baselineSummary = backtestResult
    ? backtestResult.strategies?.baseline ?? backtestResult
    : null;
  const aiSummary = backtestResult
    ? backtestResult.strategies?.ai ?? backtestResult
    : null;
  const showDualView = Boolean(hasStrategyPair && strategyView === "both");
  const summaryForView = hasStrategyPair
    ? showDualView
      ? null
      : strategyView === "baseline"
      ? baselineSummary
      : aiSummary
    : backtestResult;

  const fallbackFeatureImportance: FeatureImportanceItem[] = [
    { name: "rsi_14", importance: 0.3 },
    { name: "close_over_sma20", importance: 0.25 },
    { name: "vol_z", importance: 0.15 },
  ];

  const metricsSource = summaryForView?.metrics ?? aiMetrics ?? null;
  const formatWinRate = (m?: BacktestMetrics | null) =>
    m ? `${(m.win_rate * 100).toFixed(1)}%` : "—";
  const formatPf = (m?: BacktestMetrics | null) =>
    m && m.profit_factor > 0 ? m.profit_factor.toFixed(2) : "—";
  const formatSharpe = (m?: BacktestMetrics | null) =>
    m ? m.sharpe.toFixed(2) : "—";
  const formatMaxDd = (m?: BacktestMetrics | null) =>
    m ? `${(m.max_drawdown * 100).toFixed(1)}%` : "—";

  const winRateDisplay = formatWinRate(metricsSource);
  const pfDisplay = formatPf(metricsSource);
  const sharpeDisplay = formatSharpe(metricsSource);
  const maxDdDisplay = formatMaxDd(metricsSource);

  const featureImportanceOwner = showDualView
    ? aiSummary ?? baselineSummary
    : summaryForView;
  const featureImportanceData =
    (featureImportanceOwner?.feature_importance?.length
      ? featureImportanceOwner.feature_importance
      : null) ??
    (aiFeatureImportance.length > 0
      ? aiFeatureImportance
      : fallbackFeatureImportance);

  const confusion =
    summaryForView?.confusion ??
    aiConfusion ?? { tp: 0, fp: 0, tn: 0, fn: 0 };

  const equityCurveSingle =
    summaryForView?.equity_curve ?? (aiEquityCurve.length ? aiEquityCurve : []);
  const baselineEquityCurve =
    baselineSummary?.equity_curve ?? equityCurveSingle;
  const aiEquityCurveData = aiSummary?.equity_curve ?? equityCurveSingle;
  const equityChartData = showDualView ? aiEquityCurveData : equityCurveSingle;
  const equityChartLabel = showDualView
    ? "Baseline vs AI"
    : hasStrategyPair
    ? strategyView === "baseline"
      ? "Baseline"
      : "AI"
    : "AI";
  const equityLineColor =
    !hasStrategyPair || strategyView === "ai" ? "#22c55e" : "#f97316";
  const baselineMetrics = baselineSummary?.metrics ?? null;
  const aiMetricsSummary = aiSummary?.metrics ?? null;
  const metricsLabel = hasStrategyPair
    ? strategyView === "baseline"
      ? "Baseline"
      : "AI"
    : "AI";

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
              <span className="text-xs text-rose-400" role="alert">
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

  const strategyToggleSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4 flex flex-wrap items-center justify-end gap-2">
      <span className="text-xs uppercase tracking-wider opacity-70">
        Strategy View
      </span>
      <div className="inline-flex rounded-2xl bg-neutral-900/70 border border-neutral-800 p-1">
        {(["baseline", "ai", "both"] as StrategyView[]).map((key) => {
          const label =
            key === "baseline" ? "Baseline" : key === "ai" ? "AI" : "Both";
          const disabled = !hasStrategyPair && key !== "ai";
          const isActive = strategyView === key || (!hasStrategyPair && key === "ai");
          return (
            <button
              key={key}
              type="button"
              className={`px-3 py-1 text-xs rounded-xl transition ${
                isActive
                  ? "bg-emerald-500 text-neutral-900 font-semibold"
                  : "text-neutral-300"
              } ${
                disabled ? "opacity-40 cursor-not-allowed" : "hover:text-white"
              }`}
              onClick={() => {
                if (disabled) return;
                setStrategyView(key);
              }}
              aria-pressed={isActive}
              disabled={disabled}
            >
              {label}
            </button>
          );
        })}
      </div>
    </section>
  );

  const mainChartsSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
      <ChartPanel
        className="xl:col-span-2"
        symbol={symbol}
        symbols={ALLOWED_SYMBOLS}
        onSymbolChange={setSymbol}
        interval={tf}
        timeframeOptions={TIMEFRAME_OPTIONS}
        onIntervalChange={(next) => setTf(next as Interval)}
        indicators={[
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
        ]}
        status={chartStatus}
        canFullscreen={true}
        onOpenFullscreen={() => setShowFullscreenChart(true)}
      >
        <TvCandles
          data={chartData}
          markers={showAiSignals ? tvAiMarkers : []}
          overlays={overlays}
          className="h-full"
        />
      </ChartPanel>

      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Win / Loss / Flat</h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={[
                  { name: "Win", value: metrics.win },
                  { name: "Loss", value: metrics.loss },
                  { name: "Flat", value: metrics.flat },
                ]}
                dataKey="value"
                nameKey="name"
                innerRadius={50}
                outerRadius={80}
              >
                <Cell />
                <Cell />
                <Cell />
              </Pie>
              <Legend />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
          <div className="bg-neutral-800/60 rounded-xl p-2">
            <div className="opacity-60">Win %</div>
            <div className="text-lg font-semibold">
              {metrics.winPct.toFixed(1)}%
            </div>
          </div>
          <div className="bg-neutral-800/60 rounded-xl p-2">
            <div className="opacity-60">Sharpe</div>
            <div className="text-lg font-semibold">
              {Number.isFinite(metrics.sharpe)
                ? metrics.sharpe.toFixed(2)
                : "∞"}
            </div>
          </div>
          <div className="bg-neutral-800/60 rounded-xl p-2">
            <div className="opacity-60">PF</div>
            <div className="text-lg font-semibold">
              {Number.isFinite(metrics.pf) ? metrics.pf.toFixed(2) : "∞"}
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const presetsSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4">
      <div className="p-4 rounded-2xl bg-neutral-900/80 border border-neutral-800 flex flex-col gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Save preset
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              className="flex-1 bg-neutral-950 border border-neutral-700 rounded-xl px-3 py-2"
              placeholder="Preset name"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              aria-label="Preset name"
            />
            <button
              onClick={savePreset}
              className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500"
            >
              Save Preset
            </button>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Presets
          </div>
          {presets.length === 0 ? (
            <div className="text-sm opacity-60">
              No presets yet. Create one above.
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {presets.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2 bg-neutral-800/70 border border-neutral-700 rounded-xl px-3 py-2"
                >
                  <div className="text-sm">
                    <div className="font-semibold">{p.name}</div>
                    <div className="opacity-70 text-xs">
                      {p.symbol} · {p.tf} · THR {p.thr} · TP {p.tp} · SL {p.sl}{" "}
                      {p.walkForward ? "· WF" : ""}
                    </div>
                  </div>
                  <button
                    className="text-xs px-2 py-1 rounded-lg bg-neutral-700 hover:bg-neutral-600"
                    onClick={() => loadPreset(p)}
                  >
                    Load
                  </button>
                  <button
                    className="text-xs px-2 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-500"
                    onClick={() => deletePreset(p.name)}
                  >
                    Delete
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );

  const analyticsSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Volume</h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <BarChart data={volumeData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12, fill: "#aaa" }}
                minTickGap={28}
              />
              <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
              />
              <Bar dataKey="volume" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Model Room — Feature Importance</h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <BarChart data={featureImportanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 11, fill: "#aaa" }}
                interval={0}
                angle={-25}
                textAnchor="end"
              />
              <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
              <Tooltip
                contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
              />
              <Bar dataKey="importance" />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {showDualView && hasStrategyPair ? (
            <>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">Baseline Metrics</div>
                <div className="text-base font-semibold">
                  Win {formatWinRate(baselineMetrics)}
                </div>
                <div className="text-[11px] opacity-70 mt-1">
                  PF {formatPf(baselineMetrics)} · Sharpe{" "}
                  {formatSharpe(baselineMetrics)}
                </div>
                <div className="text-[11px] opacity-70">
                  Max DD {formatMaxDd(baselineMetrics)}
                </div>
              </div>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">AI Metrics</div>
                <div className="text-base font-semibold">
                  Win {formatWinRate(aiMetricsSummary)}
                </div>
                <div className="text-[11px] opacity-70 mt-1">
                  PF {formatPf(aiMetricsSummary)} · Sharpe{" "}
                  {formatSharpe(aiMetricsSummary)}
                </div>
                <div className="text-[11px] opacity-70">
                  Max DD {formatMaxDd(aiMetricsSummary)}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">{metricsLabel} Win Rate</div>
                <div className="text-base font-semibold">{winRateDisplay}</div>
              </div>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">{metricsLabel} PF</div>
                <div className="text-base font-semibold">{pfDisplay}</div>
              </div>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">{metricsLabel} Sharpe</div>
                <div className="text-base font-semibold">{sharpeDisplay}</div>
              </div>
              <div className="bg-neutral-800/60 rounded-xl p-2">
                <div className="opacity-60 mb-1">{metricsLabel} Max DD</div>
                <div className="text-base font-semibold">{maxDdDisplay}</div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Model Room — Diagnostics</h3>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="opacity-70 mb-1">Confusion (1 vs not-1)</div>
            <div className="grid grid-cols-2 gap-1 text-center">
              <div className="bg-neutral-800/70 rounded p-1">
                <div className="opacity-60 text-[10px]">TP</div>
                <div className="font-semibold text-sm">{confusion.tp}</div>
              </div>
              <div className="bg-neutral-800/70 rounded p-1">
                <div className="opacity-60 text-[10px]">FP</div>
                <div className="font-semibold text-sm">{confusion.fp}</div>
              </div>
              <div className="bg-neutral-800/70 rounded p-1">
                <div className="opacity-60 text-[10px]">TN</div>
                <div className="font-semibold text-sm">{confusion.tn}</div>
              </div>
              <div className="bg-neutral-800/70 rounded p-1">
                <div className="opacity-60 text-[10px]">FN</div>
                <div className="font-semibold text-sm">{confusion.fn}</div>
              </div>
            </div>
          </div>
          <div>
            <div className="opacity-70 mb-1">{`Equity Curve (${equityChartLabel})`}</div>
            <div className="h-[120px]">
              <ResponsiveContainer>
                <LineChart data={equityChartData}>
                  <XAxis dataKey="ts" tick={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "#aaa" }} tickLine={false} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #333",
                    }}
                    labelFormatter={() => ""}
                  />
                  {showDualView && hasStrategyPair ? (
                    <>
                      <Line
                        type="monotone"
                        dataKey="equity"
                        data={baselineEquityCurve}
                        dot={false}
                        strokeWidth={2}
                        stroke="#f97316"
                        name="Baseline"
                      />
                      <Line
                        type="monotone"
                        dataKey="equity"
                        data={aiEquityCurveData}
                        dot={false}
                        strokeWidth={2}
                        stroke="#22c55e"
                        name="AI"
                      />
                    </>
                  ) : (
                    <Line
                      type="monotone"
                      dataKey="equity"
                      dot={false}
                      strokeWidth={2}
                      stroke={equityLineColor}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </section>
  );

  const playgroundSection = (
    <section className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Signal Density (demo)</h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <AreaChart
              data={chartData.map((d, i) => ({
                ...d,
                density: (Math.sin(i / 5) + 1) * 50,
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="time"
                tick={{ fontSize: 12, fill: "#aaa" }}
                minTickGap={28}
              />
              <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #333",
                }}
              />
              <Area
                type="monotone"
                dataKey="density"
                strokeOpacity={1}
                fillOpacity={0.2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
        <h3 className="font-semibold mb-2">Slippage Histogram (demo)</h3>
        <div className="h-[220px]">
          <ResponsiveContainer>
            <BarChart
              data={Array.from({ length: 20 }, (_, i) => ({
                bucket: i - 10,
                count: Math.floor(
                  50 * Math.exp(-((i - 10) * (i - 10)) / 50)
                ),
              }))}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
              <XAxis
                dataKey="bucket"
                tick={{ fontSize: 12, fill: "#aaa" }}
              />
              <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #333",
                }}
              />
              <Bar dataKey="count" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800 text-xs opacity-80">
        <h3 className="font-semibold mb-2">Notes</h3>
        <p>
          AI metrics and Model Room visuals update after you run the{" "}
          <span className="font-semibold">AI Backtest</span>.
        </p>
        <p className="mt-2">
          Signal markers appear on the main candle chart when{" "}
          <span className="font-semibold">Overlay AI signals</span> is enabled.
        </p>
      </div>
    </section>
  );

  const multiChartSection = (
    <section className="max-w-7xl mx-auto px-4 mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="text-lg font-semibold">Multi-Chart Grid</h3>
          <p className="text-sm text-slate-400">
            Compare two symbols or timeframes side-by-side with shared
            indicators.
          </p>
        </div>
        <div className="flex items-center gap-3">
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
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <ChartPanel
            symbol={multiASymbol}
            symbols={ALLOWED_SYMBOLS}
            onSymbolChange={setMultiASymbol}
            interval={multiATf}
            timeframeOptions={TIMEFRAME_OPTIONS}
            onIntervalChange={(next) => setMultiATf(next as Interval)}
            indicators={[
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
            ]}
            status={multiAChartStatus}
          >
            <TvCandles
              data={multiAChartData}
              markers={[]}
              overlays={multiAOverlays}
              className="h-full"
            />
          </ChartPanel>
          <ChartPanel
            symbol={multiBSymbol}
            symbols={ALLOWED_SYMBOLS}
            onSymbolChange={setMultiBSymbol}
            interval={multiBTf}
            timeframeOptions={TIMEFRAME_OPTIONS}
            onIntervalChange={(next) => setMultiBTf(next as Interval)}
            indicators={[
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
            ]}
            status={multiBChartStatus}
          >
            <TvCandles
              data={multiBChartData}
              markers={[]}
              overlays={multiBOverlays}
              className="h-full"
            />
          </ChartPanel>
        </div>
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
            Uses the current dashboard symbol and timeframe for playback.
          </p>
        </div>
        <SimulationDesk priceData={chartData} />
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
        <>
          {controlPanelSection}
          {strategyToggleSection}
          {mainChartsSection}
          {presetsSection}
          {analyticsSection}
          {playgroundSection}
        </>
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
