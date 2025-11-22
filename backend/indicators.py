"""Indicator computation helpers built on pandas-ta-classic."""
from __future__ import annotations

import logging
from typing import Dict, List, Optional, TypedDict, Union

import pandas as pd

try:
    import pandas_ta_classic as ta
except ImportError as exc:  # pragma: no cover - hard failure path
    raise ImportError(
        "pandas-ta-classic is required. Install it with `pip install pandas-ta-classic`."
    ) from exc

logger = logging.getLogger(__name__)


class IndicatorSpec(TypedDict, total=False):
    """Specification for a single indicator calculation."""

    id: str
    kind: Optional[str]
    params: Dict[str, Union[float, int]]


def compute_indicators(df: pd.DataFrame, specs: List[IndicatorSpec]) -> pd.DataFrame:
    """Compute indicators described by *specs* on a copy of *df*."""
    if df is None:
        raise ValueError("df must be a pandas DataFrame")

    result = df.copy()
    if not specs:
        return result

    required_cols = {"open", "high", "low", "close", "volume", "ts"}
    if not required_cols.issubset(result.columns):
        missing = ", ".join(sorted(required_cols - set(result.columns)))
        raise ValueError(f"df missing required columns: {missing}")

    close = result["close"]

    for spec in specs:
        indicator_id = (spec.get("id") or "").lower()
        params: Dict[str, Union[float, int]] = spec.get("params", {}) or {}

        try:
            if indicator_id == "sma":
                length = int(params.get("length", 14))
                result[f"sma_{length}"] = ta.sma(close=close, length=length)

            elif indicator_id == "ema":
                length = int(params.get("length", 14))
                result[f"ema_{length}"] = ta.ema(close=close, length=length)

            elif indicator_id == "rsi":
                length = int(params.get("length", 14))
                result[f"rsi_{length}"] = ta.rsi(close=close, length=length)

            elif indicator_id == "macd":
                fast = int(params.get("fast", 12))
                slow = int(params.get("slow", 26))
                signal = int(params.get("signal", 9))
                macd_df = ta.macd(close=close, fast=fast, slow=slow, signal=signal)
                if macd_df is not None:
                    result["macd_line"] = macd_df.iloc[:, 0]
                    result["macd_signal"] = macd_df.iloc[:, 1]
                    result["macd_hist"] = macd_df.iloc[:, 2]

            elif indicator_id == "bbands":
                length = int(params.get("length", 20))
                std = float(params.get("std", 2.0))
                bbands_df = ta.bbands(close=close, length=length, std=std)
                if bbands_df is not None:
                    result[f"bb_lower_{length}_{std}"] = bbands_df.iloc[:, 0]
                    result[f"bb_middle_{length}_{std}"] = bbands_df.iloc[:, 1]
                    result[f"bb_upper_{length}_{std}"] = bbands_df.iloc[:, 2]

            else:
                logger.debug("Skipping unknown indicator id '%s'", indicator_id)

        except Exception as exc:  # pragma: no cover - defensive logging
            logger.warning("Indicator '%s' failed with error: %s", indicator_id, exc)

    return result
