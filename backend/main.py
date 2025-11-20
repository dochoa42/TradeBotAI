from typing import Optional, List

from pathlib import Path
from datetime import datetime
from math import sqrt

import pandas as pd

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fetch_history import fetch_and_save as fetch_and_save_history


from models import (
    Candle,
    CandleResponse,
    Interval,
    ModelPredictRequest,
    ModelPredictResponse,
    ModelSignal,
    ModelPredictMeta,
    BacktestRequest,
    BacktestResponse,
    BacktestTrade,
    EquityPoint,
    BacktestSummary,
    HistoryDownloadRequest,
    HistoryDownloadResponse,
    AiSignalsRequest,
    AiSignalsResponse,
)
from binance_client import fetch_klines
from model_service import predict_signals_from_candles
from backtest import bollinger_backtest
from ml.ai_signals import generate_ai_signals_from_csv


app = FastAPI(title="Trading Bot 2 Backend", version="0.1.0")

# Adjust this to match your dev/preview URL for Vite
ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Simple whitelist for safety (expand as needed)
SYMBOL_WHITELIST = {
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
}

DEFAULT_STARTING_BALANCE = 2_000.0
DEFAULT_RISK_PER_TRADE = 1.0  # percent
DEFAULT_MAX_DAILY_LOSS = 5.0  # percent of starting balance
MIN_STOP_DISTANCE_PCT = 0.25  # percent of price if SL not provided


def _day_key(ts_ms: int) -> str:
    return datetime.utcfromtimestamp(ts_ms / 1000).strftime("%Y-%m-%d")


def _max_drawdown(values: List[float]) -> float:
    if not values:
        return 0.0
    peak = values[0]
    max_dd = 0.0
    for val in values:
        if val > peak:
            peak = val
        if peak <= 0:
            continue
        drawdown = (val - peak) / peak
        if drawdown < max_dd:
            max_dd = drawdown
    return float(max_dd)


def _sharpe_ratio(values: List[float]) -> float:
    if len(values) < 2:
        return 0.0
    returns: List[float] = []
    for prev, curr in zip(values[:-1], values[1:]):
        if prev <= 0:
            continue
        returns.append((curr - prev) / prev)
    if len(returns) < 2:
        return 0.0
    mean_ret = sum(returns) / len(returns)
    variance = sum((r - mean_ret) ** 2 for r in returns) / (len(returns) - 1)
    if variance <= 0:
        return 0.0
    std = sqrt(variance)
    return float(sqrt(252.0) * mean_ret / std) if std > 0 else 0.0


