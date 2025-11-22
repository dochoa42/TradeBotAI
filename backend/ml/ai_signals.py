from pathlib import Path
from typing import Dict, List

import pandas as pd
from pandas.api.types import is_numeric_dtype

# ml/ai_signals.py -> parent is backend/, data/ is next to it
BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"


def _guess_column(df: pd.DataFrame, candidates: List[str], numeric: bool = False) -> str | None:
    """
    Try to find a column whose name matches one of `candidates` (case-insensitive),
    or contains one of those tokens as a substring. If `numeric=True`, will fall
    back to any numeric column if no name match is found.
    """
    # map lowercase -> original
    lower_map = {c.lower(): c for c in df.columns}

    # 1) direct lowercase match
    for cand in candidates:
        cand_l = cand.lower()
        if cand_l in lower_map:
            return lower_map[cand_l]

    # 2) substring match (e.g. "close_price", "timestamp_ms")
    for col in df.columns:
        name = col.lower().replace(" ", "")
        for cand in candidates:
            if cand.lower() in name:
                return col

    # 3) fallback: any numeric column (for close), if requested
    if numeric:
        num_cols = df.select_dtypes(include="number").columns
        if len(num_cols) > 0:
            # use the last numeric column (often "close" or similar in OHLCV)
            return num_cols[-1]

    return None


def _load_candles(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    symbol = symbol.upper()
    csv_path = DATA_DIR / f"{symbol}_{interval}.csv"

    if not csv_path.exists():
        raise FileNotFoundError(f"CSV not found: {csv_path}")

    df = pd.read_csv(csv_path)

    # Keep only the last <limit> rows
    if limit > 0:
        df = df.tail(limit).copy()

    # --- figure out timestamp and close columns ---
    # Common timestamp-style names:
    ts_candidates = [
        "open_time",
        "opentime",
        "timestamp",
        "time",
        "t",
        "date",
        "datetime",
        "kline_open_time",
    ]

    # Common close-style names:
    close_candidates = [
        "close",
        "c",
        "closeprice",
        "closing_price",
        "price",
    ]

    ts_col = _guess_column(df, ts_candidates, numeric=False)
    close_col = _guess_column(df, close_candidates, numeric=True)

    if ts_col is None or close_col is None:
        raise ValueError(
            f"Could not identify timestamp/close columns in {csv_path}. "
            f"Columns found: {list(df.columns)}"
        )

    # Normalize timestamp to integer milliseconds
    ts_series = df[ts_col]

    if is_numeric_dtype(ts_series):
        # assume already milliseconds or similar
        df["ts"] = ts_series.astype("int64")
    else:
        # parse to datetime and convert to ms since epoch
        dt = pd.to_datetime(ts_series, errors="coerce")
        if dt.isna().all():
            raise ValueError(
                f"Timestamp column '{ts_col}' in {csv_path} could not be parsed as datetime."
            )
        df["ts"] = (dt.view("int64") // 10**6)  # ns -> ms

    # Basic SMA + Bollinger bands to drive a *placeholder* AI logic
    close_series = df[close_col].astype("float64")

    df["sma20"] = close_series.rolling(20).mean()
    df["std20"] = close_series.rolling(20).std()
    df["upper"] = df["sma20"] + 2 * df["std20"]
    df["lower"] = df["sma20"] - 2 * df["std20"]

    return df


def load_ai_signal_candles(symbol: str, interval: str, limit: int) -> pd.DataFrame:
    """Public wrapper so API routes can reuse the candle loader."""

    return _load_candles(symbol, interval, limit)


def generate_ai_signals_from_dataframe(df: pd.DataFrame) -> List[Dict]:
    """Build AI signals from a prepared candle dataframe."""

    signals: List[Dict] = []

    for row in df.itertuples():
        close = getattr(row, "close", None)
        if close is None:
            close = getattr(row, "close_series", None)

        upper = getattr(row, "upper", None)
        lower = getattr(row, "lower", None)
        ts = getattr(row, "ts", None)

        if ts is None:
            continue

        if pd.isna(upper) or pd.isna(lower):
            side = "flat"
            p_long, p_short, p_flat = 0.33, 0.33, 0.34
        elif close is not None and close < lower:
            side = "long"
            p_long, p_short, p_flat = 0.8, 0.1, 0.1
        elif close is not None and close > upper:
            side = "short"
            p_long, p_short, p_flat = 0.1, 0.8, 0.1
        else:
            side = "flat"
            p_long, p_short, p_flat = 0.2, 0.2, 0.6

        signals.append(
            {
                "ts": int(ts),
                "side": side,
                "prob_long": float(p_long),
                "prob_short": float(p_short),
                "prob_flat": float(p_flat),
            }
        )

    return signals


def generate_ai_signals_from_csv(symbol: str, interval: str, limit: int) -> List[Dict]:
    """
    Placeholder 'AI' logic:
      - If price < lower band  -> strongly long
      - If price > upper band  -> strongly short
      - Otherwise               -> flat

    Returns list[dict] shaped to AiSignal in models.py.
    """
    df = _load_candles(symbol, interval, limit)
    return generate_ai_signals_from_dataframe(df)
