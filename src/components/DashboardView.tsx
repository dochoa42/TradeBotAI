import React, { useMemo } from "react";
import ChartPanel, {
  type IndicatorToggle,
  type ChartPanelStatus,
} from "./ChartPanel";
import TvCandles, {
  type TvCandlePoint,
  type TvMarkerData,
  type TvOverlayLine,
} from "./TvCandles";
import type { Interval, EquityPoint } from "../types/trading";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";

export type DashboardSummaryMetrics = {
  pnl?: number;
  winPct?: number;
  maxDrawdown?: number;
  sharpe?: number;
} | null;

type DashboardViewProps = {
  symbol: string;
  interval: Interval;
  symbols: readonly string[];
  timeframeOptions: readonly Interval[];
  onSymbolChange: (symbol: string) => void;
  onIntervalChange: (tf: Interval) => void;
  indicatorToggles: IndicatorToggle[];
  chartStatus: ChartPanelStatus;
  candles: TvCandlePoint[];
  overlays: TvOverlayLine[];
  markers?: TvMarkerData[];
  metrics: DashboardSummaryMetrics;
  equityCurve: EquityPoint[];
  showAiSignals: boolean;
  onToggleAiSignals: (checked: boolean) => void;
  isLoadingSignals: boolean;
  thr: number;
  tp: number;
  sl: number;
  onThrChange: (value: number) => void;
  onTpChange: (value: number) => void;
  onSlChange: (value: number) => void;
  walkForward: boolean;
  onToggleWalkForward: (checked: boolean) => void;
  onRunBacktest: () => void;
  onStartSimulation: () => void;
  onDownloadHistory: () => void | Promise<void>;
  isRunningBacktest: boolean;
  isDownloadingHistory: boolean;
  historyMessage: string | null;
  lastPrice: number | null;
  priceChangePct: number | null;
  onOpenFullscreen: () => void;
};

