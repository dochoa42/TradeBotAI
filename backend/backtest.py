# backtest.py
"""
Simple vector-ish backtester to pair with model signals.
"""

from __future__ import annotations

from typing import Dict, List, Tuple

import numpy as np
import pandas as pd

from models import Trade as TradeModel
from data_providers import CandleProvider, CsvCandleProvider

Trade = TradeModel  # re-export for code that imports Trade from this module


def load_candles_dataframe(
    symbol: str,
    interval: str,
    limit: int,
    provider: CandleProvider | None = None,
) -> pd.DataFrame:
    """Fetch candles via a provider and normalize into a DataFrame."""

    candle_provider = provider or CsvCandleProvider()
    candles = candle_provider.get_candles(symbol, interval, limit)
    if not candles:
        raise ValueError("No candles returned by provider")
    return pd.DataFrame(candles, columns=["ts", "open", "high", "low", "close", "volume"])


def _side_label(position: int) -> str:
    return "long" if position > 0 else "short"


def _position_qty(notional: float, entry_price: float) -> float:
    if entry_price <= 0:
        return 0.0
    return float(notional / entry_price)


def _update_drawdown(
    current_drawdown: float | None,
    position: int,
    entry_price: float | None,
    price: float,
    qty: float | None,
) -> float:
    if entry_price is None or qty is None or position == 0:
        return current_drawdown if current_drawdown is not None else 0.0

    unrealized = (price - entry_price) * qty * position
    if current_drawdown is None:
        return float(min(0.0, unrealized))
    return float(min(current_drawdown, unrealized))


def _make_trade(
    trade_id: int,
    symbol: str,
    position: int,
    entry_ts: int,
    exit_ts: int,
    entry_price: float,
    exit_price: float,
    qty: float,
    pnl: float,
    max_drawdown: float | None,
) -> TradeModel:
    return TradeModel(
        id=trade_id,
        symbol=symbol,
        side=_side_label(position),
        entry_ts=entry_ts,
        exit_ts=exit_ts,
        entry_price=float(entry_price),
        exit_price=float(exit_price),
        qty=float(qty),
        pnl=float(pnl),
        max_drawdown_during_trade=float(max_drawdown) if max_drawdown is not None else None,
    )


def run_simple_backtest(
    candles: pd.DataFrame,
    signals: pd.Series,
    tp_pct: float,
    sl_pct: float,
    initial_equity: float = 1_000.0,
    symbol: str = "BTCUSDT",
) -> Tuple[List[TradeModel], pd.Series]:
    """
    Very simple backtest: always 1 "unit" position (normalized).

    candles: DataFrame with ts, close
    signals: Series of -1/0/1 indexed same as candles.index
    tp_pct, sl_pct: take-profit / stop-loss thresholds in percentage (e.g. 1.0 = 1%)
    """
    df = candles.copy().reset_index(drop=True)
    sig = signals.reindex(df.index).fillna(0).astype(int)

    equity = [initial_equity]
    trades: List[TradeModel] = []

    position = 0  # +1 long, -1 short, 0 flat
    entry_price = None
    entry_ts = None
    position_qty: float | None = None
    max_drawdown: float | None = None
    trade_id = 1

    tp = tp_pct / 100.0
    sl = sl_pct / 100.0

    for i in range(len(df)):
        price = float(df.loc[i, "close"])
        ts = int(df.loc[i, "ts"])
        s = int(sig.iloc[i])

        # If in a position, check TP/SL
        if position != 0 and entry_price is not None:
            max_drawdown = _update_drawdown(max_drawdown, position, entry_price, price, position_qty)
            ret = (price / entry_price - 1.0) * position
            if ret >= tp or ret <= -sl:
                # Close position
                pnl = ret * initial_equity
                equity.append(equity[-1] + pnl)
                qty = position_qty if position_qty is not None else 0.0
                trades.append(
                    _make_trade(
                        trade_id=trade_id,
                        symbol=symbol,
                        position=position,
                        entry_ts=int(entry_ts),
                        exit_ts=ts,
                        entry_price=float(entry_price),
                        exit_price=price,
                        qty=qty,
                        pnl=pnl,
                        max_drawdown=max_drawdown,
                    )
                )
                trade_id += 1
                position = 0
                entry_price = None
                entry_ts = None
                position_qty = None
                max_drawdown = None
            else:
                equity.append(equity[-1])
        else:
            equity.append(equity[-1])

        # Entry logic: if flat and signal != 0, enter
        if position == 0 and s != 0:
            position = s
            entry_price = price
            entry_ts = ts
            position_qty = _position_qty(initial_equity, entry_price)
            max_drawdown = 0.0

    # Close any open position at the last bar
    if position != 0 and entry_price is not None:
        price = float(df.loc[len(df) - 1, "close"])
        ts = int(df.loc[len(df) - 1, "ts"])
        max_drawdown = _update_drawdown(max_drawdown, position, entry_price, price, position_qty)
        ret = (price / entry_price - 1.0) * position
        pnl = ret * initial_equity
        equity.append(equity[-1] + pnl)
        qty = position_qty if position_qty is not None else 0.0
        trades.append(
            _make_trade(
                trade_id=trade_id,
                symbol=symbol,
                position=position,
                entry_ts=int(entry_ts),
                exit_ts=ts,
                entry_price=float(entry_price),
                exit_price=price,
                qty=qty,
                pnl=pnl,
                max_drawdown=max_drawdown,
            )
        )

    equity_series = pd.Series(equity, index=range(len(equity)))
    return trades, equity_series


