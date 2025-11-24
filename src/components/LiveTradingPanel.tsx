import React, { useEffect, useMemo, useState } from "react";
import {
  LiveStatus,
  PlacePaperOrderRequest,
  PaperTradeRecord,
  EquitySnapshot,
  PaperPerformanceSummary,
} from "../types/trading";
import {
  fetchPaperStatus,
  placePaperOrder,
  cancelPaperOrder,
  toggleKillSwitch,
  flattenPaperPosition,
  fetchPaperTrades,
  fetchEquityHistory,
  fetchPaperSummary,
} from "../api/liveTrading";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

const POLL_INTERVAL = 10000;

const formatNumber = (value: number | null | undefined, digits = 2): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return "-";
  }
  return (value ?? 0).toFixed(digits);
};

const formatPercent = (value: number | null | undefined, digits = 1): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return "-";
  }
  return `${((value ?? 0) * 100).toFixed(digits)}%`;
};

const formatPnlClass = (value: number | null | undefined): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return "text-slate-200";
  }
  if ((value ?? 0) > 0) return "text-emerald-400";
  if ((value ?? 0) < 0) return "text-rose-400";
  return "text-slate-200";
};

export const LiveTradingPanel: React.FC = () => {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [symbol, setSymbol] = useState("BTCUSDT");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState(0.01);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [price, setPrice] = useState<number | undefined>(undefined);
  const [strategyName, setStrategyName] = useState("");
  const [alphaScore, setAlphaScore] = useState<number | null>(null);
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);
  const [tradeHistory, setTradeHistory] = useState<PaperTradeRecord[]>([]);
  const [equityHistory, setEquityHistory] = useState<EquitySnapshot[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("ALL");
  const [selectedStrategy, setSelectedStrategy] = useState<string>("ALL");
  const [summary, setSummary] = useState<PaperPerformanceSummary | null>(null);

  const equityChartData = useMemo(
    () =>
      equityHistory
        .slice()
        .reverse()
        .map((pt) => ({
          ts: pt.ts,
          label: new Date(pt.ts).toLocaleTimeString(),
          equity: pt.equity,
        })),
    [equityHistory]
  );

  const symbolOptions = useMemo(() => {
    const universe = new Set<string>();
    status?.positions?.forEach((pos) => universe.add(pos.symbol));
    tradeHistory.forEach((trade) => universe.add(trade.symbol));
    if (selectedSymbol !== "ALL") {
      universe.add(selectedSymbol);
    }
    const sorted = Array.from(universe).sort();
    return ["ALL", ...sorted.filter((sym) => sym !== "ALL")];
  }, [status, tradeHistory, selectedSymbol]);

  const strategyOptions = useMemo(() => {
    const strategies = new Set<string>();
    tradeHistory.forEach((trade) => {
      if (trade.strategy_name) {
        strategies.add(trade.strategy_name);
      }
    });
    if (selectedStrategy !== "ALL") {
      strategies.add(selectedStrategy);
    }
    const sorted = Array.from(strategies).sort();
    return ["ALL", ...sorted];
  }, [tradeHistory, selectedStrategy]);

  const filteredTrades = useMemo(
    () =>
      tradeHistory.filter((trade) => {
        const matchesSymbol =
          selectedSymbol === "ALL" || trade.symbol === selectedSymbol;
        const matchesStrategy =
          selectedStrategy === "ALL" || trade.strategy_name === selectedStrategy;
        return matchesSymbol && matchesStrategy;
      }),
    [tradeHistory, selectedSymbol, selectedStrategy]
  );

  useEffect(() => {
    let active = true;

    async function loadAll() {
      try {
        const [statusData, tradesData, equityData] = await Promise.all([
          fetchPaperStatus(),
          fetchPaperTrades(50),
          fetchEquityHistory(100),
        ]);
        if (active) {
          setStatus(statusData);
          setTradeHistory(tradesData);
          setEquityHistory(equityData);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError((err as Error).message);
        }
      }
    }

    loadAll();
    const id = window.setInterval(loadAll, POLL_INTERVAL);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function loadSummary() {
      try {
        const data = await fetchPaperSummary({
          symbol: selectedSymbol === "ALL" ? undefined : selectedSymbol,
          strategy: selectedStrategy === "ALL" ? undefined : selectedStrategy,
        });
        if (active) {
          setSummary(data);
        }
      } catch (err) {
        if (active) {
          setSummary(null);
        }
      }
    }

    loadSummary();
    const id = window.setInterval(loadSummary, POLL_INTERVAL);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [selectedSymbol, selectedStrategy]);

  useEffect(() => {
    if (orderType === "market") {
      setPrice(undefined);
    }
  }, [orderType]);

  async function refreshHistory() {
    try {
      const [tradesData, equityData] = await Promise.all([
        fetchPaperTrades(50),
        fetchEquityHistory(100),
      ]);
      setTradeHistory(tradesData);
      setEquityHistory(equityData);
    } catch (err) {
      // Ignore history refresh errors for now; status polling will retry later.
    }
  }

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);

      const trimmedStrategy = strategyName.trim();
      const resolvedAlpha =
        typeof alphaScore === "number" && Number.isFinite(alphaScore)
          ? alphaScore
          : undefined;
      const body: PlacePaperOrderRequest = {
        symbol,
        side,
        qty,
        type: orderType,
        ...(orderType === "limit" && price ? { price } : {}),
        strategy_name: trimmedStrategy ? trimmedStrategy : undefined,
        alpha_score: resolvedAlpha,
        entry_signal_time: Math.floor(Date.now() / 1000),
      };

      const updated = await placePaperOrder(body);
      setStatus(updated);
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCancelOrder(orderId: string) {
    try {
      setLoading(true);
      const updated = await cancelPaperOrder(orderId);
      setStatus(updated);
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFlattenPosition(symbol: string, side: "long" | "short") {
    if (!status) return;
    const raw = window.prompt(
      `Exit price to flatten ${symbol} (${side})?`,
      status ? String(status.equity) : undefined
    );
    if (!raw) return;
    const exitPrice = Number(raw);
    if (!Number.isFinite(exitPrice) || exitPrice <= 0) {
      setError("Invalid exit price");
      return;
    }
    try {
      setLoading(true);
      const updated = await flattenPaperPosition(symbol, side, exitPrice);
      setStatus(updated);
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleKillSwitch() {
    if (!status) return;
    try {
      setKillSwitchBusy(true);
      const next = !status.kill_switch_tripped;
      const reason = next ? "manual toggle from UI" : undefined;
      await toggleKillSwitch(next, reason);
      const refreshed = await fetchPaperStatus();
      setStatus(refreshed);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setKillSwitchBusy(false);
    }
  }

  const netPnlDisplay = summary ? formatNumber(summary.net_pnl) : "-";
  const netPnlClass = summary ? formatPnlClass(summary.net_pnl) : "text-slate-200";
  const winRateDisplay = summary ? formatPercent(summary.win_rate) : "-";
  const winRateClass = summary
    ? summary.win_rate >= 0.5
      ? "text-emerald-400"
      : "text-rose-400"
    : "text-slate-200";
  const drawdownDisplay = summary ? formatNumber(summary.max_drawdown) : "-";
  const drawdownClass =
    summary && summary.max_drawdown > 0 ? "text-rose-400" : "text-slate-200";
  const totalTradesDisplay = summary ? summary.total_trades.toString() : "-";

  if (!status && !loading) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-sm text-slate-300">
        {error && <p className="text-rose-400 mb-2">{error}</p>}
        Loading live status...
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Phase 10.7 - Mode information banner */}
      <div className="rounded-md border border-amber-500/60 bg-amber-900/30 px-4 py-2 text-xs text-amber-100">
        <div className="flex items-center justify-between gap-2">
          <div className="font-semibold">Paper Mode Only</div>
          <div className="text-[11px] opacity-90">
            Live trading is currently <span className="font-semibold">disabled</span>.{" "}
            Orders placed from this panel run in the internal paper engine with Phase 10
            risk and kill-switch protection.
          </div>
        </div>
      </div>

      {error && (
        <div className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-xl p-3">
          {error}
        </div>
      )}

      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-slate-50">Live Trading (Paper Mode)</h2>
          <p className="text-sm text-slate-400">Monitoring the sandbox execution engine.</p>
        </div>
        {status && (
          <div className="flex flex-wrap gap-3 items-center">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700">
              Mode: {status.mode}
            </span>
            <span className="text-slate-100 text-sm">
              Equity: <span className="font-semibold">{formatNumber(status.equity)}</span>
            </span>
            <span className={`text-sm font-semibold ${formatPnlClass(status.daily_pnl)}`}>
              Daily PnL: {formatNumber(status.daily_pnl)}
            </span>
            {status.kill_switch_tripped ? (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-300 border border-rose-500/30">
                Kill Switch: {status.kill_switch_reason || "tripped"}
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
                Kill Switch OK
              </span>
            )}
            <button
              type="button"
              onClick={handleToggleKillSwitch}
              disabled={killSwitchBusy}
              className={`px-3 py-1 rounded-lg text-sm font-semibold border transition-colors ${
                killSwitchBusy
                  ? "bg-slate-800 text-slate-500 border-slate-700"
                  : "bg-amber-400 text-slate-900 border-amber-300 hover:bg-amber-300"
              }`}
            >
              {killSwitchBusy ? "Working..." : "Toggle Kill Switch"}
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Net PnL
          </p>
          <p className={`mt-2 text-2xl font-semibold ${netPnlClass}`}>{netPnlDisplay}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Win Rate
          </p>
          <p className={`mt-2 text-2xl font-semibold ${winRateClass}`}>{winRateDisplay}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Max Drawdown
          </p>
          <p className={`mt-2 text-2xl font-semibold ${drawdownClass}`}>{drawdownDisplay}</p>
        </div>
        <div className="rounded-2xl border border-slate-800 bg-slate-900/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Total Trades
          </p>
          <p className="mt-2 text-2xl font-semibold text-slate-100">{totalTradesDisplay}</p>
        </div>
      </div>

      {status && (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form
              onSubmit={handlePlaceOrder}
              className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-slate-100">Paper Order</h3>
                {loading && <span className="text-xs text-slate-400">Processing...</span>}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="flex flex-col text-sm text-slate-200">
                  Symbol
                  <input
                    type="text"
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col text-sm text-slate-200">
                  Side
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value as "buy" | "sell")}
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </label>
                <label className="flex flex-col text-sm text-slate-200">
                  Quantity
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={qty}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setQty(Number.isFinite(next) ? next : 0);
                    }}
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col text-sm text-slate-200">
                  Order Type
                  <select
                    value={orderType}
                    onChange={(e) => setOrderType(e.target.value as "market" | "limit")}
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  >
                    <option value="market">Market</option>
                    <option value="limit">Limit</option>
                  </select>
                </label>
                <label className="flex flex-col text-sm text-slate-200 md:col-span-2">
                  Limit Price
                  <input
                    type="number"
                    step="0.01"
                    value={orderType === "limit" ? price ?? "" : ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      setPrice(next === "" ? undefined : Number(next));
                    }}
                    disabled={orderType !== "limit"}
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none disabled:opacity-40"
                  />
                </label>
                <label className="flex flex-col text-sm text-slate-200">
                  Strategy
                  <input
                    type="text"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    placeholder="e.g. Mean Revert"
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
                <label className="flex flex-col text-sm text-slate-200">
                  Alpha Score
                  <input
                    type="number"
                    step="0.01"
                    value={alphaScore ?? ""}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next === "") {
                        setAlphaScore(null);
                        return;
                      }
                      const parsed = Number(next);
                      setAlphaScore(Number.isFinite(parsed) ? parsed : null);
                    }}
                    placeholder="0.00"
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={loading || status.kill_switch_tripped}
                className={`w-full rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                  loading || status.kill_switch_tripped
                    ? "bg-slate-800 text-slate-500"
                    : "bg-emerald-500 text-slate-900 hover:bg-emerald-400"
                }`}
              >
                Place Paper Order
              </button>
            </form>

            <div className="space-y-4">
              <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <h3 className="text-lg font-semibold text-slate-100">Risk / Limits</h3>
                <dl className="text-sm text-slate-300 space-y-2">
                  {status.daily_loss_limit != null && (
                    <div className="flex justify-between">
                      <dt>Daily Loss Limit</dt>
                      <dd>{formatNumber(status.daily_loss_limit)}</dd>
                    </div>
                  )}
                  {status.max_position_size != null && (
                    <div className="flex justify-between">
                      <dt>Max Position Size</dt>
                      <dd>{formatNumber(status.max_position_size, 4)}</dd>
                    </div>
                  )}
                  {status.max_open_positions != null && (
                    <div className="flex justify-between">
                      <dt>Max Open Positions</dt>
                      <dd>{status.max_open_positions}</dd>
                    </div>
                  )}
                </dl>
                <p className="text-xs text-slate-400">
                  Paper engine only – no real orders are sent.
                </p>
              </div>
              <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
                <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
                  Equity Curve (Paper)
                </div>
                {equityChartData.length === 0 ? (
                  <div className="text-xs text-slate-500">
                    No equity history yet. Place and flatten some paper trades to build an equity curve.
                  </div>
                ) : (
                  <div className="h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={equityChartData}>
                        <CartesianGrid strokeDasharray="3 3" opacity={0.1} />
                        <XAxis dataKey="label" hide />
                        <YAxis
                          domain={["auto", "auto"]}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                        />
                        <Tooltip
                          formatter={(value: any) => [`${value}`, "Equity"]}
                          labelFormatter={(label) => new Date(label).toLocaleString()}
                          contentStyle={{ fontSize: 11 }}
                        />
                        <Line
                          type="monotone"
                          dataKey="equity"
                          dot={false}
                          strokeWidth={1.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4 flex flex-wrap gap-4 items-end">
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span className="mb-1">Symbol Filter</span>
              <select
                value={selectedSymbol}
                onChange={(e) => setSelectedSymbol(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-normal text-slate-50"
              >
                {symbolOptions.map((sym) => (
                  <option key={sym} value={sym}>
                    {sym === "ALL" ? "All" : sym}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col text-xs font-semibold uppercase tracking-wide text-slate-400">
              <span className="mb-1">Strategy Filter</span>
              <select
                value={selectedStrategy}
                onChange={(e) => setSelectedStrategy(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm font-normal text-slate-50"
              >
                {strategyOptions.map((strategy) => (
                  <option key={strategy} value={strategy}>
                    {strategy === "ALL" ? "All" : strategy}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-xs text-slate-500">
              {summary
                ? `Matched ${summary.total_trades} trades`
                : "No matching trades yet"}
            </div>
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-100">Open Positions</h3>
              <span className="text-sm text-slate-400">{status.positions.length} active</span>
            </div>
            {status.positions.length === 0 ? (
              <p className="text-sm text-slate-400">No open positions.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-slate-200">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-2 pr-4">Symbol</th>
                      <th className="py-2 pr-4">Side</th>
                      <th className="py-2 pr-4">Size</th>
                      <th className="py-2 pr-4">Entry</th>
                      <th className="py-2 pr-4">Current</th>
                      <th className="py-2 pr-4">Unrealized PnL</th>
                      <th className="py-2 pr-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.positions.map((position) => (
                      <tr key={`${position.symbol}-${position.side}`} className="border-t border-slate-800">
                        <td className="py-2 pr-4">{position.symbol}</td>
                        <td className="py-2 pr-4 capitalize">
                          <span
                            className={
                              position.side === "long"
                                ? "text-emerald-400"
                                : "text-rose-400"
                            }
                          >
                            {position.side}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{formatNumber(position.size, 4)}</td>
                        <td className="py-2 pr-4">{formatNumber(position.entry_price)}</td>
                        <td className="py-2 pr-4">{formatNumber(position.current_price)}</td>
                        <td className={`py-2 pr-4 font-semibold ${formatPnlClass(position.unrealized_pnl)}`}>
                          {formatNumber(position.unrealized_pnl)}
                        </td>
                        <td className="py-2 pr-4 text-right">
                          <button
                            type="button"
                            className="rounded-md px-3 py-1 text-xs font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50"
                            onClick={() => handleFlattenPosition(position.symbol, position.side)}
                            disabled={loading || status.kill_switch_tripped}
                          >
                            Flatten
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-semibold text-slate-100">Orders</h3>
              <span className="text-sm text-slate-400">{status.orders.length} total</span>
            </div>
            {status.orders.length === 0 ? (
              <p className="text-sm text-slate-400">No open or historical orders.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm text-slate-200">
                  <thead>
                    <tr className="text-left text-slate-400">
                      <th className="py-2 pr-4">Short ID</th>
                      <th className="py-2 pr-4">Symbol</th>
                      <th className="py-2 pr-4">Side</th>
                      <th className="py-2 pr-4">Qty</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Price</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {status.orders.map((order) => (
                      <tr key={order.id} className="border-t border-slate-800">
                        <td className="py-2 pr-4 font-mono text-xs">
                          {order.id.slice(0, 8)}
                        </td>
                        <td className="py-2 pr-4">{order.symbol}</td>
                        <td className="py-2 pr-4 capitalize">
                          <span
                            className={
                              order.side === "buy" ? "text-emerald-400" : "text-rose-400"
                            }
                          >
                            {order.side}
                          </span>
                        </td>
                        <td className="py-2 pr-4">{formatNumber(order.qty, 4)}</td>
                        <td className="py-2 pr-4 uppercase">{order.type}</td>
                        <td className="py-2 pr-4">
                          {order.price == null ? "-" : formatNumber(order.price)}
                        </td>
                        <td className="py-2 pr-4 capitalize">{order.status}</td>
                        <td className="py-2 pr-4">
                          {order.status === "new" ? (
                            <button
                              type="button"
                              disabled={loading || status.kill_switch_tripped}
                              onClick={() => handleCancelOrder(order.id)}
                              className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                                loading || status.kill_switch_tripped
                                  ? "bg-slate-800 text-slate-500 border-slate-700"
                                  : "bg-slate-900 text-slate-200 border-slate-600 hover:bg-slate-800"
                              }`}
                            >
                              Cancel
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-300">
              <span>Trade History (Paper)</span>
              <span className="text-[11px] text-slate-500">
                {filteredTrades.length === tradeHistory.length
                  ? `Showing ${filteredTrades.length} trades`
                  : `Showing ${filteredTrades.length} / ${tradeHistory.length} trades`}
              </span>
            </div>
            {tradeHistory.length === 0 ? (
              <div className="text-xs text-slate-500">No paper trades recorded yet.</div>
            ) : filteredTrades.length === 0 ? (
              <div className="text-xs text-slate-500">
                No trades match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-slate-700 text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Time</th>
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2 text-right">Alpha</th>
                      <th className="px-4 py-2">Side</th>
                      <th className="px-4 py-2 text-right">Qty</th>
                      <th className="px-4 py-2 text-right">Entry</th>
                      <th className="px-4 py-2 text-right">Exit</th>
                      <th className="px-4 py-2 text-right">PnL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTrades.map((t, idx) => {
                      const pnlClass =
                        t.pnl > 0
                          ? "text-emerald-400"
                          : t.pnl < 0
                          ? "text-rose-400"
                          : "text-slate-100";
                      return (
                        <tr
                          key={`${t.ts}-${t.symbol}-${idx}`}
                          className="border-b border-slate-800/60 last:border-0"
                        >
                          <td className="px-4 py-2 text-slate-400">
                            {new Date(t.ts).toLocaleString()}
                          </td>
                          <td className="px-4 py-2">{t.symbol}</td>
                          <td className="px-4 py-2">{t.strategy_name ?? "-"}</td>
                          <td className="px-4 py-2 text-right">
                            {t.alpha_score != null ? t.alpha_score.toFixed(2) : "-"}
                          </td>
                          <td className="px-4 py-2">{t.side}</td>
                          <td className="px-4 py-2 text-right">{t.qty.toFixed(4)}</td>
                          <td className="px-4 py-2 text-right">{t.entry_price.toFixed(2)}</td>
                          <td className="px-4 py-2 text-right">{t.exit_price.toFixed(2)}</td>
                          <td className={`px-4 py-2 text-right ${pnlClass}`}>
                            {t.pnl.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default LiveTradingPanel;
