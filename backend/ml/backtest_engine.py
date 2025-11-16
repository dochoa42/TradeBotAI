from __future__ import annotations

from pathlib import Path
from typing import Dict, List, Tuple

import pandas as pd

from backtest import Trade, bollinger_backtest, compute_metrics
from model_service import get_model_and_meta
from models import (
    BacktestMetrics,
    BacktestRequest,
    BacktestTrade,
    ConfusionCounts,
    EquityPoint,
    FeatureImportanceItem,
    StrategyBacktestPair,
    StrategyBacktestSummary,
)
from ml.ai_signals import generate_ai_signals_from_csv


DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def _load_candles(symbol: str, interval: str) -> pd.DataFrame:
    """
    Load OHLCV data for the requested symbol/interval from backend/data.
    """
    csv_path = DATA_DIR / f"{symbol}_{interval}.csv"
    if not csv_path.exists():
        raise FileNotFoundError(f"Historical CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)
    expected_cols = {"ts", "open", "high", "low", "close", "volume"}
    missing = expected_cols.difference(df.columns)
    if missing:
        raise ValueError(f"CSV missing columns: {sorted(missing)}")

    return df


def _convert_trades(trades: List[Trade]) -> List[BacktestTrade]:
    return [
        BacktestTrade(
            entry_ts=t.entry_ts,
            exit_ts=t.exit_ts,
            side=t.side,
            entry_price=t.entry_price,
            exit_price=t.exit_price,
            pnl=t.pnl,
        )
        for t in trades
    ]


def _equity_curve(candles: pd.DataFrame, equity: pd.Series) -> List[EquityPoint]:
    eq_points: List[EquityPoint] = []
    ts_values = candles["ts"].astype(int).tolist()

    for idx, val in enumerate(equity.astype(float).tolist()):
        ts_idx = min(idx, len(ts_values) - 1) if ts_values else 0
        ts = ts_values[ts_idx] if ts_values else 0
        eq_points.append(EquityPoint(ts=int(ts), equity=float(val)))

    return eq_points


def _metrics_obj(trades: List[Trade], equity: pd.Series) -> BacktestMetrics:
    metrics = compute_metrics(equity, trades)
    return BacktestMetrics(
        win_rate=float(metrics["win_rate"]),
        profit_factor=float(metrics["profit_factor"]),
        sharpe=float(metrics["sharpe"]),
        max_drawdown=float(metrics["max_drawdown"]),
    )


def _model_metadata() -> Tuple[ConfusionCounts, List[FeatureImportanceItem]]:
    _, model_meta = get_model_and_meta()
    cm_list = model_meta.get("confusion_matrix", [[0, 0, 0], [0, 0, 0], [0, 0, 0]])

    confusion_matrix = pd.DataFrame(cm_list, dtype=int)
    tp = int(confusion_matrix.iloc[2, 2]) if confusion_matrix.size >= 9 else 0
    fn = int(confusion_matrix.iloc[2, 0] + confusion_matrix.iloc[2, 1]) if confusion_matrix.size >= 9 else 0
    fp = int(confusion_matrix.iloc[0, 2] + confusion_matrix.iloc[1, 2]) if confusion_matrix.size >= 9 else 0
    total = int(confusion_matrix.to_numpy().sum()) if confusion_matrix.size > 0 else 0
    tn = int(total - tp - fn - fp)

    confusion_obj = ConfusionCounts(tp=tp, fp=fp, tn=tn, fn=fn)

    feature_items = [
        FeatureImportanceItem(name=fi["name"], importance=float(fi["importance"]))
        for fi in model_meta.get("feature_importance", [])
    ]

    return confusion_obj, feature_items


def _build_summary(
    trades: List[Trade],
    equity: pd.Series,
    candles: pd.DataFrame,
    confusion: ConfusionCounts,
    feature_importance: List[FeatureImportanceItem],
) -> StrategyBacktestSummary:
    return StrategyBacktestSummary(
        trades=_convert_trades(trades),
        equity_curve=_equity_curve(candles, equity),
        metrics=_metrics_obj(trades, equity),
        confusion=confusion.copy(deep=True),
        feature_importance=[fi.copy(deep=True) for fi in feature_importance],
    )


def _ai_signal_map(symbol: str, interval: str, limit: int) -> Dict[int, str]:
    ai_signals = generate_ai_signals_from_csv(symbol, interval, limit)
    return {int(entry["ts"]): entry.get("side", "flat") for entry in ai_signals}


def _ai_strategy_backtest(
    candles: pd.DataFrame,
    signal_map: Dict[int, str],
    initial_equity: float,
    fee_pct: float,
) -> Tuple[List[Trade], pd.Series]:
    trades: List[Trade] = []
    equity_vals: List[float] = [initial_equity]
    position = 0
    entry_price: float | None = None
    entry_ts: int | None = None

    candle_ts = candles["ts"].astype(int).reset_index(drop=True)
    candle_close = candles["close"].astype(float).reset_index(drop=True)

    for idx in range(len(candles)):
        ts = int(candle_ts.iloc[idx])
        price = float(candle_close.iloc[idx])
        signal = signal_map.get(ts, "flat")
        target_pos = 1 if signal == "long" else -1 if signal == "short" else 0

        current_equity = equity_vals[-1]

        if position != 0 and target_pos != position and entry_price is not None:
            ret = (price / entry_price - 1.0) * position
            gross_pnl = ret * initial_equity
            fee = abs(gross_pnl) * fee_pct
            pnl = gross_pnl - fee
            current_equity += pnl

            trades.append(
                Trade(
                    entry_ts=int(entry_ts),
                    exit_ts=ts,
                    side=position,
                    entry_price=float(entry_price),
                    exit_price=price,
                    pnl=pnl,
                )
            )
            position = 0
            entry_price = None
            entry_ts = None

        equity_vals.append(current_equity)

        if target_pos != 0 and position == 0:
            position = target_pos
            entry_price = price
            entry_ts = ts

    if position != 0 and entry_price is not None and entry_ts is not None:
        price = float(candle_close.iloc[-1])
        ts = int(candle_ts.iloc[-1])
        ret = (price / entry_price - 1.0) * position
        gross_pnl = ret * initial_equity
        fee = abs(gross_pnl) * fee_pct
        pnl = gross_pnl - fee
        equity_vals.append(equity_vals[-1] + pnl)
        trades.append(
            Trade(
                entry_ts=int(entry_ts),
                exit_ts=ts,
                side=position,
                entry_price=float(entry_price),
                exit_price=price,
                pnl=pnl,
            )
        )

    equity_series = pd.Series(equity_vals, index=range(len(equity_vals)))
    return trades, equity_series


def run_dual_backtest(req: BacktestRequest) -> StrategyBacktestPair:
    """
    Execute the existing Bollinger baseline strategy and an AI-driven strategy
    over identical candles, returning a combined pair summary.
    """
    candles = _load_candles(req.symbol, req.interval)

    params = req.params
    tp = params.tp if params and params.tp is not None else 100
    sl = params.sl if params and params.sl is not None else 50
    initial_equity = req.starting_balance if req.starting_balance is not None else 10_000.0
    fee_pct = req.fee if req.fee is not None else 0.0004

    confusion, feature_importance = _model_metadata()

    baseline_trades, baseline_equity = bollinger_backtest(
        candles=candles,
        tp_pct=tp,
        sl_pct=sl,
        initial_equity=initial_equity,
        fee_pct=fee_pct,
    )
    baseline_summary = _build_summary(
        baseline_trades, baseline_equity, candles, confusion, feature_importance
    )

    signal_map = _ai_signal_map(req.symbol, req.interval, len(candles))
    ai_trades, ai_equity = _ai_strategy_backtest(
        candles=candles,
        signal_map=signal_map,
        initial_equity=initial_equity,
        fee_pct=fee_pct,
    )
    ai_summary = _build_summary(
        ai_trades, ai_equity, candles, confusion, feature_importance
    )

    return StrategyBacktestPair(baseline=baseline_summary, ai=ai_summary)