def compute_metrics(equity: pd.Series, trades: List[Trade]) -> Dict:

    
    """
    Compute some basic backtest metrics: win rate, PF, Sharpe, max DD.
    """
    if len(trades) == 0:
        return {
            "win_rate": 0.0,
            "profit_factor": 0.0,
            "sharpe": 0.0,
            "max_drawdown": 0.0,
        }

    pnls = np.array([t.pnl for t in trades], dtype=float)
    wins = pnls[pnls > 0]
    losses = pnls[pnls < 0]

    win_rate = float((pnls > 0).mean())
    gross_profit = float(wins.sum()) if len(wins) else 0.0
    gross_loss = float(-losses.sum()) if len(losses) else 0.0
    profit_factor = float(gross_profit / gross_loss) if gross_loss > 0 else 0.0

    # "Returns" as percentage changes in equity
    ret = equity.pct_change().dropna()
    if len(ret) > 1 and ret.std() > 0:
        sharpe = float(np.sqrt(252.0) * ret.mean() / ret.std())
    else:
        sharpe = 0.0

    # Max drawdown
    cummax = equity.cummax()
    dd = (equity - cummax) / cummax
    max_dd = float(dd.min())

    return {
        "win_rate": win_rate,
        "profit_factor": profit_factor,
        "sharpe": sharpe,
        "max_drawdown": max_dd,
    }
