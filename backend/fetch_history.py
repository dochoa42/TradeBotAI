# backend/fetch_history.py
#
# Usage (from backend folder, venv active):
#   python fetch_history.py BTCUSDT 1m --limit 2000
#   python fetch_history.py ETHUSDT 1m --limit 2000

import argparse
import asyncio
from pathlib import Path

import pandas as pd

from binance_client import fetch_klines  # uses the same client as /api/candles


async def fetch_and_save(symbol: str, interval: str, limit: int) -> None:
    """
    Fetch candles from Binance and save to backend/data/{symbol}_{interval}.csv
    Columns: ts, open, high, low, close, volume
    """
    s = symbol.upper()
    print(f"[fetch_history] Fetching {limit} {interval} candles for {s}...")

    df = await fetch_klines(s, interval, limit=limit, start_ms=None, end_ms=None)

    if df.empty:
        print("[fetch_history] No data returned!")
        return

    # Keep only the columns used by backtest.py
    df = df[["ts", "open", "high", "low", "close", "volume"]]

    data_dir = Path(__file__).parent / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    out_path = data_dir / f"{s}_{interval}.csv"
    df.to_csv(out_path, index=False)

    print(f"[fetch_history] Saved {len(df)} rows to {out_path}")


async def async_main() -> None:
    parser = argparse.ArgumentParser(description="Fetch historical Binance candles to CSV.")
    parser.add_argument("symbol", help="e.g. BTCUSDT, ETHUSDT")
    parser.add_argument("interval", help="e.g. 1m, 5m, 1h, 1d")
    parser.add_argument("--limit", type=int, default=2000, help="Number of candles to fetch")
    args = parser.parse_args()

    await fetch_and_save(args.symbol, args.interval, args.limit)


if __name__ == "__main__":
    asyncio.run(async_main())
