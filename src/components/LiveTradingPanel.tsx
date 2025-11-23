import React, { useEffect, useState } from "react";
import { LiveStatus, PlacePaperOrderRequest } from "../types/trading";
import {
  fetchPaperStatus,
  placePaperOrder,
  cancelPaperOrder,
  toggleKillSwitch,
  flattenPaperPosition,
} from "../api/liveTrading";

const formatNumber = (value: number | null | undefined, digits = 2): string => {
  if (!Number.isFinite(value ?? NaN)) {
    return "-";
  }
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
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
  const [killSwitchBusy, setKillSwitchBusy] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const data = await fetchPaperStatus();
        if (active) {
          setStatus(data);
          setError(null);
        }
      } catch (err) {
        if (active) {
          setError((err as Error).message);
        }
      }
    }

    load();
    const id = window.setInterval(load, 4000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (orderType === "market") {
      setPrice(undefined);
    }
  }, [orderType]);

  async function handlePlaceOrder(e: React.FormEvent) {
    e.preventDefault();
    try {
      setLoading(true);
      setError(null);

      const body: PlacePaperOrderRequest = {
        symbol,
        side,
        qty,
        type: orderType,
        ...(orderType === "limit" && price ? { price } : {}),
      };

      const updated = await placePaperOrder(body);
      setStatus(updated);
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

  if (!status && !loading) {
    return (
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-sm text-slate-300">
        {error && <p className="text-rose-400 mb-2">{error}</p>}
        Loading live status...
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
        </>
      )}
    </div>
  );
};

export default LiveTradingPanel;
