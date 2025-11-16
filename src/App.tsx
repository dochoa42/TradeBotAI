import React, { useEffect, useMemo, useState } from "react";
import { SimulationDesk } from "./components/SimulationDesk";
import CandlestickSeries from "./components/CandlestickSeries";
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
  ComposedChart,
  Scatter,
} from "recharts";

// =============================================
// Types & Constants
// =============================================
type Interval = "1m" | "5m" | "1h" | "1d";

type Candle = {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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

// =============================================
// UI
// =============================================
export default function App() {
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
  const [showBB, setShowBB] = useState<boolean>(true);
  const smaPeriod = 20;
  const bbStd = 2;

  // Presets
  const [presets, setPresets] = useState<Preset[]>(() => loadPresets());
  const [newPresetName, setNewPresetName] = useState<string>("");

  // AI / backtest state
  type StrategyView = "baseline" | "ai" | "both";
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
  
    useEffect(() => {
      if (showAiSignals) {
        void loadAiSignals();
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [symbol, tf, showAiSignals]);

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
        `History updated: ${data.symbol} ${data.interval} · ${data.rows} rows → ${data.path}`,
      );

      try {
        setLoadingCandles(true);
        setCandlesError(null);
        const refreshed = await fetchCandlesFromBackend(symbol, tf, 500);
        setCandles(refreshed);
      } catch (refreshErr: any) {
        console.error("Failed to reload candles after history download:", refreshErr);
        setCandlesError(
          refreshErr?.message ||
            "History downloaded, but failed to reload candles automatically.",
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
  const chartData = useMemo(() => {
    if (!candles?.length) return [] as any[];
    const close = candles.map((c) => c.close);
    const sm = sma(close, smaPeriod);
    const sd = stddev(close, smaPeriod, sm);
    const upper = sd.map((v, i) =>
      isFinite(v) ? sm[i] + bbStd * v : NaN
    );
    const lower = sd.map((v, i) =>
      isFinite(v) ? sm[i] - bbStd * v : NaN
    );

    return candles.map((c, i) => ({
      ts: c.ts,
      time: fmtTime(c.ts),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      sma: sm[i],
      bbU: upper[i],
      bbL: lower[i],
    }));
  }, [candles]);

  const aiSignalMarkers = useMemo(() => {
    if (!showAiSignals || !aiSignals.length || !candles.length) return [];

    const byTs = new Map(aiSignals.map((s) => [s.ts, s.signal]));

    return candles
      .map((c) => {
        const sig = byTs.get(c.ts);
        if (!sig || sig === "flat") return null;
        return {
          ts: c.ts,
          close: c.close,
          signal: sig,
        };
      })
      .filter(Boolean) as { ts: number; close: number; signal: "long" | "short" }[];
  }, [showAiSignals, aiSignals, candles]);

  const metrics = useMemo(() => basicMetrics(candles), [candles]);

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
  const strategyOptions: { key: StrategyView; label: string }[] = [
    { key: "baseline", label: "Baseline" },
    { key: "ai", label: "AI" },
    { key: "both", label: "Both" },
  ];

  return (
    <div className="min-h-screen w-full bg-neutral-950 text-neutral-100">
      {/* Header */}
      <header className="border-b border-neutral-800 sticky top-0 z-10 backdrop-blur bg-neutral-950/70">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight">
            Trading Bot 2 —{" "}
            <span className="text-indigo-400">
              ML + Backtesting Console
            </span>
          </h1>
          <div className="text-sm opacity-70">
            Binance candles · React + Vite + TS + Tailwind + Recharts
          </div>
        </div>
      </header>

      {/* Controls */}
      <section className="max-w-7xl mx-auto px-4 pt-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          {/* Accessible label for select */}
          <label
            htmlFor="symbolSelect"
            className="text-xs uppercase tracking-wider opacity-70 mb-2 block"
          >
            Symbol
          </label>
          <select
            id="symbolSelect"
            aria-label="Symbol"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2 focus:outline-none"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value)}
          >
            {ALLOWED_SYMBOLS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Timeframe
          </div>
          <div className="grid grid-cols-4 gap-2">
            {(["1m", "5m", "1h", "1d"] as Interval[]).map((t) => (
              <button
                key={t}
                onClick={() => setTf(t)}
                className={`px-3 py-2 rounded-xl border ${
                  tf === t
                    ? "bg-indigo-600 border-indigo-500"
                    : "bg-neutral-900 border-neutral-700 hover:border-neutral-500"
                }`}
                aria-label={`Set timeframe ${t}`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Indicators
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showSMA}
                onChange={(e) => setShowSMA(e.target.checked)}
                aria-label="Toggle SMA(20)"
              />
              <span className="text-sm">SMA(20)</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={showBB}
                onChange={(e) => setShowBB(e.target.checked)}
                aria-label="Toggle Bollinger Bands"
              />
              <span className="text-sm">Bollinger ±2σ</span>
            </label>
          </div>
        </div>
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Params
          </div>
          <div className="grid grid-cols-3 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="opacity-70">THR</span>
              <input
                className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
                type="number"
                value={thr}
                onChange={(e) => setThr(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="opacity-70">TP (%)</span>
              <input
                className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
                type="number"
                value={tp}
                onChange={(e) => setTp(Number(e.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="opacity-70">SL (%)</span>
              <input
                className="bg-neutral-900 border border-neutral-700 rounded-xl px-2 py-1"
                type="number"
                value={sl}
                onChange={(e) => setSl(Number(e.target.value))}
              />
            </label>
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={walkForward}
              onChange={(e) => setWalkForward(e.target.checked)}
              aria-label="Enable walk-forward"
            />
            <span>Walk-forward</span>
          </label>
        </div>
      </section>

      {/* AI controls (button + toggle) */}
      <section className="max-w-7xl mx-auto px-4 mt-3">
        <div className="flex flex-wrap gap-3 items-center">
          <button
            onClick={runAiBacktest}
            disabled={isRunningBacktest}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-sm font-semibold"
          >
            {isRunningBacktest ? "Running AI Backtest..." : "Run AI Backtest"}
          </button>
          <label className="inline-flex items-center gap-2 text-xs text-slate-300">
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
                  <span className="text-[10px] opacity-70">
                    Loading AI signals…
                  </span>
                )}
              </span>
          </label>

          {apiError && (
            <span className="text-xs text-red-400" role="alert">
              {apiError}
            </span>
          )}
        </div>
      </section>

      {/* Presets */}
      <section className="max-w-7xl mx-auto px-4 mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Save preset
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 bg-neutral-900 border border-neutral-700 rounded-xl px-3 py-2"
              placeholder="Preset name"
              value={newPresetName}
              onChange={(e) => setNewPresetName(e.target.value)}
              aria-label="Preset name"
            />
            <button
              onClick={savePreset}
              className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500"
            >
              Save
            </button>
          </div>
        </div>
        <div className="p-3 rounded-2xl bg-neutral-900/70 border border-neutral-800 md:col-span-2">
          <div className="text-xs uppercase tracking-wider opacity-70 mb-2">
            Presets
          </div>
          {presets.length === 0 && (
            <div className="text-sm opacity-60">
              No presets yet. Create one above.
            </div>
          )}
        <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <div
                key={p.name}
                className="flex items-center gap-2 bg-neutral-800/70 border border-neutral-700 rounded-xl px-3 py-2"
              >
                <div className="text-sm">
                  <div className="font-semibold">{p.name}</div>
                  <div className="opacity-70 text-xs">
                    {p.symbol} · {p.tf} · THR {p.thr} · TP {p.tp} · SL{" "}
                    {p.sl} {p.walkForward ? "· WF" : ""}
                  </div>
                </div>
                <button
                  className="text-xs px-2 py-1 rounded-lg bg-neutral-700 hover:bg-neutral-600"
                  onClick={() => loadPreset(p)}
                >
                  Load
                </button>
                <button
                  className="text-xs px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-500"
                  onClick={() => deletePreset(p.name)}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </div>
        {/* Data / history controls */}
        <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-300">
          <button
            onClick={handleDownloadHistory}
            disabled={isDownloadingHistory}
            className="px-3 py-2 rounded-xl bg-neutral-900 border border-neutral-700 hover:border-neutral-500 disabled:opacity-50"
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
      </section>

      {/* Strategy view toggle */}
      <section className="max-w-7xl mx-auto px-4 mt-4 flex flex-wrap items-center justify-end gap-2">
        <span className="text-xs uppercase tracking-wider opacity-70">
          Strategy View
        </span>
        <div className="inline-flex rounded-2xl bg-neutral-900/70 border border-neutral-800 p-1">
          {strategyOptions.map(({ key, label }) => {
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
                } ${disabled ? "opacity-40 cursor-not-allowed" : "hover:text-white"}`}
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

      {/* Main Charts */}
      <section className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Candles + AI signals */}
        <div className="xl:col-span-2 p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold">
              {symbol} · {tf} Candles
            </h2>
            <div className="text-xs opacity-70">
              {loadingCandles ? (
                "Loading…"
              ) : candlesError ? (
                <span className="text-rose-400">{candlesError}</span>
              ) : (
                `${candles.length} bars`
              )}
            </div>
          </div>
          <div className="h-[360px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={chartData}
                margin={{ top: 10, right: 20, bottom: 0, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 12, fill: "#aaa" }}
                  minTickGap={28}
                  xAxisId="main-x"
                />
                <YAxis
                  tick={{ fontSize: 12, fill: "#aaa" }}
                  domain={["auto", "auto"]}
                  yAxisId="main-y"
                />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
                />
                <CandlestickSeries
                  data={chartData}
                  xAxisId="main-x"
                  yAxisId="main-y"
                  xKey="time"
                />
                {/* SMA */}
                {showSMA && (
                  <Line
                    type="monotone"
                    dataKey="sma"
                    dot={false}
                    strokeWidth={1}
                    xAxisId="main-x"
                    yAxisId="main-y"
                  />
                )}
                {/* Bollinger Bands */}
                {showBB && (
                  <Area
                    type="monotone"
                    dataKey="bbU"
                    strokeOpacity={0}
                    fillOpacity={0.1}
                    xAxisId="main-x"
                    yAxisId="main-y"
                  />
                )}
                {showBB && (
                  <Area
                    type="monotone"
                    dataKey="bbL"
                    strokeOpacity={0}
                    fillOpacity={0.1}
                    xAxisId="main-x"
                    yAxisId="main-y"
                  />
                )}

                {/* AI signal markers */}
                {aiSignalMarkers.length > 0 && (
                  <Scatter
                    data={aiSignalMarkers}
                    dataKey="close"
                    name="AI Signals"
                    xAxisId="main-x"
                    yAxisId="main-y"
                    shape={(props: any) => {
                      const s = (props.payload as any).signal as "long" | "short";
                      const isBuy = s === "long";
                      const color = isBuy ? "#22c55e" : "#ef4444";
                      return (
                        <path
                          d={isBuy ? "M0,-6 L6,6 L-6,6 Z" : "M0,6 L6,-6 L-6,-6 Z"}
                          transform={`translate(${props.cx},${props.cy})`}
                          fill={color}
                        />
                      );
                    }}
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Win/Loss donut (demo metrics) */}
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
                {Number.isFinite(metrics.sharpe) ? metrics.sharpe.toFixed(2) : "∞"}
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

      {/* Secondary Charts / Model Room */}
      <section className="max-w-7xl mx-auto px-4 mt-4 grid grid-cols-1 xl:grid-cols-3 gap-4">
        {/* Volume */}
        <div className="p-4 rounded-2xl bg-neutral-900/70 border border-neutral-800">
          <h3 className="font-semibold mb-2">Volume</h3>
          <div className="h-[220px]">
            <ResponsiveContainer>
              <BarChart data={volumeData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#aaa" }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
                />
                <Bar dataKey="volume" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model Room: feature importance */}
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
                    PF {formatPf(baselineMetrics)} · Sharpe {formatSharpe(baselineMetrics)}
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
                    PF {formatPf(aiMetricsSummary)} · Sharpe {formatSharpe(aiMetricsSummary)}
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

        {/* Model Room: confusion + equity curve mini summary */}
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
                      contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
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

      {/* Tertiary section: fun demo charts */}
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
                <XAxis dataKey="time" tick={{ fontSize: 12, fill: "#aaa" }} minTickGap={28} />
                <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
                />
                <Area type="monotone" dataKey="density" strokeOpacity={1} fillOpacity={0.2} />
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
                  count: Math.floor(50 * Math.exp(-((i - 10) * (i - 10)) / 50)),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2a2a" />
                <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: "#aaa" }} />
                <YAxis tick={{ fontSize: 12, fill: "#aaa" }} />
                <Tooltip
                  contentStyle={{ background: "#0a0a0a", border: "1px solid #333" }}
                />
                <Bar dataKey="count" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Spacer / notes card */}
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

      {/* Footer */}
      <footer className="max-w-7xl mx-auto px-4 py-8 opacity-60 text-xs">
        <div>
          Data source: Binance (via FastAPI backend). If backend is offline, a demo
          fallback renders.
        </div>
        <div className="mt-1">
          API = {API_BASE}
         <div className="mt-10 border-t border-slate-800 pt-6">
          <h2 className="text-xl font-semibold mb-4">
           Simulation Desk
          </h2>
          <SimulationDesk priceData={chartData} /> 
        </div>
       </div> 
      </footer>
    </div>
  );
}
