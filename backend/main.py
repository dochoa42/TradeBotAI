from typing import Optional

from pathlib import Path

import pandas as pd
import numpy as np

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
    BacktestMetrics,
    ConfusionCounts,
    FeatureImportanceItem,
    HistoryDownloadRequest,
    HistoryDownloadResponse,
    AiSignalsRequest,
    AiSignalsResponse,
)
from binance_client import fetch_klines
from model_service import predict_signals_from_candles, get_model_and_meta
from backtest import bollinger_backtest, compute_metrics
from ml.ai_signals import generate_ai_signals_from_csv
from ml.backtest_engine import run_dual_backtest


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

    # Simulation config coming from the front-end
    initial_equity = (
        req.starting_balance if req.starting_balance is not None else 10_000.0
    )
    fee_pct = req.fee if req.fee is not None else 0.0004


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

    # 2) Pull TP / SL / starting balance from request, with defaults
    tp = params.tp if params and params.tp is not None else 100
    sl = params.sl if params and params.sl is not None else 50
    starting_equity = (
        req.starting_balance if req.starting_balance is not None else 10_000.0
    )

    # 3) Run Bollinger backtest directly on candles (ignore model signals for now)
    trades_list, equity_series = bollinger_backtest(
    candles=df,
    tp_pct=tp,
    sl_pct=sl,
    initial_equity=initial_equity,
    fee_pct=fee_pct,  # add this line if your bollinger_backtest takes fee_pct
    )


    # 4) Metrics from equity + trades
    metrics = compute_metrics(equity_series, trades_list)

    # 5) Convert trades to response objects
    trades = [
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

    # 6) Build equity curve points (align ts with equity index)
    eq_points: list[EquityPoint] = []
    eq_values = equity_series.values
    ts_vals = df["ts"].values
    eq_len = len(eq_values)

    for i in range(eq_len):
        ts_idx = min(i, len(ts_vals) - 1)  # clamp index
        eq_points.append(
            EquityPoint(ts=int(ts_vals[ts_idx]), equity=float(eq_values[i]))
        )

    metrics_obj = BacktestMetrics(
        win_rate=float(metrics["win_rate"]),
        profit_factor=float(metrics["profit_factor"]),
        sharpe=float(metrics["sharpe"]),
        max_drawdown=float(metrics["max_drawdown"]),
    )

    # 7) Confusion + feature importance from training metadata (unchanged)
    model_obj, model_meta = get_model_and_meta()
    cm_list = model_meta.get("confusion_matrix", [[0, 0, 0], [0, 0, 0], [0, 0, 0]])

    cm = np.array(cm_list)
    tp_cm = int(cm[2, 2])
    fn = int(cm[2, 0] + cm[2, 1])
    fp_cm = int(cm[0, 2] + cm[1, 2])
    total = int(cm.sum())
    tn = int(total - tp_cm - fn - fp_cm)

    confusion_obj = ConfusionCounts(tp=tp_cm, fp=fp_cm, tn=tn, fn=fn)

    feat_imp_raw = model_meta.get("feature_importance", [])
    feat_imp = [
        FeatureImportanceItem(name=fi["name"], importance=float(fi["importance"]))
        for fi in feat_imp_raw
    ]

    strategies_pair = run_dual_backtest(req)

    return BacktestResponse(
        trades=trades,
        equity_curve=eq_points,
        metrics=metrics_obj,
        confusion=confusion_obj,
        feature_importance=feat_imp,
        strategies=strategies_pair,
    )