def apply_account_risk(
    trades: List[BacktestTrade],
    starting_balance: float,
    risk_per_trade_pct: float,
    max_daily_loss_pct: float,
    sl_pct: float,
    fee_pct: float,
    first_ts: int,
) -> tuple[List[BacktestTrade], List[EquityPoint], BacktestSummary]:
    if starting_balance <= 0:
        starting_balance = DEFAULT_STARTING_BALANCE

    risk_pct = risk_per_trade_pct if risk_per_trade_pct > 0 else DEFAULT_RISK_PER_TRADE
    daily_loss_limit_pct = (
        max_daily_loss_pct if max_daily_loss_pct > 0 else DEFAULT_MAX_DAILY_LOSS
    )
    stop_pct = sl_pct if sl_pct > 0 else MIN_STOP_DISTANCE_PCT

    balance = starting_balance
    equity_values = [starting_balance]
    equity_points = [EquityPoint(ts=first_ts, equity=starting_balance)]
    executed_trades: List[BacktestTrade] = []
    daily_losses: dict[str, float] = {}
    max_daily_loss_value = starting_balance * (daily_loss_limit_pct / 100.0)

    for trade in trades:
        day_bucket = _day_key(trade.entry_ts)
        day_loss = daily_losses.get(day_bucket, 0.0)
        if max_daily_loss_value > 0 and day_loss <= -max_daily_loss_value:
            continue  # pause trading for the remainder of the day

        stop_distance = trade.entry_price * (stop_pct / 100.0)
        min_stop_value = trade.entry_price * (MIN_STOP_DISTANCE_PCT / 100.0)
        stop_distance = max(stop_distance, min_stop_value)

        risk_amount = balance * (risk_pct / 100.0)
        if stop_distance <= 0 or risk_amount <= 0:
            continue

        qty = risk_amount / stop_distance
        price_move = (trade.exit_price - trade.entry_price) * trade.side
        gross_pnl = qty * price_move
        fee = abs(gross_pnl) * fee_pct if fee_pct > 0 else 0.0
        pnl = gross_pnl - fee

        balance += pnl
        day_loss += pnl
        daily_losses[day_bucket] = day_loss

        executed_trades.append(
            BacktestTrade(
                entry_ts=trade.entry_ts,
                exit_ts=trade.exit_ts,
                side=trade.side,
                entry_price=trade.entry_price,
                exit_price=trade.exit_price,
                pnl=float(pnl),
            )
        )

        equity_values.append(balance)
        equity_points.append(EquityPoint(ts=trade.exit_ts, equity=float(balance)))

    if not equity_points:
        equity_points = [EquityPoint(ts=first_ts, equity=starting_balance)]

    total_pnl = balance - starting_balance
    wins = sum(1 for t in executed_trades if t.pnl > 0)
    losses = sum(1 for t in executed_trades if t.pnl < 0)
    total_trades = wins + losses
    win_pct = (wins / total_trades) if total_trades > 0 else 0.0
    summary = BacktestSummary(
        starting_balance=float(starting_balance),
        ending_balance=float(balance),
        total_pnl=float(total_pnl),
        win_pct=float(win_pct),
        max_drawdown=float(_max_drawdown(equity_values)),
        sharpe_ratio=float(_sharpe_ratio(equity_values)),
    )

    return executed_trades, equity_points, summary


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/candles", response_model=CandleResponse)
async def get_candles(
    symbol: str = Query("BTCUSDT", description="e.g., BTCUSDT"),
    interval: Interval = Query("1m", description="1m | 5m | 1h | 1d"),
    limit: int = Query(500, ge=1, le=1000),
    start_ms: Optional[int] = Query(None, description="Unix ms"),
    end_ms: Optional[int] = Query(None, description="Unix ms"),
):
    """
    Fetch candles from Binance and normalize to CandleResponse.
    """
    s = symbol.upper()

    if s not in SYMBOL_WHITELIST:
        # You can relax this check, but it's helpful early on
        raise HTTPException(status_code=400, detail=f"Symbol not allowed: {s}")

    try:
        df = await fetch_klines(s, interval, limit=limit, start_ms=start_ms, end_ms=end_ms)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Binance fetch failed: {e}")

    records = [
        Candle(
            ts=int(row.ts),
            open=float(row.open),
            high=float(row.high),
            low=float(row.low),
            close=float(row.close),
            volume=float(row.volume),
        )
        for row in df.itertuples(index=False)
    ]

    note = None
    if len(records) == 0:
        note = "No data returned from Binance for the given parameters."

    return CandleResponse(
        symbol=s,
        interval=interval,
        count=len(records),
        candles=records,
        note=note,
    )


@app.post("/api/history/download", response_model=HistoryDownloadResponse)
async def download_history(req: HistoryDownloadRequest) -> HistoryDownloadResponse:
    """
    Download / refresh historical candles from Binance into backend/data/{symbol}_{interval}.csv.

    Mirrors the behavior of backend/fetch_history.py but exposed as an API for the UI.
    """
    symbol = req.symbol.upper()
    interval = req.interval
    limit = req.limit

    try:
        await fetch_and_save_history(symbol, interval, limit)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"History download failed: {e}")

    data_dir = Path(__file__).parent / "data"
    out_path = data_dir / f"{symbol}_{interval}.csv"

    if not out_path.exists():
        raise HTTPException(
            status_code=500,
            detail="Expected CSV file not found after download.",
        )

    try:
        df = pd.read_csv(out_path)
        rows = int(len(df))
        note = "OK"
    except Exception:
        rows = -1
        note = "Saved file, but could not read row count."

    return HistoryDownloadResponse(
        symbol=symbol,
        interval=interval,
        rows=rows,
        path=str(out_path),
        note=note,
    )


@app.post("/api/ai/signals", response_model=AiSignalsResponse)
async def get_ai_signals(req: AiSignalsRequest) -> AiSignalsResponse:
    """
    Generate per-bar placeholder AI signals from stored CSV history.

    Uses the rule-based helper in ml/ai_signals.py for now.
    """
    symbol = req.symbol.upper()
    interval = req.interval
    limit = req.limit

    try:
        signals = generate_ai_signals_from_csv(symbol, interval, limit)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e) + " – make sure you've run the History Downloader first.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"AI signal generation failed: {e}",
        )

    return AiSignalsResponse(
        symbol=symbol,
        interval=interval,
        signals=signals,
    )


