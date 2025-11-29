from datetime import datetime
from enum import Enum
from pydantic import BaseModel, Field, root_validator
from typing import Any, Dict, List, Literal, Optional

try:
    from .indicators import IndicatorSpec
except ImportError:  # pragma: no cover - allow running as script
    from indicators import IndicatorSpec  # type: ignore

# Intervals your UI uses; map 1:1 to Binance
Interval = Literal["1m", "5m", "15m", "1h", "4h", "1d"]
DataProvider = Literal["csv", "api", "alpaca"]

class Candle(BaseModel):
    time: int = Field(..., description="Unix ms")
    open: float
    high: float
    low: float
    close: float
    volume: float

    @root_validator(pre=True)
    def _alias_ts(cls, values: dict) -> dict:
        """Accept legacy payloads that still use 'ts' instead of 'time'."""

        if "time" not in values and "ts" in values:
            values["time"] = values["ts"]
        return values

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
    strategy_name: Optional[str] = None
    strategy: Literal["bollinger", "rsi", "macd", "alpha_model"] = "bollinger"
    strategy_params: Dict[str, Any] = Field(default_factory=dict)
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
    note: Optional[str] = None


TradingMode = Literal["backtest", "paper", "live"]


class ExecutionMode(str, Enum):
    PAPER = "paper"
    BROKER_STUB = "broker_stub"
    # future: BROKER_ALPACA_PAPER, BROKER_ALPACA_LIVE


class ExecutionModeResponse(BaseModel):
    mode: ExecutionMode


class ExecutionModeUpdateRequest(BaseModel):
    mode: ExecutionMode


class LivePosition(BaseModel):
    symbol: str
    side: Literal["long", "short"]
    size: float
    entry_price: float
    current_price: float
    unrealized_pnl: float
    strategy_name: Optional[str] = None
    alpha_score: Optional[float] = None
    tags: Optional[Dict[str, Any]] = None
    entry_signal_time: Optional[int] = None


class LiveOrder(BaseModel):
    id: str
    symbol: str
    side: Literal["buy", "sell"]
    qty: float
    type: Literal["market", "limit"]
    price: Optional[float] = None
    status: Literal["new", "filled", "canceled"]
    strategy_name: Optional[str] = None
    alpha_score: Optional[float] = None
    tags: Optional[Dict[str, Any]] = None
    entry_signal_time: Optional[int] = None


class LiveStatus(BaseModel):
    mode: TradingMode
    equity: float
    daily_pnl: float
    positions: List[LivePosition] = []
    orders: List[LiveOrder] = []
    # Phase 10.2 – risk and kill switch surface
    kill_switch_tripped: bool = False
    kill_switch_reason: Optional[str] = None
    daily_loss_limit: Optional[float] = None
    max_position_size: Optional[float] = None
    max_open_positions: Optional[int] = None
    resets_count: Optional[int] = None


class PlacePaperOrderRequest(BaseModel):
    symbol: str
    side: Literal["buy", "sell"]
    qty: float
    type: Literal["market", "limit"] = "market"
    price: Optional[float] = None
    strategy_name: Optional[str] = None
    alpha_score: Optional[float] = None
    tags: Optional[Dict[str, Any]] = None
    entry_signal_time: Optional[int] = None


class CancelPaperOrderRequest(BaseModel):
    order_id: str


class FlattenPaperPositionRequest(BaseModel):
    symbol: str
    side: Literal["long", "short"]
    exit_price: float


class PaperTradeRecord(BaseModel):
    id: int
    ts: datetime
    symbol: str
    side: str
    qty: float
    quantity: float
    entry_time: Optional[datetime] = None
    exit_time: Optional[datetime] = None
    entry_price: float
    exit_price: Optional[float] = None
    pnl: float
    strategy_name: Optional[str] = None
    alpha_score: Optional[float] = None
    entry_signal_time: datetime | int | None = None
    holding_minutes: Optional[float] = None
    tags: Optional[Dict[str, Any]] = None


class EquitySnapshot(BaseModel):
    ts: datetime
    equity: float
    daily_pnl: float


class PaperPerformanceSummary(BaseModel):
    total_trades: int
    win_trades: int
    loss_trades: int
    win_rate: float
    gross_pnl: float
    net_pnl: float
    max_drawdown: float
    avg_r_multiple: Optional[float] = None
    best_trade_pnl: Optional[float] = None
    worst_trade_pnl: Optional[float] = None
    avg_holding_minutes: Optional[float] = None


class StrategyPerformanceRow(BaseModel):
    strategy_name: str
    symbol: str
    total_trades: int
    win_trades: int
    loss_trades: int
    win_rate: float
    net_pnl: float
    max_drawdown: float
    avg_trade_pnl: float
    avg_holding_minutes: Optional[float] = None


class StrategySideStats(BaseModel):
    pnl: Optional[float] = None
    net_pnl: Optional[float] = None
    win_rate: Optional[float] = None
    max_drawdown: Optional[float] = None
    trades: Optional[int] = None


class StrategyComparisonRow(BaseModel):
    symbol: str
    strategy: str
    backtest: Optional[StrategySideStats] = None
    live: Optional[StrategySideStats] = None


class StrategyDefinitionIn(BaseModel):
    symbol: str
    strategy_name: str
    indicators_json: str
    notes: str = ""


class StrategyDefinition(StrategyDefinitionIn):
    id: int
    created_at: datetime
    updated_at: datetime
