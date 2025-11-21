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
            side=1 if str(t.side).lower() == "long" else -1,
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
    symbol: str,
) -> Tuple[List[Trade], pd.Series]:
    trades: List[Trade] = []
    equity_vals: List[float] = [initial_equity]
    position = 0
    entry_price: float | None = None
    entry_ts: int | None = None
    position_qty: float | None = None
    max_drawdown: float | None = None
    trade_id = 1

    candle_ts = candles["ts"].astype(int).reset_index(drop=True)
    candle_close = candles["close"].astype(float).reset_index(drop=True)

    def _update_dd(current_dd: float | None, price_val: float) -> float:
        nonlocal entry_price, position, position_qty
        if entry_price is None or position_qty is None or position == 0:
            return current_dd if current_dd is not None else 0.0
        unrealized = (price_val - entry_price) * position_qty * position
        if current_dd is None:
            return float(min(0.0, unrealized))
        return float(min(current_dd, unrealized))

    for idx in range(len(candles)):
        ts = int(candle_ts.iloc[idx])
        price = float(candle_close.iloc[idx])
        signal = signal_map.get(ts, "flat")
        target_pos = 1 if signal == "long" else -1 if signal == "short" else 0

        current_equity = equity_vals[-1]

        if position != 0 and entry_price is not None:
            max_drawdown = _update_dd(max_drawdown, price)

        if position != 0 and target_pos != position and entry_price is not None:
            ret = (price / entry_price - 1.0) * position
            gross_pnl = ret * initial_equity
            fee = abs(gross_pnl) * fee_pct
            pnl = gross_pnl - fee
            current_equity += pnl
            qty = position_qty if position_qty is not None else 0.0

            trades.append(
                Trade(
                    id=trade_id,
                    symbol=symbol,
                    side="long" if position > 0 else "short",
                    entry_ts=int(entry_ts),
                    exit_ts=ts,
                    entry_price=float(entry_price),
                    exit_price=price,
                    qty=float(qty),
                    pnl=float(pnl),
                    max_drawdown_during_trade=float(max_drawdown) if max_drawdown is not None else None,
                )
            )
            trade_id += 1
            position = 0
            entry_price = None
            entry_ts = None
            position_qty = None
            max_drawdown = None

        equity_vals.append(current_equity)

        if target_pos != 0 and position == 0:
            position = target_pos
            entry_price = price
            entry_ts = ts
            position_qty = initial_equity / price if price > 0 else 0.0
            max_drawdown = 0.0

    if position != 0 and entry_price is not None and entry_ts is not None:
        price = float(candle_close.iloc[-1])
        ts = int(candle_ts.iloc[-1])
        max_drawdown = _update_dd(max_drawdown, price)
        ret = (price / entry_price - 1.0) * position
        gross_pnl = ret * initial_equity
        fee = abs(gross_pnl) * fee_pct
        pnl = gross_pnl - fee
        equity_vals.append(equity_vals[-1] + pnl)
        qty = position_qty if position_qty is not None else 0.0
        trades.append(
            Trade(
                id=trade_id,
                symbol=symbol,
                side="long" if position > 0 else "short",
                entry_ts=int(entry_ts),
                exit_ts=ts,
                entry_price=float(entry_price),
                exit_price=price,
                qty=float(qty),
                pnl=float(pnl),
                max_drawdown_during_trade=float(max_drawdown) if max_drawdown is not None else None,
            )
        )
        trade_id += 1

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
        symbol=req.symbol,
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
        symbol=req.symbol,
    )
    ai_summary = _build_summary(
        ai_trades, ai_equity, candles, confusion, feature_importance
    )

    return StrategyBacktestPair(baseline=baseline_summary, ai=ai_summary)
