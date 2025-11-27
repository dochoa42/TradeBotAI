import React, { useEffect, useMemo, useState } from "react";
import type { StrategyComparisonRow } from "../types/trading";
import { fetchStrategyComparison } from "../api/liveTrading";

export type StrategyComparisonCardProps = {
  symbol?: string;
  symbols?: readonly string[];
  className?: string;
  onSymbolChange?: (symbol: string) => void;
};

const StrategyComparisonCard: React.FC<StrategyComparisonCardProps> = ({
  symbol,
  symbols = [],
  className = "",
  onSymbolChange,
}) => {
  const fallbackSymbol = symbols[0] ?? "BTCUSDT";
  const [selectedSymbol, setSelectedSymbol] = useState<string>(
    symbol ?? fallbackSymbol
  );
  const [strategyFilter, setStrategyFilter] = useState<string>("ALL");
  const [rows, setRows] = useState<StrategyComparisonRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (symbol && symbol !== selectedSymbol) {
      setSelectedSymbol(symbol);
    }
  }, [symbol, selectedSymbol]);

  useEffect(() => {
    if (!symbol && symbols.length && !symbols.includes(selectedSymbol)) {
      setSelectedSymbol(symbols[0]);
    }
  }, [symbol, symbols, selectedSymbol]);

  useEffect(() => {
    setStrategyFilter("ALL");
  }, [selectedSymbol]);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchStrategyComparison({ symbol: selectedSymbol });
        if (!isMounted) return;
        setRows(data);
      } catch (err) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : "Failed to load";
        setError(message);
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      isMounted = false;
    };
  }, [selectedSymbol]);

  const strategyOptions = useMemo(() => {
    const entries = new Set(rows.map((row) => row.strategy));
    return ["ALL", ...Array.from(entries).sort()];
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (strategyFilter === "ALL") return rows;
    return rows.filter((row) => row.strategy === strategyFilter);
  }, [rows, strategyFilter]);

  const handleSymbolChange = (value: string) => {
    setSelectedSymbol(value);
    onSymbolChange?.(value);
  };

  const handleStrategyChange = (value: string) => {
    setStrategyFilter(value);
  };

  const formatCurrency = (value?: number | null) => {
    if (value == null || Number.isNaN(value)) return "--";
    const formatted = value.toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    const prefix = value > 0 ? "+" : value < 0 ? "-" : "";
    return `${prefix}$${formatted}`;
  };

  const formatPercent = (value?: number | null) => {
    if (value == null || Number.isNaN(value)) return "--";
    return `${(value * 100).toFixed(1)}%`;
  };

  return (
    <section
      className={`rounded-3xl border border-slate-800 bg-slate-950/70 p-5 space-y-4 ${className}`.trim()}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">
            Backtest vs Live (strategy)
          </p>
          <p className="text-sm text-slate-400 mt-1">
            Compare the last saved backtest to current paper performance.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <select
            aria-label="Select symbol"
            value={selectedSymbol}
            onChange={(event) => handleSymbolChange(event.target.value)}
            className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
          >
            {(symbols.length ? symbols : [selectedSymbol || fallbackSymbol]).map((sym) => (
              <option key={sym} value={sym}>
                {sym}
              </option>
            ))}
          </select>
          <select
            aria-label="Filter by strategy"
            value={strategyFilter}
            onChange={(event) => handleStrategyChange(event.target.value)}
            disabled={!rows.length}
            className="rounded-2xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
          >
            {strategyOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-2xl border border-slate-800/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/80 text-xs uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-4 py-3 text-left">Strategy</th>
              <th className="px-4 py-3 text-right">Backtest P&L</th>
              <th className="px-4 py-3 text-right">Backtest Win %</th>
              <th className="px-4 py-3 text-right">Live Net P&L</th>
              <th className="px-4 py-3 text-right">Live Win %</th>
              <th className="px-4 py-3 text-right">Δ Win %</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  Loading strategy comparison…
                </td>
              </tr>
            ) : filteredRows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No strategy snapshots yet. Run a backtest and paper trades to populate this card.
                </td>
              </tr>
            ) : (
              filteredRows.map((row) => {
                const backtestWin = row.backtest?.win_rate ?? null;
                const liveWin = row.live?.win_rate ?? null;
                const delta =
                  backtestWin != null && liveWin != null
                    ? (liveWin - backtestWin) * 100
                    : null;
                const deltaLabel =
                  delta == null
                    ? "--"
                    : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)} pts`;
                const deltaClass =
                  delta == null
                    ? "text-slate-400"
                    : delta >= 0
                    ? "text-emerald-300"
                    : "text-rose-300";

                return (
                  <tr
                    key={`${row.symbol}-${row.strategy}`}
                    className="border-t border-slate-800/60"
                  >
                    <td className="px-4 py-3 text-slate-200">
                      <div className="font-semibold text-slate-100">{row.strategy}</div>
                      <div className="text-xs text-slate-500">{row.symbol}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatCurrency(row.backtest?.pnl ?? null)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatPercent(backtestWin)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatCurrency(row.live?.net_pnl ?? null)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-100">
                      {formatPercent(liveWin)}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${deltaClass}`}>
                      {deltaLabel}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default StrategyComparisonCard;