@app.post("/api/model/predict", response_model=ModelPredictResponse)
async def model_predict(req: ModelPredictRequest) -> ModelPredictResponse:
    """
    Run the trained model on a batch of candles.

    The frontend should POST:
        {
          "symbol": "BTCUSDT",
          "interval": "1m",
          "candles": [ { "ts": ..., "open": ..., ... }, ... ],
          "params": { "threshold": 0.0015, "horizon": 5 }  # optional
        }
    """
    if not req.candles:
        raise HTTPException(status_code=400, detail="No candles provided.")

    # Convert candles to DataFrame
    df = pd.DataFrame([c.dict() for c in req.candles])

    # Let the model service handle feature building + prediction
    params_override = req.params.dict() if req.params else None
    raw_signals, meta = predict_signals_from_candles(df, params_override=params_override)

    signals = [ModelSignal(**s) for s in raw_signals]

    meta_obj = ModelPredictMeta(
        model_type=meta.get("model_type", "RandomForestClassifier"),
        model_version=meta.get("model_version", "rf_v1"),
        symbol_trained=meta.get("symbol_trained"),
        interval_trained=meta.get("interval_trained"),
        trained_at=meta.get("trained_at"),
        horizon=meta.get("horizon"),
        threshold=meta.get("threshold"),
        feature_cols=meta.get("feature_cols", []),
        params_override=meta.get("params_override"),
    )

    return ModelPredictResponse(signals=signals, meta=meta_obj)


@app.post("/api/backtest", response_model=BacktestResponse)
async def run_backtest_endpoint(req: BacktestRequest) -> BacktestResponse:
    """
    Run a backtest using historical CSV candles and the Bollinger strategy.

    Frontend sends:
        {
          "symbol": "BTCUSDT",
          "interval": "1m",
          "params": { "thr": 50, "tp": 100, "sl": 50, "walkForward": false },
          "starting_balance": 10000
        }
    """
    symbol = req.symbol
    interval = req.interval
    params = req.params

    starting_balance = (
        req.starting_balance if req.starting_balance is not None else DEFAULT_STARTING_BALANCE
    )
    fee_pct = req.fee if req.fee is not None else 0.0004
    risk_per_trade_pct = (
        req.risk_per_trade_percent
        if req.risk_per_trade_percent is not None
        else DEFAULT_RISK_PER_TRADE
    )
    max_daily_loss_pct = (
        req.max_daily_loss_percent
        if req.max_daily_loss_percent is not None
        else DEFAULT_MAX_DAILY_LOSS
    )


    # 1) Load candles from CSV
    data_path = Path(__file__).parent / "data" / f"{symbol}_{interval}.csv"
    if not data_path.exists():
        raise HTTPException(
            status_code=400,
            detail=f"Historical CSV not found: {data_path}",
        )

    df = pd.read_csv(data_path)
    expected_cols = ["ts", "open", "high", "low", "close", "volume"]
    missing = [c for c in expected_cols if c not in df.columns]
    if missing:
        raise HTTPException(
            status_code=500,
            detail=f"CSV missing columns: {missing}",
        )

    # 2) Pull TP / SL with defaults
    tp = params.tp if params and params.tp is not None else 100
    sl = params.sl if params and params.sl is not None else 50

    # 3) Run Bollinger backtest directly on candles (ignore model signals for now)
    trades_list, _ = bollinger_backtest(
        candles=df,
        tp_pct=tp,
        sl_pct=sl,
        initial_equity=starting_balance,
        fee_pct=fee_pct,
    )

    raw_trades = [
        BacktestTrade(
            entry_ts=t.entry_ts,
            exit_ts=t.exit_ts,
            side=t.side,
            entry_price=t.entry_price,
            exit_price=t.exit_price,
            pnl=t.pnl,
        )
        for t in trades_list
    ]

    first_ts = int(df["ts"].iloc[0]) if not df.empty else int(datetime.utcnow().timestamp() * 1000)

    trades, equity_curve, summary = apply_account_risk(
        trades=raw_trades,
        starting_balance=starting_balance,
        risk_per_trade_pct=risk_per_trade_pct,
        max_daily_loss_pct=max_daily_loss_pct,
        sl_pct=sl,
        fee_pct=fee_pct,
        first_ts=first_ts,
    )

    return BacktestResponse(
        summary=summary,
        equity_curve=equity_curve,
        trades=trades,
    )


