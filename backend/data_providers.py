from __future__ import annotations

from pathlib import Path
from typing import List, Protocol, TypedDict, runtime_checkable

import pandas as pd


class Candle(TypedDict):
    """Normalized OHLCV record matching the /api/candles response."""

    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@runtime_checkable
class CandleProvider(Protocol):
    """Protocol describing objects that can supply normalized candle data."""

    def get_candles(self, symbol: str, interval: str, limit: int) -> List[Candle]:
        """Return up to *limit* candles for the symbol/interval pair."""


class CsvCandleProvider:
    """Loads candles from CSV files under backend/data for offline backtests."""

    EXPECTED_COLUMNS = ("ts", "open", "high", "low", "close", "volume")

    def __init__(self, data_dir: str | Path | None = None) -> None:
        self.data_dir = Path(data_dir) if data_dir else Path(__file__).parent / "data"

    def _resolve_path(self, symbol: str, interval: str) -> Path:
        return self.data_dir / f"{symbol.upper()}_{interval}.csv"

    def get_candles(self, symbol: str, interval: str, limit: int) -> List[Candle]:
        """Return candles ordered by timestamp ascending.

        A non-positive *limit* means "return the full file" to preserve prior behavior.
        """

        csv_path = self._resolve_path(symbol, interval)
        if not csv_path.exists():
            raise FileNotFoundError(f"Historical CSV not found: {csv_path}")

        try:
            df = pd.read_csv(csv_path)
        except Exception as exc:  # pragma: no cover - surfaced via FastAPI HTTP error
            raise RuntimeError(f"Unable to read candles from {csv_path}: {exc}") from exc

        missing = [col for col in self.EXPECTED_COLUMNS if col not in df.columns]
        if missing:
            raise ValueError(f"CSV missing columns {missing} for {csv_path}")

        if limit > 0:
            df = df.tail(limit)
        df = df.sort_values("ts")

        candles: List[Candle] = [
            {
                "ts": int(row.ts),
                "open": float(row.open),
                "high": float(row.high),
                "low": float(row.low),
                "close": float(row.close),
                "volume": float(row.volume),
            }
            for row in df.itertuples(index=False)
        ]
        return candles


__all__ = ["Candle", "CandleProvider", "CsvCandleProvider"]
