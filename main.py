from __future__ import annotations

import random
import time
from typing import List

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]
DEFAULT_CANDLE_COUNT = 200
MAX_CANDLE_COUNT = 500
BAR_INTERVAL_SECONDS = 60


class Candle(BaseModel):
    """Simple OHLCV candle schema matching lightweight-charts expectations."""

    time: int
    open: float
    high: float
    low: float
    close: float
    volume: float


app = FastAPI(
    title="Synthetic Candles API",
    description="Generates lightweight OHLCV candles for UI prototyping.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _generate_candles(count: int) -> List[Candle]:
    """Create pseudo-random OHLC candles with realistic constraints."""

    now = int(time.time())
    start_ts = now - count * BAR_INTERVAL_SECONDS

    # Anchor the first bar around a BTC-like price range.
    price = random.uniform(25000, 35000)
    candles: List[Candle] = []

    for index in range(count):
        open_price = price

        # Random walk keeps prices within a plausible band.
        drift = random.uniform(-0.0015, 0.0015) * open_price
        close_price = max(50.0, open_price + drift)

        # Wick sizes create highs/lows beyond open/close.
        upper_wick = random.uniform(0.0, 0.0025) * open_price
        lower_wick = random.uniform(0.0, 0.0025) * open_price
        high_price = max(open_price, close_price) + upper_wick
        low_price = max(1.0, min(open_price, close_price) - lower_wick)

        volume = random.uniform(8.0, 120.0)

        candles.append(
            Candle(
                time=start_ts + index * BAR_INTERVAL_SECONDS,
                open=round(open_price, 2),
                high=round(high_price, 2),
                low=round(low_price, 2),
                close=round(close_price, 2),
                volume=round(volume, 2),
            )
        )

        # Use the last close as the next open with slight slippage.
        price = close_price * (1 + random.uniform(-0.0007, 0.0007))

    return candles


@app.get("/api/candles", response_model=list[Candle])
async def get_synthetic_candles(
    count: int = Query(
        DEFAULT_CANDLE_COUNT,
        ge=1,
        le=MAX_CANDLE_COUNT,
        description="How many synthetic bars to return (capped at 500).",
    )
):
    """Return synthetic candles suitable for lightweight-charts previews."""

    return _generate_candles(count)


@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