def bollinger_backtest(
    candles: pd.DataFrame,
    tp_pct: float,
    sl_pct: float,
    initial_equity: float = 1_000.0,
    fee_pct: float = 0.0,
    symbol: str = "BTCUSDT",
) -> Tuple[List[TradeModel], pd.Series]:
    """
    Simple multi-trade backtest using Bollinger Bands on close prices.

    Rules (per bar):
      - Flat -> enter LONG when close crosses below lower band.
      - Flat -> enter SHORT when close crosses above upper band.
      - When in a position:
          * close on TP or SL (percent move from entry)
          * or close if price crosses back through the 20-period SMA.

    Returns Trade models and equity series.
    """

    df = candles.copy().reset_index(drop=True)

    close = df["close"].astype(float)
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    bb_up = sma20 + 2 * std20
    bb_dn = sma20 - 2 * std20

    tp = tp_pct / 100.0
    sl = sl_pct / 100.0

    equity_vals = [initial_equity]
    trades: List[TradeModel] = []

    position = 0  # +1 long, -1 short, 0 flat
    entry_price = None
    entry_ts = None
    position_qty: float | None = None
    max_drawdown: float | None = None
    trade_id = 1

    for i in range(len(df)):
        price = float(close.iloc[i])
        ts = int(df.loc[i, "ts"])

        # skip until bands are ready
        if (
            pd.isna(bb_up.iloc[i])
            or pd.isna(bb_dn.iloc[i])
            or pd.isna(sma20.iloc[i])
        ):
            equity_vals.append(equity_vals[-1])
            continue

        up = float(bb_up.iloc[i])
        dn = float(bb_dn.iloc[i])
        mid = float(sma20.iloc[i])

        # --- manage open position ---
        if position != 0 and entry_price is not None:
            max_drawdown = _update_drawdown(max_drawdown, position, entry_price, price, position_qty)
            ret = (price / entry_price - 1.0) * position
            hit_tp = ret >= tp
            hit_sl = ret <= -sl
            cross_mid = (position > 0 and price >= mid) or (
                position < 0 and price <= mid
            )

            if hit_tp or hit_sl or cross_mid:
                gross_pnl = ret * initial_equity
                fee = abs(gross_pnl) * fee_pct
                pnl = gross_pnl - fee

                equity_vals.append(equity_vals[-1] + pnl)
                qty = position_qty if position_qty is not None else 0.0
                trades.append(
                    _make_trade(
                        trade_id=trade_id,
                        symbol=symbol,
                        position=position,
                        entry_ts=int(entry_ts),
                        exit_ts=ts,
                        entry_price=float(entry_price),
                        exit_price=price,
                        qty=qty,
                        pnl=pnl,
                        max_drawdown=max_drawdown,
                    )
                )
                trade_id += 1
                position = 0
                entry_price = None
                entry_ts = None
                position_qty = None
                max_drawdown = None
            else:
                equity_vals.append(equity_vals[-1])
        else:
            equity_vals.append(equity_vals[-1])

        # --- flat: look for entries ---
        if position == 0:
            if i > 0:
                prev_close = float(close.iloc[i - 1])
                prev_up = float(bb_up.iloc[i - 1])
                prev_dn = float(bb_dn.iloc[i - 1])
            else:
                prev_close, prev_up, prev_dn = price, up, dn

            long_signal = prev_close > prev_dn and price < dn
            short_signal = prev_close < prev_up and price > up

            if long_signal:
                position = 1
                entry_price = price
                entry_ts = ts
                position_qty = _position_qty(initial_equity, entry_price)
                max_drawdown = 0.0
            elif short_signal:
                position = -1
                entry_price = price
                entry_ts = ts
                position_qty = _position_qty(initial_equity, entry_price)
                max_drawdown = 0.0

    # Close any open trade at the last available price to keep reporting simple.
    if position != 0 and entry_price is not None:
        price = float(close.iloc[-1])
        ts = int(df.loc[len(df) - 1, "ts"])
        max_drawdown = _update_drawdown(max_drawdown, position, entry_price, price, position_qty)
        ret = (price / entry_price - 1.0) * position

        gross_pnl = ret * initial_equity
        fee = abs(gross_pnl) * fee_pct
        pnl = gross_pnl - fee

        equity_vals.append(equity_vals[-1] + pnl)
        qty = position_qty if position_qty is not None else 0.0
        trades.append(
            _make_trade(
                trade_id=trade_id,
                symbol=symbol,
                position=position,
                entry_ts=int(entry_ts),
                exit_ts=ts,
                entry_price=float(entry_price),
                exit_price=price,
                qty=qty,
                pnl=pnl,
                max_drawdown=max_drawdown,
            )
        )

    equity_series = pd.Series(equity_vals, index=range(len(equity_vals)))
    return trades, equity_series
