import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LiveStatus,
  PlacePaperOrderRequest,
  PaperTradeRecord,
  EquitySnapshot,
  PaperPerformanceSummary,
  ExecutionMode,
  StrategyPerformanceRow,
  StrategyDefinition,
  DataProvider,
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
  fetchExecutionMode,
  fetchStrategyPerformance,
  resetPaperEquity,
  fetchPaperStrategies,
} from "../api/liveTrading";
import StrategyComparisonCard from "./StrategyComparisonCard";
import StrategyLibraryPanel from "./StrategyLibraryPanel";
import LiveCandlesPanel from "./LiveCandlesPanel";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { parseIndicatorsJson, summarizeIndicators } from "../utils/strategyLibrary";

const POLL_INTERVAL = 10000;

interface LiveTradingPanelProps {
  provider: DataProvider;
  symbol: string;
  onSymbolChange: (symbol: string) => void;
}

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

export const LiveTradingPanel: React.FC<LiveTradingPanelProps> = ({
  provider,
  symbol,
  onSymbolChange,
}) => {
  const [status, setStatus] = useState<LiveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [executionMode, setExecutionMode] = useState<ExecutionMode>("paper");
  const [strategyPerf, setStrategyPerf] = useState<StrategyPerformanceRow[]>([]);
  const [strategyPerfLoading, setStrategyPerfLoading] = useState(false);
  const [paperStrategies, setPaperStrategies] = useState<string[]>([]);
  const [libraryEntries, setLibraryEntries] = useState<StrategyDefinition[]>([]);
  const [resettingEquity, setResettingEquity] = useState(false);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [fullHistory, setFullHistory] = useState<PaperTradeRecord[]>([]);
  const [fullHistoryLoading, setFullHistoryLoading] = useState(false);
  const [historyModalError, setHistoryModalError] = useState<string | null>(null);
  const [selectedTradeId, setSelectedTradeId] = useState<number | string | null>(null);
  const [flashTradeId, setFlashTradeId] = useState<number | string | null>(null);
  const tradeRowRefs = useRef<Map<number | string, HTMLTableRowElement>>(new Map());
  const selectionSourceRef = useRef<"chart" | "table" | null>(null);

  const handleSymbolChange = useCallback(
    (next: string, opts?: { skipIfSame?: boolean }) => {
      const normalized = next.toUpperCase();
      if (opts?.skipIfSame && normalized === symbol.toUpperCase()) {
        return;
      }
      onSymbolChange(normalized);
    },
    [onSymbolChange, symbol]
  );

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

  const normalizedFormSymbol = useMemo(() => symbol.trim().toUpperCase(), [symbol]);

  const availableStrategies = useMemo(() => {
    const merged = new Set<string>(paperStrategies);
    libraryEntries
      .filter((entry) => entry.symbol.toUpperCase() === normalizedFormSymbol)
      .forEach((entry) => merged.add(entry.strategy_name));
    return Array.from(merged).sort();
  }, [paperStrategies, libraryEntries, normalizedFormSymbol]);

  const selectedLibraryStrategy = useMemo(() => {
    const trimmed = strategyName.trim();
    if (!trimmed) return null;
    return (
      libraryEntries.find(
        (entry) =>
          entry.symbol.toUpperCase() === normalizedFormSymbol &&
          entry.strategy_name === trimmed
      ) ?? null
    );
  }, [libraryEntries, normalizedFormSymbol, strategyName]);

  const selectedIndicators = useMemo(
    () => parseIndicatorsJson(selectedLibraryStrategy?.indicators_json ?? ""),
    [selectedLibraryStrategy]
  );

  const handleLibraryDefinitionsUpdate = useCallback(
    (entries: StrategyDefinition[]) => {
      setLibraryEntries(entries);
    },
    []
  );

  const resolvedChartSymbol = (
    selectedSymbol === "ALL" ? symbol : selectedSymbol
  ).toUpperCase();
  const resolvedStrategyFilter =
    selectedStrategy === "ALL" ? undefined : selectedStrategy;

  useEffect(() => {
    if (selectedTradeId == null) return;
    if (!filteredTrades.some((trade) => trade.id === selectedTradeId)) {
      setSelectedTradeId(null);
    }
  }, [filteredTrades, selectedTradeId]);

  useEffect(() => {
    if (selectedTradeId == null) return;
    const row = tradeRowRefs.current.get(selectedTradeId);
    if (!row) {
      selectionSourceRef.current = null;
      return;
    }

    if (selectionSourceRef.current !== "chart") {
      selectionSourceRef.current = null;
      return;
    }

    row.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashTradeId(selectedTradeId);
    const timeoutId = window.setTimeout(() => {
      setFlashTradeId((current) => (current === selectedTradeId ? null : current));
    }, 1500);

    selectionSourceRef.current = null;
    return () => window.clearTimeout(timeoutId);
  }, [selectedTradeId]);

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

      try {
        const execData = await fetchExecutionMode();
        if (active) {
          setExecutionMode(execData.mode);
        }
      } catch (err) {
        // Ignore execution mode fetch errors; keep last known value for badge.
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

    async function loadStrategyPerformanceRows() {
      if (active) {
        setStrategyPerfLoading(true);
      }
      try {
        const rows = await fetchStrategyPerformance(
          selectedSymbol === "ALL" ? undefined : selectedSymbol
        );
        if (active) {
          setStrategyPerf(rows);
        }
      } catch (err) {
        if (active) {
          setStrategyPerf([]);
        }
      } finally {
        if (active) {
          setStrategyPerfLoading(false);
        }
      }
    }

    async function loadMetrics() {
      await loadSummary();
      await loadStrategyPerformanceRows();
    }

    loadMetrics();
    const id = window.setInterval(loadMetrics, POLL_INTERVAL);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [selectedSymbol, selectedStrategy]);

  useEffect(() => {
    let active = true;

    async function loadStrategies() {
      try {
        const symbolFilter = symbol.trim();
        const rows = await fetchPaperStrategies(
          symbolFilter ? symbolFilter.toUpperCase() : undefined
        );
        if (active) {
          setPaperStrategies(rows);
        }
      } catch (err) {
        if (active) {
          setPaperStrategies([]);
        }
      }
    }

    loadStrategies();
    return () => {
      active = false;
    };
  }, [symbol]);

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

  const handleSelectTradeFromTable = (tradeId: number | string) => {
    selectionSourceRef.current = "table";
    setSelectedTradeId(tradeId);
  };

  const handleSelectTradeFromChart = (tradeId: number | string) => {
    selectionSourceRef.current = "chart";
    setSelectedTradeId(tradeId);
  };

  const renderTradeTable = (rows: PaperTradeRecord[], interactive = false) => (
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
          {rows.map((t) => {
            const pnlClass =
              t.pnl > 0
                ? "text-emerald-400"
                : t.pnl < 0
                ? "text-rose-400"
                : "text-slate-100";
            const isSelected = interactive && selectedTradeId === t.id;
            const isFlashing = interactive && flashTradeId === t.id;
            return (
              <tr
                key={t.id}
                ref={(el) => {
                  if (!interactive) return;
                  if (!el) {
                    tradeRowRefs.current.delete(t.id);
                  } else {
                    tradeRowRefs.current.set(t.id, el);
                  }
                }}
                onClick={interactive ? () => handleSelectTradeFromTable(t.id) : undefined}
                className={`border-b border-slate-800/60 last:border-0 ${
                  interactive ? "cursor-pointer transition-colors duration-150 hover:bg-slate-800/40" : ""
                } ${isSelected ? "bg-slate-800/50" : ""} ${
                  isFlashing ? "ring-2 ring-indigo-500/60" : ""
                }`}
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
                <td className="px-4 py-2 text-right">
                  {(t.quantity ?? t.qty).toFixed(4)}
                </td>
                <td className="px-4 py-2 text-right">{t.entry_price.toFixed(2)}</td>
                <td className="px-4 py-2 text-right">
                  {formatNumber(t.exit_price)}
                </td>
                <td className={`px-4 py-2 text-right ${pnlClass}`}>
                  {t.pnl.toFixed(2)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

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

  async function handleResetEquity() {
    if (!status || status.mode !== "paper" || resettingEquity) {
      return;
    }
    const defaultEquity = Number.isFinite(status.equity)
      ? status.equity
      : 2000;
    const defaultPromptValue = Number.isFinite(defaultEquity)
      ? defaultEquity.toString()
      : "2000";
    const raw = window.prompt(
      "Enter a new starting equity value",
      defaultPromptValue
    );
    if (raw === null) {
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError("Invalid equity amount");
      return;
    }

    try {
      setResettingEquity(true);
      const updated = await resetPaperEquity({
        target_equity: parsed,
        note: "manual reset from UI",
      });
      setStatus(updated);
      await refreshHistory();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setResettingEquity(false);
    }
  }

  async function handleOpenFullHistory() {
    setHistoryModalOpen(true);
    setHistoryModalError(null);
    setFullHistoryLoading(true);
    try {
      const rows = await fetchPaperTrades(500, 0);
      setFullHistory(rows);
    } catch (err) {
      setHistoryModalError((err as Error).message);
      setFullHistory([]);
    } finally {
      setFullHistoryLoading(false);
    }
  }

  function handleCloseHistoryModal() {
    setHistoryModalOpen(false);
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
            <span
              className={`px-2 py-1 rounded text-xs font-semibold text-slate-100 border border-slate-700 ${
                executionMode === "paper" ? "bg-slate-700" : "bg-amber-700"
              }`}
            >
              {executionMode === "paper"
                ? "Execution: PAPER"
                : "Execution: BROKER (STUB)"}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-200 border border-slate-700">
              Mode: {status.mode}
            </span>
            <span className="text-slate-100 text-sm">
              Equity: <span className="font-semibold">{formatNumber(status.equity)}</span>
            </span>
            <span className={`text-sm font-semibold ${formatPnlClass(status.daily_pnl)}`}>
              Daily PnL: {formatNumber(status.daily_pnl)}
            </span>
            {status.mode === "paper" && (
              <button
                type="button"
                onClick={handleResetEquity}
                disabled={resettingEquity}
                className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                  resettingEquity
                    ? "bg-slate-800 text-slate-500 border-slate-700"
                    : "bg-slate-900 text-slate-200 border-slate-600 hover:bg-slate-800"
                }`}
              >
                {resettingEquity ? "Resetting..." : "Reset equity"}
              </button>
            )}
            {typeof status.resets_count === "number" && (
              <span className="text-xs text-slate-400">
                Session resets: {status.resets_count}
              </span>
            )}
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
                    onChange={(e) => handleSymbolChange(e.target.value)}
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
                  <span>Strategy</span>
                  <input
                    type="text"
                    value={strategyName}
                    onChange={(e) => setStrategyName(e.target.value)}
                    placeholder="e.g. Mean Revert"
                    className="mt-1 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-slate-50 focus:border-emerald-400 focus:outline-none"
                  />
                  {availableStrategies.length > 0 && (
                    <select
                      defaultValue=""
                      onChange={(e) => {
                        const next = e.target.value;
                        if (!next) {
                          return;
                        }
                        setStrategyName(next);
                        e.currentTarget.value = "";
                      }}
                      className="mt-2 rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-300"
                    >
                      <option value="">Select saved strategy</option>
                      {availableStrategies.map((strategy) => (
                        <option key={strategy} value={strategy}>
                          {strategy}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <div className="md:col-span-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                        Strategy details
                      </span>
                      {selectedLibraryStrategy && (
                        <span className="text-[10px] uppercase tracking-wider text-emerald-300">
                          From library
                        </span>
                      )}
                    </div>
                    {strategyName.trim() === "" ? (
                      <p className="mt-2 text-xs text-slate-500">
                        Enter or select a strategy name to view saved indicators and notes.
                      </p>
                    ) : selectedLibraryStrategy ? (
                      <div className="mt-2 space-y-2 text-sm text-slate-200">
                        <p className="text-slate-200">
                          {summarizeIndicators(
                            selectedLibraryStrategy.indicators_json,
                            "Custom stack"
                          )}
                        </p>
                        {selectedIndicators.length > 0 && (
                          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-400">
                            {selectedIndicators.map((indicator, idx) => (
                              <li key={`selected-indicator-${idx}`}>
                                <span className="font-semibold text-slate-200">
                                  {indicator.label}
                                </span>
                                {indicator.params && Object.keys(indicator.params).length > 0 && (
                                  <span className="text-slate-400">
                                    {" "}-
                                    {Object.entries(indicator.params)
                                      .map(([key, value]) => `${key}: ${value}`)
                                      .join(", ")}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="text-xs text-slate-400 whitespace-pre-line">
                          {selectedLibraryStrategy.notes?.trim()
                            ? selectedLibraryStrategy.notes
                            : "No notes saved for this strategy."}
                        </p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-slate-500">
                        No library entry for “{strategyName.trim()}” on {normalizedFormSymbol} yet.
                      </p>
                    )}
                  </div>
                </div>
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

          <LiveCandlesPanel
            symbol={resolvedChartSymbol}
            strategy={resolvedStrategyFilter}
            provider={provider}
            selectedTradeId={selectedTradeId}
            onSelectTrade={handleSelectTradeFromChart}
          />

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-300">
              <span>Trade History (Paper)</span>
              <div className="flex items-center gap-3">
                <span className="text-[11px] text-slate-500">
                  {filteredTrades.length === tradeHistory.length
                    ? `Showing ${filteredTrades.length} trades`
                    : `Showing ${filteredTrades.length} / ${tradeHistory.length} trades`}
                </span>
                <button
                  type="button"
                  onClick={handleOpenFullHistory}
                  className="rounded-lg border border-slate-600 px-3 py-1 text-[11px] font-semibold text-slate-200 hover:bg-slate-800"
                  disabled={tradeHistory.length === 0}
                >
                  View full history
                </button>
              </div>
            </div>
            {tradeHistory.length === 0 ? (
              <div className="text-xs text-slate-500">No paper trades recorded yet.</div>
            ) : filteredTrades.length === 0 ? (
              <div className="text-xs text-slate-500">
                No trades match the current filters.
              </div>
            ) : (
              renderTradeTable(filteredTrades, true)
            )}
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/60 p-4">
            <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-300">
              <span>Strategy Performance (Paper)</span>
              <span className="text-[11px] text-slate-500">
                {strategyPerf.length} {strategyPerf.length === 1 ? "strategy" : "strategies"}
              </span>
            </div>
            {strategyPerfLoading ? (
              <div className="text-xs text-slate-500">Loading...</div>
            ) : strategyPerf.length === 0 ? (
              <div className="text-xs text-slate-500">No strategies with trades yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="border-b border-slate-700 text-slate-400">
                    <tr>
                      <th className="px-4 py-2">Strategy</th>
                      <th className="px-4 py-2">Symbol</th>
                      <th className="px-4 py-2 text-right">Trades</th>
                      <th className="px-4 py-2 text-right">Win %</th>
                      <th className="px-4 py-2 text-right">Net PnL</th>
                      <th className="px-4 py-2 text-right">Max DD</th>
                      <th className="px-4 py-2 text-right">Avg PnL / trade</th>
                      <th className="px-4 py-2 text-right">Avg hold (min)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {strategyPerf.map((row) => {
                      const drawdownValue = row.max_drawdown > 0 ? -row.max_drawdown : row.max_drawdown;
                      return (
                        <tr key={`${row.strategy_name}-${row.symbol}`} className="border-b border-slate-800/60 last:border-0">
                          <td className="px-4 py-2">{row.strategy_name}</td>
                          <td className="px-4 py-2">{row.symbol}</td>
                          <td className="px-4 py-2 text-right">{row.total_trades}</td>
                          <td className="px-4 py-2 text-right">{formatPercent(row.win_rate, 1)}</td>
                          <td className={`px-4 py-2 text-right font-semibold ${formatPnlClass(row.net_pnl)}`}>
                            {row.net_pnl.toFixed(2)}
                          </td>
                          <td className={`px-4 py-2 text-right font-semibold ${formatPnlClass(drawdownValue)}`}>
                            {drawdownValue.toFixed(2)}
                          </td>
                          <td className="px-4 py-2 text-right">{formatNumber(row.avg_trade_pnl)}</td>
                          <td className="px-4 py-2 text-right">
                            {row.avg_holding_minutes != null
                              ? formatNumber(row.avg_holding_minutes, 1)
                              : "-"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <StrategyComparisonCard
            className="mt-4"
            symbol={selectedSymbol === "ALL" ? symbol : selectedSymbol}
            symbols={symbolOptions.filter((sym) => sym !== "ALL")}
          />
          <StrategyLibraryPanel
            className="mt-4"
            symbol={symbol}
            onDefinitionsChange={handleLibraryDefinitionsUpdate}
          />
        </>
      )}
      {historyModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={handleCloseHistoryModal}
        >
          <div
            className="w-full max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold text-slate-100">
                  Full Paper Trade History
                </h4>
                <p className="text-xs text-slate-400">
                  Showing up to the 500 most recent paper trades from SQLite.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseHistoryModal}
                className="rounded-md border border-slate-600 px-3 py-1 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Close
              </button>
            </div>
            {historyModalError && (
              <div className="mb-3 rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                {historyModalError}
              </div>
            )}
            {fullHistoryLoading ? (
              <div className="text-sm text-slate-400">Loading full history...</div>
            ) : fullHistory.length === 0 ? (
              <div className="text-sm text-slate-400">
                No paper trades recorded yet.
              </div>
            ) : (
              <div className="max-h-[60vh] overflow-y-auto pr-2">
                {renderTradeTable(fullHistory)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default LiveTradingPanel;
