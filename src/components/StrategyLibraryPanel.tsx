import React, { useCallback, useEffect, useMemo, useState } from "react";
import type {
  StrategyComparisonRow,
  StrategyDefinition,
} from "../types/trading";
import { fetchStrategyComparison } from "../api/liveTrading";
import {
  fetchStrategyDefinitions,
  saveStrategyDefinition,
} from "../api/strategyLibrary";
import { parseIndicatorsJson, summarizeIndicators } from "../utils/strategyLibrary";

export type StrategyLibraryPanelProps = {
  symbol: string;
  className?: string;
  onDefinitionsChange?: (definitions: StrategyDefinition[]) => void;
};

type ComparisonState = {
  data: StrategyComparisonRow | null;
  loading: boolean;
  error: string | null;
};

const StrategyLibraryPanel: React.FC<StrategyLibraryPanelProps> = ({
  symbol,
  className = "",
  onDefinitionsChange,
}) => {
  const [definitions, setDefinitions] = useState<StrategyDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [comparisonById, setComparisonById] = useState<Record<number, ComparisonState>>({});
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<StrategyDefinition | null>(null);
  const [editIndicators, setEditIndicators] = useState("[]");
  const [editNotes, setEditNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const normalizedSymbol = useMemo(() => symbol.trim().toUpperCase(), [symbol]);

  const loadDefinitions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchStrategyDefinitions(normalizedSymbol);
      setDefinitions(data);
      onDefinitionsChange?.(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load";
      setError(message);
      setDefinitions([]);
      onDefinitionsChange?.([]);
    } finally {
      setLoading(false);
    }
  }, [normalizedSymbol, onDefinitionsChange]);

  useEffect(() => {
    loadDefinitions();
  }, [loadDefinitions]);

  useEffect(() => {
    if (!definitions.length) {
      setComparisonById({});
      return;
    }

    let isMounted = true;
    const fetchRows = async () => {
      await Promise.all(
        definitions.map(async (definition) => {
          setComparisonById((prev) => ({
            ...prev,
            [definition.id]: {
              data: prev[definition.id]?.data ?? null,
              loading: true,
              error: null,
            },
          }));
          try {
            const rows = await fetchStrategyComparison({
              symbol: definition.symbol,
              strategy: definition.strategy_name,
            });
            if (!isMounted) return;
            setComparisonById((prev) => ({
              ...prev,
              [definition.id]: {
                data: rows[0] ?? null,
                loading: false,
                error: null,
              },
            }));
          } catch (err) {
            if (!isMounted) return;
            const message =
              err instanceof Error ? err.message : "Unable to load metrics";
            setComparisonById((prev) => ({
              ...prev,
              [definition.id]: {
                data: prev[definition.id]?.data ?? null,
                loading: false,
                error: message,
              },
            }));
          }
        })
      );
    };

    fetchRows();
    return () => {
      isMounted = false;
    };
  }, [definitions]);

  const toggleExpanded = (id: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const openEditor = (definition: StrategyDefinition) => {
    setEditing(definition);
    setEditIndicators(definition.indicators_json || "[]");
    setEditNotes(definition.notes ?? "");
    setSaveError(null);
  };

  const closeEditor = () => {
    if (saving) return;
    setEditing(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editing) return;
    setSaving(true);
    setSaveError(null);
    try {
      await saveStrategyDefinition({
        symbol: editing.symbol,
        strategy_name: editing.strategy_name,
        indicators_json: editIndicators,
        notes: editNotes,
      });
      setSaving(false);
      setEditing(null);
      await loadDefinitions();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save";
      setSaveError(message);
    } finally {
      setSaving(false);
    }
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

  const renderIndicatorsList = (definition: StrategyDefinition) => {
    const entries = parseIndicatorsJson(definition.indicators_json);
    if (!entries.length) {
      return <p className="text-sm text-slate-400">No indicators defined.</p>;
    }
    return (
      <ul className="list-disc space-y-1 pl-5 text-sm text-slate-200">
        {entries.map((indicator, idx) => (
          <li key={`${definition.id}-indicator-${idx}`}>
            <span className="font-semibold text-slate-100">{indicator.label}</span>
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
    );
  };

  const rowsEmpty = !loading && definitions.length === 0;

  return (
    <section
      className={`rounded-3xl border border-slate-800 bg-slate-950/70 p-5 shadow-lg shadow-black/30 ${className}`.trim()}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Strategy Library</p>
          <p className="text-sm text-slate-400 mt-1">
            Saved indicator stacks and notes for {normalizedSymbol}.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={loadDefinitions}
            className="rounded-2xl border border-slate-700 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-emerald-400"
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-900/70">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-3 text-left">Strategy</th>
              <th className="px-4 py-3 text-left">Indicators</th>
              <th className="px-4 py-3 text-right">Backtest</th>
              <th className="px-4 py-3 text-right">Live</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  Loading strategy library…
                </td>
              </tr>
            ) : rowsEmpty ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No strategies saved yet. Use the editor to document your indicator stacks.
                </td>
              </tr>
            ) : (
              definitions.map((definition) => {
                const comparison = comparisonById[definition.id];
                const summary = summarizeIndicators(definition.indicators_json, "Custom stack");
                const isExpanded = expandedRows.has(definition.id);
                return (
                  <React.Fragment key={definition.id}>
                    <tr className="border-t border-slate-800/50">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleExpanded(definition.id)}
                          className="mr-3 inline-flex h-6 w-6 items-center justify-center rounded-full border border-slate-600 text-xs text-slate-300"
                        >
                          {isExpanded ? "-" : "+"}
                        </button>
                        <div className="inline-flex flex-col">
                          <span className="font-semibold text-slate-100">{definition.strategy_name}</span>
                          <span className="text-xs text-slate-500">{definition.symbol}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-200">{summary}</td>
                      <td className="px-4 py-3 text-right">
                        {comparison?.loading ? (
                          <span className="text-xs text-slate-500">Loading…</span>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="text-slate-100">
                              {formatCurrency(comparison?.data?.backtest?.pnl ?? null)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatPercent(comparison?.data?.backtest?.win_rate ?? null)}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {comparison?.loading ? (
                          <span className="text-xs text-slate-500">Loading…</span>
                        ) : (
                          <div className="space-y-0.5">
                            <div className="text-slate-100">
                              {formatCurrency(
                                comparison?.data?.live?.net_pnl ?? comparison?.data?.live?.pnl ?? null
                              )}
                            </div>
                            <div className="text-xs text-slate-500">
                              {formatPercent(comparison?.data?.live?.win_rate ?? null)}
                            </div>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => openEditor(definition)}
                          className="rounded-2xl border border-slate-600 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-200 hover:border-emerald-400"
                        >
                          Edit
                        </button>
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="border-t border-slate-800/60 bg-slate-900/40">
                        <td colSpan={5} className="px-6 py-4">
                          <div className="space-y-4">
                            <div>
                              <h4 className="text-sm font-semibold text-slate-200">Indicators</h4>
                              {renderIndicatorsList(definition)}
                            </div>
                            <div>
                              <h4 className="text-sm font-semibold text-slate-200">Notes</h4>
                              <p className="text-sm text-slate-300 whitespace-pre-line">
                                {definition.notes?.trim() ? definition.notes : "No notes yet."}
                              </p>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/70 px-4 py-8">
          <div className="w-full max-w-2xl rounded-3xl border border-slate-800 bg-slate-950 p-6 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xl font-semibold text-slate-100">Edit Strategy</h3>
                <p className="text-sm text-slate-400">
                  {editing.strategy_name} · {editing.symbol}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEditor}
                className="text-slate-400 hover:text-slate-200"
                disabled={saving}
              >
                ✕
              </button>
            </div>

            <div className="mt-6 space-y-4">
              <label className="block text-sm text-slate-300">
                Indicators JSON
                <textarea
                  rows={8}
                  value={editIndicators}
                  onChange={(event) => setEditIndicators(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 font-mono text-xs text-slate-50"
                  spellCheck={false}
                />
              </label>
              <label className="block text-sm text-slate-300">
                Notes
                <textarea
                  rows={4}
                  value={editNotes}
                  onChange={(event) => setEditNotes(event.target.value)}
                  className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-900/70 px-4 py-3 text-sm text-slate-50"
                />
              </label>
              {saveError && (
                <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
                  {saveError}
                </div>
              )}
              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={closeEditor}
                  className="rounded-2xl border border-slate-700 px-4 py-2 text-sm text-slate-200"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  className="rounded-2xl bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50"
                  disabled={saving}
                >
                  {saving ? "Saving…" : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};

export default StrategyLibraryPanel;
