import React, { useEffect, useRef, useState } from "react";
import {
  ComposedChart,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

import { SimulationViewer } from "./SimulationViewer";
import CandlestickSeries from "./CandlestickSeries";

const API_BASE =
  (import.meta as any).env?.VITE_API_URL ??
  (import.meta as any).env?.VITE_API_BASE ??
  "http://127.0.0.1:8000";

// ---- types ----
type Trade = {
  pnl?: number;
  [key: string]: any;
};

type EquityPoint = {
  equity: number;
  [key: string]: any;
};

type BacktestResponse = {
  equity_curve?: EquityPoint[];
  equityCurve?: EquityPoint[];
  trades?: Trade[];
  [key: string]: any;
};

type SimulationState = {
  response: BacktestResponse;
  step: number;
  playing: boolean;
  speedMs: number;
};

type TradeMarker = {
  time: any;
  price: number;
  side: "long" | "short";
};

type SimulationDeskProps = {
  priceData: any[];
};

export const SimulationDesk: React.FC<SimulationDeskProps> = ({
  priceData,
}) => {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1m");
  const [startingBalance, setStartingBalance] = useState(10000);
  const [fee, setFee] = useState(0.0004);

  const [simState, setSimState] = useState<SimulationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showViewer, setShowViewer] = useState(false);
  const timerRef = useRef<number | null>(null);

  // ---- pull core pieces from the response ----
  const equityCurve: EquityPoint[] =
    simState?.response.equity_curve ||
    simState?.response.equityCurve ||
    [];

  const totalBars = equityCurve.length;
  const trades = simState?.response.trades || [];
  const maxStep = Math.max(totalBars - 1, 0);

  const currentPoint =
    simState && totalBars > 0
      ? equityCurve[Math.min(simState.step, maxStep)]
      : null;

  const progressedTrades =
    simState && trades.length > 0
      ? trades.filter((_, idx) => idx <= simState.step)
      : [];

  // ---- call the same /api/backtest as runAiBacktest does ----
  const fetchBacktest = async () => {
    setError(null);

    try {
      const body = {
        symbol,
        interval: timeframe,
        params: {
          thr: 5,    // lower threshold → more entries
          tp: 20,     // closer take profit
          sl: 15,     // closer stop
          walkForward: false,
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

      console.log(
        "Backtest trades sample:",
        data.trades?.[0],
        "count =",
        data.trades?.length
      );

      setSimState({
        response: data,
        step: 0,
        playing: false,
        speedMs: 120,
      });
    } catch (err: any) {
      console.error(err);
      setError(err?.message || "Backtest request failed");
    }
  };

  // ---- playback controls ----
  const play = () => {
    if (!simState || totalBars === 0) return;
    setSimState((s) => (s ? { ...s, playing: true } : s));
  };

  const pause = () => {
    setSimState((s) => (s ? { ...s, playing: false } : s));
  };

  const reset = () => {
    setSimState((s) =>
      s ? { ...s, step: 0, playing: false } : s
    );
  };

  const stepForward = () => {
    setSimState((s) => {
      if (!s) return s;
      const next = Math.min(s.step + 1, maxStep);
      return {
        ...s,
        step: next,
        playing: next >= maxStep ? false : s.playing,
      };
    });
  };

  const stepBack = () => {
    setSimState((s) => {
      if (!s) return s;
      const prev = Math.max(s.step - 1, 0);
      return { ...s, step: prev };
    });
  };

  const updateSpeed = (value: number) => {
    setSimState((s) => (s ? { ...s, speedMs: value } : s));
  };

  // ---- timer effect for auto-play ----
  useEffect(() => {
    if (!simState?.playing) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    timerRef.current = window.setInterval(() => {
      setSimState((s) => {
        if (!s) return s;
        const eq =
          s.response.equity_curve ||
          s.response.equityCurve ||
          [];
        const localMax = Math.max(eq.length - 1, 0);
        if (s.step >= localMax) {
          return { ...s, playing: false };
        }
        return { ...s, step: s.step + 1 };
      });
    }, simState.speedMs) as unknown as number;

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [simState?.playing, simState?.speedMs]);

  // ---- derived stats + chart data ----
  const visibleBars =
    simState && totalBars > 0
      ? Math.min(simState.step + 1, totalBars)
      : 0;

  const baseEquity =
    equityCurve.length > 0 && equityCurve[0].equity !== 0
      ? equityCurve[0].equity
      : 1;

  const priceSeriesStart =
    totalBars > 0 ? Math.max(priceData.length - totalBars, 0) : 0;
  const simPriceSeries =
    totalBars > 0
      ? priceData.slice(priceSeriesStart, priceSeriesStart + totalBars)
      : [];
  const visiblePriceData =
    visibleBars > 0 ? simPriceSeries.slice(0, visibleBars) : [];
  const activePriceTime =
    visiblePriceData.length > 0
      ? visiblePriceData[visiblePriceData.length - 1].time
      : null;

  const currentEquity = currentPoint?.equity ?? startingBalance;

  const progressPct =
    totalBars > 0
      ? Math.round((100 * visibleBars) / totalBars)
      : 0;

  const currentTradesCount = progressedTrades.length;

  // ---- trade markers from REAL equity changes only ----
  const tradeMarkers: TradeMarker[] = [];
  if (priceData.length && equityCurve.length > 1) {
    const totalBars = equityCurve.length;
    const candlesCount = priceData.length;

    // equity index of the first candle in priceData
    const offset = Math.max(totalBars - candlesCount, 0);

    // how far the playback has progressed in equity indices
    const lastEquityIdx =
      simState && typeof simState.step === "number"
        ? Math.min(simState.step, totalBars - 1)
        : totalBars - 1;

    // start from the first index that actually maps into priceData
    const startIdx = Math.max(offset + 1, 1);

    for (let i = startIdx; i <= lastEquityIdx; i++) {
      const prev = equityCurve[i - 1].equity;
      const curr = equityCurve[i].equity;

      // if no equity change, no realized trade on this bar
      if (Math.abs(curr - prev) < 1e-9) continue;

      // map equity index i to candle index in priceData
      const barIdx = i - offset;
      if (barIdx < 0 || barIdx >= candlesCount) continue;

      const bar = priceData[barIdx];
      if (!bar) continue;

      const close = bar.close ?? bar.price ?? 0;
      const side: "long" | "short" = curr >= prev ? "long" : "short";

      tradeMarkers.push({
        time: bar.time,
        price: close,
        side,
      });
    }
  }


  // ---- render ----
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Top controls */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Config card */}
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Simulation Config
          </h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Symbol</span>
              <input
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100"
                value={symbol}
                onChange={(e) =>
                  setSymbol(e.target.value.toUpperCase())
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Timeframe</span>
              <select
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100"
                value={timeframe}
                onChange={(e) => setTimeframe(e.target.value)}
              >
                <option value="1m">1m</option>
                <option value="5m">5m</option>
                <option value="15m">15m</option>
                <option value="1h">1h</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Starting Balance</span>
              <input
                type="number"
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100"
                value={startingBalance}
                onChange={(e) =>
                  setStartingBalance(
                    Number(e.target.value) || 0
                  )
                }
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-400">Fee (per side)</span>
              <input
                type="number"
                step={0.0001}
                className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1 text-slate-100"
                value={fee}
                onChange={(e) =>
                  setFee(Number(e.target.value) || 0)
                }
              />
            </label>
          </div>
          <button
            onClick={fetchBacktest}
            className="mt-2 w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 font-semibold rounded-xl py-2 transition"
          >
            Run Backtest for Simulation
          </button>
          <button
            onClick={() => setShowViewer(true)}
            className="mt-2 w-full bg-slate-800 hover:bg-slate-700 text-slate-100 rounded-xl py-2 text-sm"
          >
            Open Candle Viewer
          </button>
          {error && (
            <p className="text-xs text-red-400 mt-1">
              {error}
            </p>
          )}
        </div>

        {/* Playback controls */}
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Playback Controls
          </h2>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={stepBack}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            >
              ⏮ Step -
            </button>
            {simState?.playing ? (
              <button
                onClick={pause}
                className="px-4 py-1 rounded-lg bg-amber-400 text-slate-900 font-semibold text-sm"
              >
                ⏸ Pause
              </button>
            ) : (
              <button
                onClick={play}
                className="px-4 py-1 rounded-lg bg-emerald-500 text-slate-900 font-semibold text-sm"
              >
                ▶ Play
              </button>
            )}
            <button
              onClick={stepForward}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            >
              ⏭ Step +
            </button>
            <button
              onClick={reset}
              className="px-3 py-1 rounded-lg bg-slate-800 border border-slate-700 text-slate-100 text-sm"
            >
              🔁 Reset
            </button>
          </div>
          <div className="mt-2 text-sm text-slate-300">
            <div className="flex justify-between items-center mb-1">
              <span>Speed</span>
              <span>{simState?.speedMs ?? 120} ms / bar</span>
            </div>
            <input
              type="range"
              min={40}
              max={600}
              step={20}
              value={simState?.speedMs ?? 120}
              onChange={(e) =>
                updateSpeed(Number(e.target.value))
              }
              className="w-full"
            />
          </div>
        </div>

        {/* Status card */}
        <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-lg font-semibold text-slate-100">
            Simulation Status
          </h2>
          <div className="space-y-1 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Bars Simulated</span>
              <span>
                {simState ? `${visibleBars} / ${totalBars}` : "-"}
              </span>
            </div>
            <div className="flex justify-between">
              <span>Progress</span>
              <span>{simState ? `${progressPct}%` : "-"}</span>
            </div>
            <div className="flex justify-between">
              <span>Trades Triggered</span>
              <span>{simState ? currentTradesCount : "-"}</span>
            </div>
            <div className="flex justify-between">
              <span>Current Equity</span>
              <span>
                {currentEquity.toLocaleString(undefined, {
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          </div>
          <div className="mt-2 h-1 w-full bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Equity curve chart */}
      <div className="bg-slate-900/80 border border-slate-700 rounded-2xl p-4">
        <h2 className="text-lg font-semibold text-slate-100 mb-2">
          Equity Curve Playback
        </h2>

        {visiblePriceData.length === 0 ? (
          <p className="text-sm text-slate-400">
            Run a backtest to see the equity curve animation.
          </p>
        ) : (
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={visiblePriceData}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 10, fill: "#aaa" }}
                  minTickGap={24}
                  xAxisId="sim-x"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#aaa" }}
                  domain={["auto", "auto"]}
                  yAxisId="sim-y"
                />
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "1px solid #333",
                  }}
                />
                <CandlestickSeries
                  data={visiblePriceData}
                  xAxisId="sim-x"
                  yAxisId="sim-y"
                  xKey="time"
                  openKey="open"
                  highKey="high"
                  lowKey="low"
                  closeKey="close"
                />
                {activePriceTime && (
                  <ReferenceLine
                    x={activePriceTime}
                    stroke="#38bdf8"
                    strokeWidth={2}
                    xAxisId="sim-x"
                    yAxisId="sim-y"
                  />
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Candle playback overlay */}
      {showViewer && (
        <SimulationViewer
          data={priceData}
          step={simState?.step ?? 0}
          markers={tradeMarkers}
          onClose={() => setShowViewer(false)}
        />
      )}
    </div>
  );
};
