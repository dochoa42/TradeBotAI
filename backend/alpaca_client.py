"""Async Alpaca Market Data client helpers."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Final

import httpx
import pandas as pd
import logging

logger = logging.getLogger("alpaca")

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
    """
    Fetch historical bars from Alpaca Market Data v2 for a single symbol.

    Always requests a specific start/end window, keeps the end 20 minutes behind
    "now" to stay within free-tier delays, and looks back far enough to cover
    the requested number of candles (up to a sane cap).
    """

    _ensure_credentials()

    tf = _TIMEFRAME_MAP.get(interval)
    if tf is None:
        raise ValueError(f"Unsupported Alpaca interval: {interval}")

    try:
        limit_int = int(limit)
    except (TypeError, ValueError):
        limit_int = 300

    limit_int = max(1, min(limit_int, 1000))

    interval_to_minutes = {
        "1m": 1,
        "5m": 5,
        "15m": 15,
        "1h": 60,
        "4h": 240,
    }
    interval_minutes = interval_to_minutes.get(interval, 1)
    span_minutes = interval_minutes * limit_int
    max_span_minutes = 60 * 24 * 14
    if span_minutes > max_span_minutes:
        span_minutes = max_span_minutes

    now_utc = datetime.now(timezone.utc)
    end_dt = now_utc - timedelta(minutes=20)
    start_dt = end_dt - timedelta(minutes=span_minutes)

    def _fmt(dt: datetime) -> str:
        return dt.replace(microsecond=0).isoformat().replace("+00:00", "Z")

    start_str = _fmt(start_dt)
    end_str = _fmt(end_dt)

    params = {
        "timeframe": tf,
        "limit": limit_int,
        "start": start_str,
        "end": end_str,
        "adjustment": "raw",
        "feed": "iex",
    }

    url = f"{ALPACA_DATA_BASE_URL}/stocks/{symbol}/bars"

    logger.info(
        "Alpaca bars request: symbol={} interval={} limit={} start={} end={}",
        symbol,
        interval,
        limit_int,
        start_str,
        end_str,
    )

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                url,
                params=params,
                headers={
                    "APCA-API-KEY-ID": APCA_API_KEY_ID,
                    "APCA-API-SECRET-KEY": APCA_API_SECRET_KEY,
                },
            )
            resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error("Failed to fetch bars from Alpaca: {}", exc)
        return _empty_df()

    data = resp.json()
    bars = data.get("bars") or []

    if not bars:
        logger.warning(
            "Alpaca returned no bars for {} ({}). params={}",
            symbol,
            interval,
            params,
        )
        return _empty_df()

    df = pd.DataFrame(
        [
            {
                "ts": pd.to_datetime(bar["t"], utc=True),
                "open": float(bar["o"]),
                "high": float(bar["h"]),
                "low": float(bar["l"]),
                "close": float(bar["c"]),
                "volume": float(bar.get("v", 0)),
            }
            for bar in bars
        ]
    )

    df.sort_values("ts", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df
