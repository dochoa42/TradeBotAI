# features.py
"""
Feature engineering for the trading model.

Training entrypoint:
    X, y, meta = build_features(df, horizon=5, threshold=0.0015)

Inference entrypoint:
    X_inf, ts_inf = build_features_for_inference(df, feature_cols)

Where df has columns:
    ts, open, high, low, close, volume
"""

from __future__ import annotations

from typing import Dict, Tuple, List

import numpy as np
import pandas as pd


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    """Classic RSI implementation."""
    delta = close.diff()
    gain = np.where(delta > 0, delta, 0.0)
    loss = np.where(delta < 0, -delta, 0.0)

    gain = pd.Series(gain, index=close.index)
    loss = pd.Series(loss, index=close.index)

    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()

    rs = avg_gain / (avg_loss.replace(0, np.nan))
    rsi = 100 - (100 / (1 + rs))
    return rsi


def _add_base_features(df_raw: pd.DataFrame) -> pd.DataFrame:
    """
    Compute all feature columns on a copy of the raw candles DataFrame.
    Does NOT create targets.
    """
    df = df_raw.copy().reset_index(drop=True)

    required_cols = ["ts", "open", "high", "low", "close", "volume"]
    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        raise ValueError(f"_add_base_features: missing columns {missing}")

    # Convert ts to datetime (UTC) for time-based features
    dt = pd.to_datetime(df["ts"], unit="ms", utc=True)
    df["hour"] = dt.dt.hour
    df["minute"] = dt.dt.minute

    # 1-bar returns
    df["ret_1"] = df["close"].pct_change()

    # Rolling volatility of returns (10-bar)
    df["vol_10"] = df["ret_1"].rolling(window=10, min_periods=10).std()

    # Simple SMAs
    df["sma_20"] = df["close"].rolling(window=20, min_periods=20).mean()
    df["sma_50"] = df["close"].rolling(window=50, min_periods=50).mean()

    # Distance from SMA
    df["close_over_sma20"] = df["close"] / df["sma_20"] - 1.0
    df["close_over_sma50"] = df["close"] / df["sma_50"] - 1.0

    # RSI
    df["rsi_14"] = _compute_rsi(df["close"], period=14)

    # Volume z-score (20-bar)
    vol_mean = df["volume"].rolling(window=20, min_periods=20).mean()
    vol_std = df["volume"].rolling(window=20, min_periods=20).std()
    df["vol_z"] = (df["volume"] - vol_mean) / vol_std.replace(0, np.nan)

    return df


def build_features(
    df_raw: pd.DataFrame,
    horizon: int = 5,
    threshold: float = 0.0015,
) -> Tuple[pd.DataFrame, pd.Series, Dict]:
    """
    Build features X and target y from a candles DataFrame for TRAINING.

    Parameters
    ----------
    df_raw : DataFrame
        Columns: ts, open, high, low, close, volume
    horizon : int
        Number of bars to look ahead for the target.
    threshold : float
        Return threshold for labeling:
            y =  1 if future_return >  threshold
            y = -1 if future_return < -threshold
            y =  0 otherwise

    Returns
    -------
    X : DataFrame
        Engineered features.
    y : Series
        Targets (-1, 0, 1).
    meta : dict
        Metadata about the build (feature names, horizon, threshold, etc.).
    """
    df = _add_base_features(df_raw)

    # --- Target: future return over 'horizon' bars ---
    future_close = df["close"].shift(-horizon)
    future_ret = (future_close / df["close"]) - 1.0
    df["future_ret"] = future_ret

    # Label
    cond_long = df["future_ret"] > threshold
    cond_short = df["future_ret"] < -threshold

    y = pd.Series(0, index=df.index, dtype=int)
    y = y.mask(cond_long, 1)
    y = y.mask(cond_short, -1)

    # Feature columns to use (order matters)
    feature_cols = [
        "ret_1",
        "vol_10",
        "sma_20",
        "sma_50",
        "close_over_sma20",
        "close_over_sma50",
        "rsi_14",
        "vol_z",
        "hour",
        "minute",
    ]

    X = df[feature_cols].copy()

    # Drop rows with NaNs or missing future_ret
    bad_mask = X.isna().any(axis=1) | df["future_ret"].isna()
    X = X[~bad_mask]
    y = y[~bad_mask]

    meta = {
        "horizon": int(horizon),
        "threshold": float(threshold),
        "feature_cols": feature_cols,
        "n_samples": int(len(X)),
    }

    return X, y, meta


def build_features_for_inference(
    df_raw: pd.DataFrame,
    feature_cols: List[str],
) -> Tuple[pd.DataFrame, pd.Series]:
    """
    Build ONLY feature matrix X for INFERENCE.

    Parameters
    ----------
    df_raw : DataFrame
        Raw candles with ts, open, high, low, close, volume.
    feature_cols : list of str
        Column names to extract as features (should match training).

    Returns
    -------
    X : DataFrame
        Features (rows with NaNs dropped).
    ts : Series
        Corresponding timestamps (same index as X).
    """
    df = _add_base_features(df_raw)

    X = df[feature_cols].copy()
    ts = df["ts"].copy()

    bad_mask = X.isna().any(axis=1)
    X = X[~bad_mask]
    ts = ts[~bad_mask]

    return X, ts
