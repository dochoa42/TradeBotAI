from __future__ import annotations

from typing import Any, Iterable, List

import pandas as pd
from pandas import Timestamp

from models import Candle


def _to_millis(value: Any) -> int:
    """Best-effort conversion of timestamps to epoch milliseconds."""

    if isinstance(value, Timestamp):
        return int(value.value // 1_000_000)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(float(value))
        except ValueError:
            parsed = pd.to_datetime(value)
            return int(parsed.value // 1_000_000)
    parsed = pd.to_datetime(value)
    return int(parsed.value // 1_000_000)


def _candles_from_rows(rows: Iterable[Any]) -> List[Candle]:
    candles: List[Candle] = []
    for row in rows:
        ts_value = getattr(row, "ts", None)
        if ts_value is None:
            ts_value = getattr(row, "time")
        candles.append(
            Candle(
                time=_to_millis(ts_value),
                open=float(getattr(row, "open")),
                high=float(getattr(row, "high")),
                low=float(getattr(row, "low")),
                close=float(getattr(row, "close")),
                volume=float(getattr(row, "volume", 0.0)),
            )
        )
    return candles


def from_binance_klines(df: pd.DataFrame) -> List[Candle]:
    """Normalize Binance kline DataFrame rows into canonical Candle models."""

    return _candles_from_rows(df.itertuples(index=False))


def from_alpaca_bars(df: pd.DataFrame) -> List[Candle]:
    """Normalize Alpaca bar DataFrame rows into canonical Candle models."""

    return _candles_from_rows(df.itertuples(index=False))


def from_csv_rows(df: pd.DataFrame) -> List[Candle]:
    """Normalize CSV history rows into canonical Candle models."""

    return _candles_from_rows(df.itertuples(index=False))


__all__ = [
    "from_binance_klines",
    "from_alpaca_bars",
    "from_csv_rows",
]
