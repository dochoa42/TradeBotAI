from pydantic import BaseModel, Field
from typing import List, Literal, Optional

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
    side: Literal["long", "short", "flat"]
    prob_long: float
    prob_short: float
    prob_flat: float


class AiSignalsRequest(BaseModel):
    symbol: str = Field(..., description="e.g., BTCUSDT")
    interval: Interval
    limit: int = Field(
        500,
        ge=10,
        le=5000,
        description="How many recent bars to return signals for",
    )


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

    # NEW: optional fields coming from Simulation Desk
    starting_balance: Optional[float] = None
    fee: Optional[float] = None




class BacktestTrade(BaseModel):
    entry_ts: int
    exit_ts: int
    side: int
    entry_price: float
    exit_price: float
    pnl: float


class EquityPoint(BaseModel):
    ts: int
    equity: float


class BacktestMetrics(BaseModel):
    win_rate: float
    profit_factor: float
    sharpe: float
    max_drawdown: float


class ConfusionCounts(BaseModel):
    tp: int
    fp: int
    tn: int
    fn: int


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


class FeatureImportanceItem(BaseModel):
    name: str
    importance: float


class StrategyBacktestSummary(BaseModel):
    trades: List[BacktestTrade]
    equity_curve: List[EquityPoint]
    metrics: BacktestMetrics
    confusion: ConfusionCounts
    feature_importance: List[FeatureImportanceItem]


class StrategyBacktestPair(BaseModel):
    baseline: StrategyBacktestSummary
    ai: StrategyBacktestSummary


class BacktestResponse(BaseModel):
    trades: List[BacktestTrade]
    equity_curve: List[EquityPoint]
    metrics: BacktestMetrics
    confusion: ConfusionCounts
    feature_importance: List[FeatureImportanceItem]
    strategies: Optional[StrategyBacktestPair] = None