const DashboardView: React.FC<DashboardViewProps> = ({
  symbol,
  interval,
  symbols,
  timeframeOptions,
  onSymbolChange,
  onIntervalChange,
  indicatorToggles,
  chartStatus,
  candles,
  overlays,
  markers = [],
  metrics,
  equityCurve,
  showAiSignals,
  onToggleAiSignals,
  isLoadingSignals,
  thr,
  tp,
  sl,
  onThrChange,
  onTpChange,
  onSlChange,
  walkForward,
  onToggleWalkForward,
  onRunBacktest,
  onStartSimulation,
  onDownloadHistory,
  isRunningBacktest,
  isDownloadingHistory,
  historyMessage,
  lastPrice,
  priceChangePct,
  onOpenFullscreen,
}) => {
  const equityChartData = useMemo(
    () =>
      equityCurve.map((point) => ({
        time: new Date(point.ts).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        equity: point.equity,
      })),
    [equityCurve]
  );

  const formattedPrice =
    lastPrice != null
      ? lastPrice.toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : "--";
  const formattedChange =
    priceChangePct != null
      ? `${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(2)}%`
      : "--";
  const changeClass =
    priceChangePct == null
      ? "text-slate-400"
      : priceChangePct >= 0
      ? "text-emerald-300"
      : "text-rose-300";

  const formatMetric = (value?: number) => {
    if (value == null) return "--";
    return Number.isFinite(value) ? value.toFixed(2) : "--";
  };

  const formatPercent = (value?: number) => {
    if (value == null) return "--";
    return `${value.toFixed(1)}%`;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <section className="rounded-3xl border border-slate-800 bg-gradient-to-br from-slate-950 via-slate-950 to-slate-900/80 p-6 shadow-[0_20px_80px_rgba(15,23,42,0.55)]">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full border border-indigo-400 bg-indigo-600/20 text-indigo-100 text-lg font-semibold flex items-center justify-center">
              {symbol.slice(0, 3)}
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                Active symbol
              </p>
              <p className="text-2xl font-semibold text-slate-100">{symbol}</p>
              <p className="text-sm text-slate-400">Interval · {interval}</p>
            </div>
          </div>
          <div className="text-right space-y-3">
            <div className="text-xs uppercase tracking-[0.2em] text-slate-500">
              Last price
            </div>
            <div className="text-4xl font-bold text-slate-50">{formattedPrice}</div>
            <div className={`text-sm font-semibold ${changeClass}`}>{formattedChange}</div>
            <div className="flex flex-col sm:flex-row sm:justify-end gap-3 text-sm">
              <button
                type="button"
                onClick={onRunBacktest}
                disabled={isRunningBacktest}
                className="px-4 py-2 rounded-2xl bg-emerald-500 text-neutral-900 font-semibold hover:bg-emerald-400 disabled:opacity-60"
              >
                {isRunningBacktest ? "Running backtest…" : "Run Backtest"}
              </button>
              <button
                type="button"
                onClick={onStartSimulation}
                className="px-4 py-2 rounded-2xl border border-slate-700 text-slate-100 hover:border-slate-500"
              >
                Start Simulation
              </button>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wider text-slate-500">THR</span>
            <input
              type="number"
              value={thr}
              onChange={(e) => onThrChange(Number(e.target.value))}
              className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wider text-slate-500">TP (%)</span>
            <input
              type="number"
              value={tp}
              onChange={(e) => onTpChange(Number(e.target.value))}
              className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wider text-slate-500">SL (%)</span>
            <input
              type="number"
              value={sl}
              onChange={(e) => onSlChange(Number(e.target.value))}
              className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-300">
            <span className="text-xs uppercase tracking-wider text-slate-500">
              Walk-forward
            </span>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={walkForward}
                onChange={(e) => onToggleWalkForward(e.target.checked)}
                className="rounded"
              />
              <span>{walkForward ? "Enabled" : "Disabled"}</span>
            </div>
          </label>
        </div>

        <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between text-sm text-slate-200">
          <div className="flex flex-wrap items-center gap-4">
            <label className="inline-flex items-center gap-2">
              <input
                type="checkbox"
                checked={showAiSignals}
                onChange={(e) => onToggleAiSignals(e.target.checked)}
                className="rounded"
              />
              <span className="flex items-center gap-2">
                Overlay AI signals
                {isLoadingSignals && <span className="text-xs text-slate-400">Loading…</span>}
              </span>
            </label>
            <button
              type="button"
              onClick={onDownloadHistory}
              disabled={isDownloadingHistory}
              className="px-3 py-1.5 rounded-2xl border border-slate-700 bg-slate-900 hover:border-slate-500 disabled:opacity-60"
            >
              {isDownloadingHistory ? "Updating history…" : "Download history"}
            </button>
          </div>
          {historyMessage && (
            <span className="text-xs text-slate-400 truncate">
              {historyMessage}
            </span>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <ChartPanel
            symbol={symbol}
            symbols={symbols}
            onSymbolChange={onSymbolChange}
            interval={interval}
            timeframeOptions={timeframeOptions}
            onIntervalChange={(value) => onIntervalChange(value as Interval)}
            indicators={indicatorToggles}
            status={chartStatus}
            canFullscreen
            onOpenFullscreen={onOpenFullscreen}
          >
            <TvCandles data={candles} markers={markers} overlays={overlays} className="h-full" />
          </ChartPanel>
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500 mb-4">
            Summary
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-slate-400 text-xs">P&L</p>
              <p className="text-xl font-semibold text-slate-100">
                {metrics?.pnl != null ? metrics.pnl.toFixed(2) : "--"}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Win %</p>
              <p className="text-xl font-semibold text-slate-100">
                {formatPercent(metrics?.winPct)}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Max drawdown</p>
              <p className="text-xl font-semibold text-slate-100">
                {formatPercent(metrics?.maxDrawdown)}
              </p>
            </div>
            <div>
              <p className="text-slate-400 text-xs">Sharpe</p>
              <p className="text-xl font-semibold text-slate-100">
                {formatMetric(metrics?.sharpe)}
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-6 md:grid-cols-3">
        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5">
          <div className="text-xs uppercase tracking-[0.3em] text-slate-500 mb-4">
            Equity curve
          </div>
          <div className="h-48">
            {equityChartData.length ? (
              <ResponsiveContainer>
                <LineChart data={equityChartData} margin={{ top: 10, right: 10, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="time" tickLine={false} tick={{ fontSize: 10, fill: "#94a3b8" }} />
                  <YAxis hide domain={["auto", "auto"]} />
                  <Tooltip
                    contentStyle={{ background: "#020617", border: "1px solid #334155" }}
                    labelStyle={{ color: "#e2e8f0" }}
                  />
                  <Line type="monotone" dataKey="equity" stroke="#22c55e" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-slate-500 text-sm">
                Run a backtest to populate equity data.
              </div>
            )}
          </div>
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5 text-slate-400 text-sm flex items-center justify-center">
          Analytics card coming soon
        </div>
        <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-5 text-slate-400 text-sm flex items-center justify-center">
          Risk metrics coming soon
        </div>
      </section>
    </div>
  );
};

export default DashboardView;
