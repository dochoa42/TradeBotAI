from pydantic import BaseModel, Field
from typing import List, Literal, Optional

try:
    from .indicators import IndicatorSpec
except ImportError:  # pragma: no cover - allow running as script
    from indicators import IndicatorSpec  # type: ignore

# Intervals your UI uses; map 1:1 to Binance
Interval = Literal["1m", "5m", "1h", "1d"]

class Candle(BaseModel):
    ts: int = Field(..., description="Unix ms")
    open: float
    high: float
    low: float
    close: float
    volume: float

class CandleResponse(BaseModel):
    symbol: str
    interval: Interval
    count: int
    candles: List[Candle]
    note: Optional[str] = None

class ModelPredictParams(BaseModel):
    threshold: Optional[float] = None
    horizon: Optional[int] = None


class ModelPredictRequest(BaseModel):
    symbol: str
    interval: Interval
    candles: List[Candle]
    params: Optional[ModelPredictParams] = None


class ModelSignal(BaseModel):
    ts: int
    signal: int


class ModelPredictMeta(BaseModel):
    model_type: str
    model_version: str
    symbol_trained: str | None = None
    interval_trained: str | None = None
    trained_at: str | None = None
    horizon: int | None = None
    threshold: float | None = None
    feature_cols: List[str] = []
    params_override: dict | None = None


class ModelPredictResponse(BaseModel):
    signals: List[ModelSignal]
    meta: ModelPredictMeta


class AiSignal(BaseModel):
    ts: int = Field(..., description="Timestamp of the bar (ms since epoch)")
    signal: int = Field(..., description="Model output, typically 0 or 1")
    confidence: float = Field(..., description="Probability/confidence for class 1")


class AiSignalsRequest(BaseModel):
    symbol: str = Field(..., description="e.g., BTCUSDT")
    interval: Interval
    limit: int = Field(
        500,
        ge=10,
        le=5000,
        description="How many recent bars to return signals for",
    )
    indicators: Optional[List[IndicatorSpec]] = None


class AiSignalsResponse(BaseModel):
    symbol: str
    interval: Interval
    signals: List[AiSignal]


class BacktestParams(BaseModel):
    thr: float
    tp: float
    sl: float
    walkForward: bool = False  # reserved for future use


class BacktestRequest(BaseModel):
    symbol: str
    interval: str
    params: Optional[BacktestParams] = None  # use the real model

    # Account & risk controls
    starting_balance: Optional[float] = None
    fee: Optional[float] = None
    risk_per_trade_percent: Optional[float] = None
    max_daily_loss_percent: Optional[float] = None
    indicators: Optional[List[IndicatorSpec]] = None




class BacktestTrade(BaseModel):
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    pnl: float


class Trade(BaseModel):
    id: int
    symbol: str
    side: Literal["long", "short"]
    entry_ts: int  # unix ms timestamp
    exit_ts: int | None = None
    entry_price: float
    exit_price: float | None = None
    qty: float
    pnl: float
    max_drawdown_during_trade: float | None = None


class EquityPoint(BaseModel):
    ts: int
    equity: float


class BacktestSummary(BaseModel):
    starting_balance: float
    ending_balance: float
    total_pnl: float
    win_pct: float
    max_drawdown: float
    sharpe_ratio: float


class HistoryDownloadRequest(BaseModel):
    symbol: str = Field(..., description="e.g., BTCUSDT")
    interval: Interval = Field(..., description="1m | 5m | 1h | 1d")
    limit: int = Field(
        2000,
        ge=10,
        le=10000,
        description="Number of candles to fetch from Binance",
    )


class HistoryDownloadResponse(BaseModel):
    symbol: str
    interval: Interval
    rows: int = Field(..., description="Number of rows written to CSV")
    path: str = Field(..., description="CSV path on the backend")
    note: Optional[str] = None


class BacktestResponse(BaseModel):
    summary: BacktestSummary
    equity_curve: List[EquityPoint]
    trades: list[Trade] = []

