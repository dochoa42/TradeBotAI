"""Async Alpaca Market Data client helpers."""
from __future__ import annotations

import logging
from typing import Final

import httpx
import pandas as pd

try:
    from .config import (
        ALPACA_DATA_BASE_URL,
        APCA_API_KEY_ID,
        APCA_API_SECRET_KEY,
    )
except ImportError:  # pragma: no cover - script mode
    from config import (  # type: ignore
        ALPACA_DATA_BASE_URL,
        APCA_API_KEY_ID,
        APCA_API_SECRET_KEY,
    )

try:
    from .models import Interval
except ImportError:  # pragma: no cover - script mode
    from models import Interval  # type: ignore

logger = logging.getLogger(__name__)

_EMPTY_COLUMNS: Final[list[str]] = ["ts", "open", "high", "low", "close", "volume"]
_TIMEFRAME_MAP: Final[dict[Interval, str]] = {
    "1m": "1Min",
    "5m": "5Min",
    "15m": "15Min",
    "1h": "1Hour",
    "4h": "4Hour",
    "1d": "1Day",
}


def _ensure_credentials() -> None:
    if not APCA_API_KEY_ID or not APCA_API_SECRET_KEY:
        raise RuntimeError("Alpaca API keys not configured")


def _empty_df() -> pd.DataFrame:
    return pd.DataFrame(columns=_EMPTY_COLUMNS)


async def fetch_alpaca_bars(
    symbol: str,
    interval: Interval,
    limit: int = 300,
) -> pd.DataFrame:
    """Fetch recent bars from Alpaca Market Data v2 for a single stock symbol."""

    _ensure_credentials()

    timeframe = _TIMEFRAME_MAP.get(interval)
    if not timeframe:
        raise ValueError(f"Unsupported interval '{interval}' for Alpaca provider")

    sanitized_limit = min(max(int(limit), 1), 1000)
    url = f"{ALPACA_DATA_BASE_URL.rstrip('/')}/stocks/{symbol.upper()}/bars"

    params = {
        "timeframe": timeframe,
        "limit": sanitized_limit,
        "adjustment": "raw",
        "feed": "iex",
    }
    headers = {
        "APCA-API-KEY-ID": APCA_API_KEY_ID,
        "APCA-API-SECRET-KEY": APCA_API_SECRET_KEY,
    }

    async with httpx.AsyncClient(timeout=httpx.Timeout(15.0)) as client:
        try:
            response = await client.get(url, params=params, headers=headers)
            response.raise_for_status()
        except httpx.HTTPError as exc:  # pragma: no cover - network
            logger.warning("Alpaca bars request failed for %s: %s", symbol, exc)
            return _empty_df()

    data = response.json()
    bars = data.get("bars", []) if isinstance(data, dict) else []
    if not bars:
        logger.warning("Alpaca returned no bars for %s (%s)", symbol, interval)
        return _empty_df()

    df = pd.DataFrame(bars)
    if df.empty:
        return _empty_df()

    try:
        df["ts"] = pd.to_datetime(df["t"], utc=True).view("int64") // 1_000_000
        df.rename(
            columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "volume"},
            inplace=True,
        )
        df = df[["ts", "open", "high", "low", "close", "volume"]].astype(
            {
                "ts": "int64",
                "open": "float64",
                "high": "float64",
                "low": "float64",
                "close": "float64",
                "volume": "float64",
            }
        )
    except (KeyError, ValueError, TypeError) as exc:
        logger.warning("Unexpected Alpaca payload for %s: %s", symbol, exc)
        return _empty_df()

    return df.sort_values("ts", ascending=True).reset_index(drop=True)
