import os
from typing import Optional, Literal
import httpx
import pandas as pd

Interval = Literal["1m", "5m", "1h", "1d"]

_INTERVAL_TO_BINANCE = {
    "1m": "1m",
    "5m": "5m",
    "1h": "1h",
    "1d": "1d",
}

def _host_candidates() -> list[str]:
    # 1) Respect env override BINANCE_HOST
    env_host = os.getenv("BINANCE_HOST", "").strip()
    if env_host:
        return [env_host]

    # 2) Try .com first, then .us — we will catch 451/403 and retry .us
    return [
        "https://api.binance.com",  # global
        "https://api.binance.us",   # US-compliant
    ]

async def _get_klines(host: str, symbol: str, interval: Interval, limit: int,
                      start_ms: Optional[int], end_ms: Optional[int]) -> list:
    params = {
        "symbol": symbol.upper(),
        "interval": _INTERVAL_TO_BINANCE[interval],
        "limit": min(max(limit, 1), 1000),
    }
    if start_ms is not None:
        params["startTime"] = start_ms
    if end_ms is not None:
        params["endTime"] = end_ms

    url = f"{host}/api/v3/klines"

    # Set a UA; some edges reject default
    headers = {"User-Agent": "Trading Bot 2/0.1 (+https://localhost)"}

    async with httpx.AsyncClient(timeout=httpx.Timeout(20.0), headers=headers) as client:
        r = await client.get(url, params=params)
        # If 451/403/401, raise to trigger fallback
        if r.status_code in (451, 403, 401):
            r.raise_for_status()
        if r.status_code == 429:
            # Rate limit; bubble up for clearer message
            r.raise_for_status()
        r.raise_for_status()
        return r.json()

async def fetch_klines(
    symbol: str,
    interval: Interval,
    limit: int = 500,
    start_ms: Optional[int] = None,
    end_ms: Optional[int] = None,
) -> pd.DataFrame:
    errors = []
    for host in _host_candidates():
        try:
            data = await _get_klines(host, symbol, interval, limit, start_ms, end_ms)
            if not data:
                return pd.DataFrame(columns=["ts","open","high","low","close","volume"])

            cols = [
                "openTime","open","high","low","close","volume",
                "closeTime","quoteAssetVolume","numberOfTrades",
                "takerBuyBase","takerBuyQuote","ignore"
            ]
            df = pd.DataFrame(data, columns=cols)
            out = pd.DataFrame({
                "ts": df["openTime"].astype("int64"),
                "open": df["open"].astype("float64"),
                "high": df["high"].astype("float64"),
                "low": df["low"].astype("float64"),
                "close": df["close"].astype("float64"),
                "volume": df["volume"].astype("float64"),
            })
            return out
        except httpx.HTTPStatusError as e:
            errors.append(f"{host}: {e.response.status_code} {e.response.text[:200]}")
        except Exception as e:
            errors.append(f"{host}: {repr(e)}")

    # If all hosts failed, surface a consolidated error
    raise RuntimeError("All Binance hosts failed: " + " | ".join(errors))
