from typing import Optional, List, Literal

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
    EquityPoint,
    BacktestSummary,
    HistoryDownloadRequest,
    HistoryDownloadResponse,
    AiSignalsRequest,
    AiSignalsResponse,
    Trade,
)
from binance_client import fetch_klines
from model_service import predict_signals_from_candles
from backtest import bollinger_backtest, load_candles_dataframe
from data_providers import CandleProvider, CsvCandleProvider

try:
    from .indicators import compute_indicators, IndicatorSpec
except ImportError:  # pragma: no cover - allow running as script
    from indicators import compute_indicators, IndicatorSpec  # type: ignore

try:
    from .ml.ai_signals import (
        generate_ai_signals_from_dataframe,
        load_ai_signal_candles,
    )
except ImportError:  # pragma: no cover - allow running as script
    from ml.ai_signals import (  # type: ignore
        generate_ai_signals_from_dataframe,
        load_ai_signal_candles,
    )


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
candle_provider: CandleProvider = CsvCandleProvider()

DataProvider = Literal["csv", "api"]

DEFAULT_CANDLES_PROVIDER: DataProvider = "api"
DEFAULT_BACKTEST_PROVIDER: DataProvider = "csv"


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
        description="Data source: 'api' (Binance live) or 'csv' (local history)",
    ),
):
    """
    Fetch candles from Binance or local CSV and normalize to CandleResponse.

    - provider='api' -> Binance (existing behaviour)
    - provider='csv' -> backend/data/{symbol}_{interval}.csv
    """
    s = symbol.upper()

    if s not in SYMBOL_WHITELIST:
        # You can relax this check, but it's helpful early on
        raise HTTPException(status_code=400, detail=f"Symbol not allowed: {s}")

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
            return CandleResponse(
                symbol=s,
                interval=interval,
                count=0,
                candles=[],
                note="No data found in CSV history for the given parameters.",
            )

        if limit > 0:
            df = df.tail(limit)
        df = df.sort_values("ts")
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

    note: Optional[str] = None
    if not records:
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
async def get_ai_signals(req: AiSignalsRequest) -> AiSignalsResponse:
    """
    Generate per-bar placeholder AI signals from stored CSV history.

    Uses the rule-based helper in ml/ai_signals.py for now.
    """
    symbol = req.symbol.upper()
    interval = req.interval
    limit = req.limit

    try:
        df = load_ai_signal_candles(symbol, interval, limit)
    except FileNotFoundError as e:
        raise HTTPException(
            status_code=404,
            detail=str(e) + " – make sure you've run the History Downloader first.",
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"AI signal history load failed: {e}",
        )

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

    try:
        signals = generate_ai_signals_from_dataframe(df)
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
async def run_backtest_endpoint(
    req: BacktestRequest,
    provider: DataProvider = Query(
        DEFAULT_BACKTEST_PROVIDER,
        description="Data source: 'csv' (local history) or 'api' (Binance live candles)",
    ),
) -> BacktestResponse:
    """
    Run a backtest using historical candles and the Bollinger strategy.

    - provider='csv' -> load from backend/data/{symbol}_{interval}.csv
    - provider='api' -> fetch candles from Binance on the fly
    """
    symbol = req.symbol.upper()
    interval = req.interval
    params = req.params

    starting_balance = (
        req.starting_balance if req.starting_balance is not None else DEFAULT_STARTING_BALANCE
    )
    fee_pct = req.fee if req.fee is not None else 0.0004

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
            raise HTTPException(
                status_code=400,
                detail="No candles returned by Binance for backtest.",
            )

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

    return BacktestResponse(summary=summary, equity_curve=equity_curve, trades=trades_list)


