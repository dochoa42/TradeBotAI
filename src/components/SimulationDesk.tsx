import React, { useEffect, useMemo, useState } from "react";
import TvCandles, { type TvCandleData } from "./TvCandles";
import type { ChartPoint, EquityPoint, Trade } from "../types/trading";

const formatNumber = (value: number | null | undefined, digits = 2): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
  });
};

const formatTimestamp = (ts: number | null): string => {
  if (ts == null || !Number.isFinite(ts)) {
    return "-";
  }
  return new Date(ts).toLocaleString();
};

const resolveTimestamp = (point: ChartPoint | undefined): number | null => {
  if (!point) return null;
  if (typeof point.ts === "number" && Number.isFinite(point.ts)) {
    return point.ts;
  }
  if (typeof point.time === "number" && Number.isFinite(point.time)) {
    return point.time;
  }
  if (typeof point.time === "string") {
    const parsed = Date.parse(point.time);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (point.time instanceof Date) {
    return point.time.getTime();
  }
  return null;
};

type SimulationDeskProps = {
  candles: ChartPoint[];
  equityCurve: EquityPoint[];
  trades: Trade[];
};

export const SimulationDesk: React.FC<SimulationDeskProps> = ({
  candles,
  equityCurve,
  trades,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speedMs, setSpeedMs] = useState(250);

  const totalCandles = candles.length;
  const hasData = totalCandles > 0 && equityCurve.length > 0;
  const maxIndex = Math.max(totalCandles - 1, 0);

  useEffect(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, [candles, equityCurve, trades]);

  useEffect(() => {
    if (!isPlaying || totalCandles <= 1) return;
    const id = window.setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= totalCandles - 1) {
          setIsPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, speedMs);
    return () => window.clearInterval(id);
  }, [isPlaying, speedMs, totalCandles]);

  useEffect(() => {
    if (currentIndex > maxIndex) {
      setCurrentIndex(maxIndex);
    }
  }, [currentIndex, maxIndex]);

  const activeIndex = hasData ? Math.min(currentIndex, maxIndex) : 0;
  const currentCandle = hasData ? candles[activeIndex] : null;
  const currentTs = useMemo(() => {
    if (!hasData) return null;
    const ts = resolveTimestamp(currentCandle ?? undefined);
    if (ts != null) return ts;
    return equityCurve[Math.min(activeIndex, equityCurve.length - 1)]?.ts ?? null;
  }, [activeIndex, currentCandle, equityCurve, hasData]);

  const currentEquityPoint = useMemo(() => {
    if (!equityCurve.length) return null;
    if (currentTs == null) {
      return equityCurve[equityCurve.length - 1];
    }
    let latest = equityCurve[0];
    for (const point of equityCurve) {
      if (point.ts <= currentTs) {
        latest = point;
      } else {
        break;
      }
    }
    return latest;
  }, [equityCurve, currentTs]);

  const currentEquity =
    currentEquityPoint?.equity ?? equityCurve[equityCurve.length - 1]?.equity ?? 0;

  const openTrades = useMemo(() => {
    if (!trades.length || currentTs == null) return [];
    return trades
      .filter(
        (trade) =>
          trade.entry_ts <= currentTs &&
          (trade.exit_ts == null || trade.exit_ts > currentTs)
      )
      .sort((a, b) => a.entry_ts - b.entry_ts);
  }, [trades, currentTs]);

  const realizedPnl = useMemo(() => {
    if (!trades.length || currentTs == null) return 0;
    return trades
      .filter((trade) => trade.exit_ts != null && trade.exit_ts <= currentTs)
      .reduce((sum, trade) => sum + trade.pnl, 0);
  }, [trades, currentTs]);

  const candleWindow = useMemo<TvCandleData[]>(() => {
    if (!hasData) return [];
    const end = activeIndex + 1;
    const start = Math.max(0, end - 300);
    return candles.slice(start, end) as TvCandleData[];
  }, [activeIndex, candles, hasData]);

  const progressPct = hasData
    ? totalCandles > 1
      ? Math.round((activeIndex / (totalCandles - 1)) * 100)
      : 100
    : 0;

  const handleScrub = (value: number) => {
    setIsPlaying(false);
    setCurrentIndex(value);
  };

  const handleStepBack = () => setCurrentIndex((prev) => Math.max(0, prev - 1));
  const handleStepForward = () => setCurrentIndex((prev) => Math.min(maxIndex, prev + 1));

  if (!hasData) {
    return (
      <div className="text-sm text-slate-400 border border-dashed border-neutral-700 rounded-2xl p-6 text-center">
        Provide candles, equity, and trades from a recent backtest to play the simulation.
      </div>
    );
  }

  const currentPrice = currentCandle?.close ?? null;
  const currentTimeLabel = formatTimestamp(currentTs);
  const activeTradesCount = openTrades.length;
  const totalTrades = trades.length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold text-slate-100">Current Snapshot</h2>
          <dl className="text-sm text-slate-300 space-y-2">
            <div className="flex justify-between">
              <dt>Time</dt>
              <dd>{currentTimeLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Price</dt>
              <dd>{formatNumber(currentPrice)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Equity</dt>
              <dd>{formatNumber(currentEquity)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Open Trades</dt>
              <dd>{activeTradesCount}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Realized P&amp;L</dt>
              <dd>{formatNumber(realizedPnl)}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Playback Controls</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleStepBack}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
              disabled={activeIndex === 0}
            >
              ⏮ Step
            </button>
            <button
              type="button"
              onClick={() => setIsPlaying((prev) => !prev)}
              className={`px-4 py-1 rounded-lg text-sm font-semibold ${
                isPlaying
                  ? "bg-amber-400 text-slate-900"
                  : "bg-emerald-500 text-slate-900"
              }`}
            >
              {isPlaying ? "⏸ Pause" : "▶ Play"}
            </button>
            <button
              type="button"
              onClick={handleStepForward}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
              disabled={activeIndex >= maxIndex}
            >
              ⏭ Step
            </button>
          </div>
          <div className="text-sm text-slate-300">
            <div className="flex justify-between mb-1">
              <span>Timeline</span>
              <span>
                {activeIndex + 1} / {totalCandles}
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={maxIndex}
              value={activeIndex}
              onChange={(e) => handleScrub(Number(e.target.value))}
              className="w-full"
            />
          </div>
          <div className="text-sm text-slate-300">
            <div className="flex justify-between mb-1">
              <span>Speed</span>
              <span>{speedMs} ms / candle</span>
            </div>
            <input
              type="range"
              min={80}
              max={600}
              step={20}
              value={speedMs}
              onChange={(e) => setSpeedMs(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>

        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 space-y-3">
          <h2 className="text-lg font-semibold text-slate-100">Playback Stats</h2>
          <dl className="text-sm text-slate-300 space-y-2">
            <div className="flex justify-between">
              <dt>Progress</dt>
              <dd>{progressPct}%</dd>
            </div>
            <div className="flex justify-between">
              <dt>Total Trades</dt>
              <dd>{totalTrades}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Equity Point</dt>
              <dd>{formatTimestamp(currentEquityPoint?.ts ?? null)}</dd>
            </div>
          </dl>
          <div className="mt-2 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">Candle Playback</h2>
        {candleWindow.length === 0 ? (
          <p className="text-sm text-slate-400">
            Candles will appear here once playback begins.
          </p>
        ) : (
          <div className="mt-2 h-64">
            <TvCandles data={candleWindow} />
          </div>
        )}
      </div>

      <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-100">Open Trades</h2>
          <span className="text-sm text-slate-400">{activeTradesCount} active</span>
        </div>
        {openTrades.length === 0 ? (
          <p className="text-sm text-slate-400">No open trades at this point in the playback.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm text-slate-200">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-2 pr-4">Symbol</th>
                  <th className="py-2 pr-4">Side</th>
                  <th className="py-2 pr-4">Entry Time</th>
                  <th className="py-2 pr-4">Entry Price</th>
                  <th className="py-2 pr-4">Qty</th>
                </tr>
              </thead>
              <tbody>
                {openTrades.map((trade) => (
                  <tr key={trade.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4">{trade.symbol}</td>
                    <td className="py-2 pr-4 capitalize">
                      <span
                        className={
                          trade.side === "long"
                            ? "text-emerald-400"
                            : "text-rose-400"
                        }
                      >
                        {trade.side}
                      </span>
                    </td>
                    <td className="py-2 pr-4">{formatTimestamp(trade.entry_ts)}</td>
                    <td className="py-2 pr-4">{formatNumber(trade.entry_price)}</td>
                    <td className="py-2 pr-4">{formatNumber(trade.qty, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
