import React, { useEffect, useState } from "react";
import CandlesWithMarkers, {
  type Candle,
  type TradeMarker,
} from "./CandlesWithMarkers";
import type { Interval, PaperTradeRecord, DataProvider } from "../types/trading";
import {
  fetchPaperTrades,
  fetchSymbolCandles,
} from "../api/liveTrading";

const INTERVAL_OPTIONS: Interval[] = ["1m", "5m", "15m", "1h"];
const REFRESH_MS = 15000;

interface LiveCandlesPanelProps {
  symbol: string;
  strategy?: string;
  selectedTradeId?: number | string | null;
  onSelectTrade?: (tradeId: number | string) => void;
  provider: DataProvider;
}

const normalizeTradeSide = (side?: string | null): TradeMarker["side"] => {
  const value = side?.toLowerCase();
  if (value === "sell") return "sell";
  if (value === "long") return "long";
  if (value === "short") return "short";
  return "buy";
};

const buildTradeMarkers = (trades: PaperTradeRecord[]): TradeMarker[] => {
  const markers: TradeMarker[] = [];
  trades.forEach((trade) => {
    const tradeId = trade.id;
    const entryTime = trade.entry_time ?? trade.entry_signal_time ?? trade.ts;
    const side = normalizeTradeSide(trade.side);
    const entryMarker: TradeMarker = {
      id: `${tradeId}-entry`,
      tradeId,
      time: entryTime ?? trade.ts,
      price: trade.entry_price,
      side,
      strategyName: trade.strategy_name,
      alphaScore: trade.alpha_score,
      pnl: trade.pnl,
      quantity: trade.quantity ?? trade.qty,
      entryPrice: trade.entry_price,
      exitPrice: trade.exit_price ?? null,
      type: "entry",
    };
    markers.push(entryMarker);

    if (trade.exit_time && trade.exit_price != null) {
      markers.push({
        ...entryMarker,
        id: `${tradeId}-exit`,
        time: trade.exit_time,
        price: trade.exit_price,
        type: "exit",
      });
    }
  });
  return markers;
};

const LiveCandlesPanel: React.FC<LiveCandlesPanelProps> = ({
  symbol,
  strategy,
  selectedTradeId,
  onSelectTrade,
  provider,
}) => {
  const [interval, setInterval] = useState<Interval>("1m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [markers, setMarkers] = useState<TradeMarker[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | number | null>(null);

  useEffect(() => {
    setSelectedMarkerId((prev) => {
      if (selectedTradeId == null) {
        return null;
      }
      const prevTradeId = prev ? String(prev).split("-")[0] : null;
      const nextDefaultId = `${selectedTradeId}-entry`;
      const markerIds = new Set(markers.map((m) => m.id));
      if (!markerIds.has(nextDefaultId)) {
        return null;
      }
      if (prevTradeId === String(selectedTradeId) && prev && markerIds.has(prev)) {
        return prev;
      }
      return nextDefaultId;
    });
  }, [selectedTradeId, markers]);

  useEffect(() => {
    let cancelled = false;
    let pending = false;

    async function loadAll() {
      if (pending) return;
      pending = true;
      setLoading(true);
      setError(null);
      try {
        const [candleRows, tradeRows] = await Promise.all([
          fetchSymbolCandles({ symbol, interval, limit: 300, provider }),
          fetchPaperTrades(200, 0, {
            symbol,
            strategy: strategy && strategy !== "ALL" ? strategy : undefined,
          }),
        ]);
        if (cancelled) return;
        setCandles(
          candleRows.map((row) => ({
            time: row.time,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
          }))
        );
        setMarkers(buildTradeMarkers(tradeRows));
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
        pending = false;
      }
    }

    loadAll();
    const id = window.setInterval(loadAll, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [symbol, strategy, interval, provider]);

  const handleMarkerClick = (marker: TradeMarker | null) => {
    if (!marker) return;
    setSelectedMarkerId(marker.id);
    onSelectTrade?.(marker.tradeId);
  };

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Live Price & Trades
          </p>
          <p className="text-sm text-slate-300">
            {symbol}
            {` · ${strategy ?? "All strategies"}`}
          </p>
        </div>
        <label className="text-xs font-semibold text-slate-400">
          Interval
          <select
            className="ml-2 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            value={interval}
            onChange={(e) => setInterval(e.target.value as Interval)}
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="relative">
        <CandlesWithMarkers
          candles={candles}
          markers={markers}
          height={360}
          selectedMarkerId={selectedMarkerId}
          onMarkerClick={handleMarkerClick}
        />
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/40 text-sm text-slate-300">
            Loading...
          </div>
        )}
      </div>
      {error && (
        <div className="mt-3 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}
    </div>
  );
};

export default LiveCandlesPanel;
