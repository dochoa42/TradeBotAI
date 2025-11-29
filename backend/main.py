from typing import Optional, List

from pathlib import Path
from datetime import datetime
from math import sqrt
import json

import joblib
import numpy as np
import pandas as pd

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fetch_history import fetch_and_save as fetch_and_save_history


from models import (
    Candle,
    CandleResponse,
    Interval,
    DataProvider,
    ModelPredictRequest,
    ModelPredictResponse,
    ModelSignal,
    ModelPredictMeta,
    BacktestRequest,
    BacktestResponse,
    EquityPoint,
    BacktestSummary,
    HistoryDownloadRequest,
    HistoryDownloadResponse,
    AiSignalsRequest,
    AiSignalsResponse,
    Trade,
)
from binance_client import fetch_klines
from alpaca_client import fetch_alpaca_bars
from model_service import predict_signals_from_candles
from backtest import bollinger_backtest, load_candles_dataframe
from candle_adapters import (
    from_alpaca_bars,
    from_binance_klines,
    from_csv_rows,
)
from data_providers import CandleProvider, CsvCandleProvider
from live_trading import router as live_router
from strategy_library import router as strategy_library_router
from storage import record_backtest_run

try:
    from .indicators import compute_indicators, IndicatorSpec
except ImportError:  # pragma: no cover - allow running as script
    from indicators import compute_indicators, IndicatorSpec  # type: ignore


