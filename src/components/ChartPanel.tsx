import React from "react";

export type IndicatorToggle = {
  key: string;
  label: string;
  active: boolean;
  onToggle: () => void;
};

export type ChartPanelStatus = {
  lastPrice?: number | null;
  changePct?: number | null;
  bars?: number;
  interval?: string;
  isLoading?: boolean;
  error?: string | null;
};

type ChartPanelProps = {
  symbol: string;
  symbols: readonly string[];
  onSymbolChange: (value: string) => void;
  interval: string;
  timeframeOptions: readonly string[];
  onIntervalChange: (value: string) => void;
  indicators?: IndicatorToggle[];
  status?: ChartPanelStatus;
  children: React.ReactNode;
  className?: string;
};

const baseCardClass =
  "rounded-2xl border border-slate-800 bg-slate-950/80 shadow-xl p-3 flex flex-col gap-3";

const toolbarButtonClasses =
  "px-3 py-1.5 rounded-xl text-xs font-semibold transition border border-slate-800 hover:border-slate-600";

const indicatorButtonClasses =
  "px-2.5 py-1 rounded-lg text-xs font-semibold transition border border-slate-800 hover:border-slate-600";

const ChartPanel: React.FC<ChartPanelProps> = ({
  symbol,
  symbols,
  onSymbolChange,
  interval,
  timeframeOptions,
  onIntervalChange,
  indicators = [],
  status,
  children,
  className,
}) => {
  const mergedClassName = className
    ? `${baseCardClass} ${className}`
    : baseCardClass;

  const lastPriceDisplay =
    status?.lastPrice != null ? status.lastPrice.toFixed(2) : "--";
  const changeDisplay =
    status?.changePct != null
      ? `${status.changePct >= 0 ? "+" : ""}${status.changePct.toFixed(2)}%`
      : "--";
  const changeClass =
    status?.changePct != null
      ? status.changePct >= 0
        ? "text-emerald-300"
        : "text-rose-300"
      : "text-rose-300";

  return (
    <div className={mergedClassName}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm">
          <label htmlFor="chart-symbol" className="text-xs uppercase tracking-wider text-slate-400">
            Symbol
          </label>
          <select
            id="chart-symbol"
            value={symbol}
            onChange={(e) => onSymbolChange(e.target.value)}
            className="bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
          >
            {symbols.map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {timeframeOptions.map((tf) => (
            <button
              key={tf}
              type="button"
              onClick={() => onIntervalChange(tf)}
              className={`${toolbarButtonClasses} ${
                interval === tf
                  ? "bg-indigo-600/20 text-indigo-200 border-indigo-500"
                  : "text-slate-300"
              }`}
              aria-pressed={interval === tf}
            >
              {tf}
            </button>
          ))}
          {indicators.length > 0 && (
            <div className="ml-2 flex flex-wrap items-center gap-2">
              {indicators.map((indicator) => (
                <button
                  key={indicator.key}
                  type="button"
                  onClick={indicator.onToggle}
                  className={`${indicatorButtonClasses} ${
                    indicator.active
                      ? "bg-emerald-500/20 text-emerald-200 border-emerald-500"
                      : "text-slate-300"
                  }`}
                  aria-pressed={indicator.active}
                >
                  {indicator.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="text-xs text-slate-400 flex flex-wrap items-center gap-4 border border-slate-900 rounded-xl px-3 py-2 bg-slate-950/60">
        <span className="font-semibold text-slate-200">
          {symbol} · {interval}
        </span>
        <span>
          Last Price: <span className="text-slate-100">{lastPriceDisplay}</span>
        </span>
        <span>
          Change: <span className={changeClass}>{changeDisplay}</span>
        </span>
        <span>{status?.bars ?? 0} bars</span>
        <span>
          {status?.isLoading
            ? "Loading…"
            : status?.error
            ? `Error: ${status.error}`
            : "Live"}
        </span>
      </div>

      <div className="flex-1 min-h-[360px] rounded-2xl bg-slate-950/60 border border-slate-900">
        {children}
      </div>
    </div>
  );
};

export default ChartPanel;