app = FastAPI(title="Trading Bot 2 Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(live_router)
app.include_router(strategy_library_router)

# Simple whitelist for safety (expand as needed)
CRYPTO_SYMBOL_WHITELIST: set[str] = {
    "BTCUSDT",
    "ETHUSDT",
    "BNBUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "ADAUSDT",
    "DOGEUSDT",
    "AVAXUSDT",
}

ALPACA_SYMBOL_WHITELIST: set[str] = {
    "AAPL",
    "MSFT",
    "SPY",
    "QQQ",
    "TSLA",
    "NVDA",
    "META",
    "AMZN",
}

DEFAULT_STARTING_BALANCE = 2_000.0
candle_provider: CandleProvider = CsvCandleProvider()

DEFAULT_CANDLES_PROVIDER: DataProvider = "api"
DEFAULT_BACKTEST_PROVIDER: DataProvider = "csv"

MODEL_PATH = Path(__file__).parent / "models" / "model_v1.pkl"
ai_model: object | None = None
ai_feature_cols: list[str] | None = None


def _normalize_symbol(raw_symbol: str, provider: DataProvider) -> str:
    """Uppercase symbols and drop unsupported characters per provider."""

    normalized = raw_symbol.upper().strip()
    if provider == "alpaca":
        normalized = normalized.replace("/", "")
    return normalized


def _validate_symbol(symbol: str, provider: DataProvider) -> None:
    """Ensure the requested symbol is allowed for the provider."""

    if provider == "alpaca":
        if ALPACA_SYMBOL_WHITELIST and symbol not in ALPACA_SYMBOL_WHITELIST:
            raise HTTPException(
                status_code=400,
                detail=f"Symbol not allowed for Alpaca provider: {symbol}",
            )
    else:
        if symbol not in CRYPTO_SYMBOL_WHITELIST:
            raise HTTPException(status_code=400, detail=f"Symbol not allowed: {symbol}")


def load_ai_model() -> None:
    """Load the trained AI model into global state."""

    global ai_model, ai_feature_cols

    if not MODEL_PATH.exists():
        ai_model = None
        ai_feature_cols = None
        print(f"[AI] No model found at {MODEL_PATH}; /api/ai/signals will return 503.")
        return

    try:
        payload = joblib.load(MODEL_PATH)
    except Exception as exc:  # pragma: no cover - defensive logging
        ai_model = None
        ai_feature_cols = None
        print(f"[AI] Failed to load model from {MODEL_PATH}: {exc}")
        return

    ai_model = payload.get("model")
    feature_cols = payload.get("feature_cols")
    ai_feature_cols = list(feature_cols) if isinstance(feature_cols, list) else None

    if ai_model is None or ai_feature_cols is None:
        print(
            f"[AI] Model payload at {MODEL_PATH} is missing required keys; /api/ai/signals will return 503."
        )
    else:
        print(
            f"[AI] Loaded model from {MODEL_PATH} with {len(ai_feature_cols)} feature columns."
        )


@app.on_event("startup")
async def startup_event() -> None:
    load_ai_model()


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


def _equity_curve_from_series(candles: pd.DataFrame, equity: pd.Series) -> List[EquityPoint]:
    ts_values = candles["ts"].astype(int).tolist() if not candles.empty else []
    eq_values = equity.astype(float).tolist()
    if not eq_values:
        return []

    curve: List[EquityPoint] = []
    for idx, value in enumerate(eq_values):
        ts_idx = min(idx, len(ts_values) - 1) if ts_values else 0
        ts = ts_values[ts_idx] if ts_values else 0
        curve.append(EquityPoint(ts=int(ts), equity=float(value)))
    return curve


def _build_backtest_summary(
    equity: pd.Series,
    trades: List[Trade],
    starting_balance: float,
) -> BacktestSummary:
    equity_values = equity.astype(float).tolist()
    if not equity_values:
        equity_values = [float(starting_balance)]

    ending_balance = equity_values[-1]
    total_pnl = ending_balance - starting_balance
    total_trades = len(trades)
    wins = sum(1 for t in trades if t.pnl > 0)
    win_pct = (wins / total_trades) if total_trades > 0 else 0.0

    return BacktestSummary(
        starting_balance=float(starting_balance),
        ending_balance=float(ending_balance),
        total_pnl=float(total_pnl),
        win_pct=float(win_pct),
        max_drawdown=float(_max_drawdown(equity_values)),
        sharpe_ratio=float(_sharpe_ratio(equity_values)),
    )


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
    provider: DataProvider = Query(
        DEFAULT_CANDLES_PROVIDER,
        description=(
            "Data source: 'api' (Binance live), 'csv' (local history), or 'alpaca' "
            "(Alpaca Market Data v2)"
        ),
    ),
):
    """
    Fetch candles from Binance or local CSV and normalize to CandleResponse.

    - provider='api' -> Binance (existing behaviour)
    - provider='csv' -> backend/data/{symbol}_{interval}.csv
    - provider='alpaca' -> Alpaca Market Data v2
    """
    s = _normalize_symbol(symbol, provider)
    _validate_symbol(s, provider)

    records: List[Candle] = []
    note: Optional[str] = None

    # provider = 'csv' -> read from backend/data/{symbol}_{interval}.csv
    if provider == "csv":
        data_dir = Path(__file__).parent / "data"
        csv_path = data_dir / f"{s}_{interval}.csv"

        if not csv_path.exists():
            raise HTTPException(
                status_code=404,
                detail=(
                    f"CSV history not found for {s} {interval}. "
                    "Use /api/history/download to fetch it first."
                ),
            )

        try:
            df = pd.read_csv(csv_path)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Unable to read candles from {csv_path}: {exc}",
            ) from exc

        if df.empty:
            note = "No data found in CSV history for the given parameters."
            records = []
        else:
            if limit > 0:
                df = df.tail(limit)
            df = df.sort_values("ts")
            records = from_csv_rows(df)
    elif provider == "alpaca":
        try:
            df = await fetch_alpaca_bars(s, interval, limit=limit)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Alpaca configuration error: {exc}",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Alpaca fetch failed: {exc}",
            ) from exc

        if df.empty:
            note = "Alpaca returned no bars for the requested symbol/interval."
        records = from_alpaca_bars(df if not df.empty else pd.DataFrame())
    else:
        # provider = 'api' -> existing Binance flow
        try:
            df = await fetch_klines(
                s, interval, limit=limit, start_ms=start_ms, end_ms=end_ms
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Binance fetch failed: {exc}",
            ) from exc

        records = from_binance_klines(df if not df.empty else pd.DataFrame())
        if df.empty:
            note = "No data returned for the given parameters."

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
async def get_ai_signals(
    req: AiSignalsRequest,
    provider: DataProvider = Query(
        DEFAULT_CANDLES_PROVIDER,
        description=(
            "Data source: 'api' (Binance live), 'csv' (local history), or 'alpaca' "
            "(Alpaca Market Data v2)"
        ),
    ),
) -> AiSignalsResponse:
    """Serve AI signals using the trained model payload."""

    symbol = _normalize_symbol(req.symbol, provider)
    interval = req.interval

    # 1) Load candles based on provider (mirrors /api/backtest)
    if provider == "csv":
        try:
            df = load_candles_dataframe(
                symbol,
                interval,
                limit=req.limit,
                provider=CsvCandleProvider(),
            )
        except FileNotFoundError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load candles for AI signals: {exc}",
            ) from exc
    elif provider == "api":
        try:
            df = await fetch_klines(
                symbol,
                interval,
                limit=req.limit or 500,
                start_ms=None,
                end_ms=None,
            )
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Binance fetch failed for AI signals: {exc}",
            ) from exc

        if df.empty:
            raise HTTPException(
                status_code=400,
                detail="No candles returned by Binance for AI signals.",
            )
    elif provider == "alpaca":
        try:
            df = await fetch_alpaca_bars(symbol, interval, limit=req.limit or 500)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Alpaca configuration error: {exc}",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Alpaca fetch failed for AI signals: {exc}",
            ) from exc

        if df.empty:
            raise HTTPException(
                status_code=400,
                detail="No candles returned by Alpaca for AI signals.",
            )
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    if df.empty:
        raise HTTPException(
            status_code=400,
            detail="No candles available for AI signals.",
        )

    # 2) Indicators (unchanged)
    indicator_specs: List[IndicatorSpec] = req.indicators or []
    if indicator_specs:
        try:
            df = compute_indicators(df, indicator_specs)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Indicator calculation failed: {exc}",
            ) from exc

    # 3) Model checks + inference (unchanged)
    if ai_model is None or ai_feature_cols is None:
        raise HTTPException(
            status_code=503,
            detail="AI model not loaded. Train a model_v1.pkl first.",
        )

    missing = [col for col in ai_feature_cols if col not in df.columns]
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing feature columns for AI model: {missing}",
        )

    feature_frame = df[ai_feature_cols].replace([np.inf, -np.inf], np.nan)
    valid_mask = feature_frame.notna().all(axis=1)
    feature_frame = feature_frame.loc[valid_mask]
    df = df.loc[valid_mask].reset_index(drop=True)

    if feature_frame.empty:
        raise HTTPException(
            status_code=400,
            detail="Not enough data after indicator warmup for AI signals.",
        )

    X = feature_frame.to_numpy(dtype=float)

    try:
        if hasattr(ai_model, "predict_proba"):
            proba = ai_model.predict_proba(X)
            if proba.ndim != 2 or proba.shape[1] < 2:
                raise ValueError("Model predict_proba did not return two classes")
            confidences = proba[:, 1]
            preds = (confidences >= 0.5).astype(int)
        else:
            preds = ai_model.predict(X)
            confidences = np.ones_like(preds, dtype=float)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"AI model inference failed: {exc}"
        ) from exc

    signals = [
        {
            "ts": int(df["ts"].iloc[i]),
            "signal": int(preds[i]),
            "confidence": float(confidences[i]),
        }
        for i in range(len(df))
    ]

    return AiSignalsResponse(symbol=symbol, interval=interval, signals=signals)


@app.post("/api/model/predict", response_model=ModelPredictResponse)
async def model_predict(req: ModelPredictRequest) -> ModelPredictResponse:
    """
    Run the trained model on a batch of candles.

    The frontend should POST:
        {
          "symbol": "BTCUSDT",
          "interval": "1m",
          "candles": [ { "time": ..., "open": ..., ... }, ... ],
          "params": { "threshold": 0.0015, "horizon": 5 }  # optional
        }
    """
    if not req.candles:
        raise HTTPException(status_code=400, detail="No candles provided.")

    # Convert candles to DataFrame
    df = pd.DataFrame([c.dict() for c in req.candles])
    if "ts" not in df.columns and "time" in df.columns:
        df = df.rename(columns={"time": "ts"})

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
async def run_backtest_endpoint(
    req: BacktestRequest,
    provider: DataProvider = Query(
        DEFAULT_BACKTEST_PROVIDER,
        description=(
            "Data source: 'csv' (local history), 'api' (Binance live candles), or 'alpaca' "
            "(Alpaca Market Data v2)"
        ),
    ),
) -> BacktestResponse:
    """
    Run a backtest using historical candles and the Bollinger strategy.

    - provider='csv' -> load from backend/data/{symbol}_{interval}.csv
    - provider='api' -> fetch candles from Binance on the fly
    """
    symbol = _normalize_symbol(req.symbol, provider)
    interval = req.interval
    params = req.params

    starting_balance = (
        req.starting_balance if req.starting_balance is not None else DEFAULT_STARTING_BALANCE
    )
    fee_pct = req.fee if req.fee is not None else 0.0004

    empty_note: Optional[str] = None

    # 1) Load candles via the selected provider
    if provider == "csv":
        try:
            df = load_candles_dataframe(symbol, interval, limit=0, provider=candle_provider)
        except FileNotFoundError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - surfaced via API response
            raise HTTPException(
                status_code=500,
                detail=f"Failed to load candles: {exc}",
            ) from exc
    elif provider == "alpaca":
        try:
            df = await fetch_alpaca_bars(symbol, interval, limit=1000)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Alpaca configuration error: {exc}",
            ) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Alpaca fetch failed for backtest: {exc}",
            ) from exc

        if df.empty:
            empty_note = "No Alpaca bars available for the requested window."
    else:
        try:
            # limit=1000 is a reasonable default; tune later if needed
            df = await fetch_klines(symbol, interval, limit=1000, start_ms=None, end_ms=None)
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail=f"Binance fetch failed for backtest: {exc}",
            ) from exc

        if df.empty:
            empty_note = "No candles returned by Binance for backtest."

    indicator_specs: List[IndicatorSpec] = req.indicators or []
    if indicator_specs:
        try:
            df = compute_indicators(df, indicator_specs)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Indicator calculation failed: {exc}",
            ) from exc

    if df.empty:
        return _build_empty_backtest_response(
            starting_balance=starting_balance,
            note=empty_note or "No candles available for the requested window.",
        )

    # 2) Pull TP / SL with defaults
    tp = params.tp if params and params.tp is not None else 100
    sl = params.sl if params and params.sl is not None else 50

    # 3) Run Bollinger backtest directly on candles
    trades_list, equity_series = bollinger_backtest(
        candles=df,
        tp_pct=tp,
        sl_pct=sl,
        initial_equity=starting_balance,
        fee_pct=fee_pct,
        symbol=symbol,
    )

    equity_curve = _equity_curve_from_series(df, equity_series)
    if not equity_curve:
        fallback_ts = int(df["ts"].iloc[0]) if not df.empty else int(
            datetime.utcnow().timestamp() * 1000
        )
        equity_curve = [EquityPoint(ts=fallback_ts, equity=float(starting_balance))]

    summary = _build_backtest_summary(equity_series, trades_list, starting_balance)

    response = BacktestResponse(summary=summary, equity_curve=equity_curve, trades=trades_list)

    params_json: Optional[str] = None
    if params is not None:
        try:
            params_json = json.dumps(params.dict())
        except (TypeError, ValueError):
            params_json = None

    strategy_name = (req.strategy_name or "-").strip() or "-"

    try:
        record_backtest_run(
            symbol=symbol,
            strategy_name=strategy_name,
            interval=interval,
            params_json=params_json,
            result=response,
        )
    except Exception as exc:  # pragma: no cover - persistence errors shouldn't break API
        print(f"[storage] Failed to persist backtest run: {exc}")

    return response


def _build_empty_backtest_response(
    starting_balance: float,
    note: str,
) -> BacktestResponse:
    empty_summary = BacktestSummary(
        starting_balance=float(starting_balance),
        ending_balance=float(starting_balance),
        total_pnl=0.0,
        win_pct=0.0,
        max_drawdown=0.0,
        sharpe_ratio=0.0,
    )
    return BacktestResponse(
        summary=empty_summary,
        equity_curve=[],
        trades=[],
        note=note,
    )

