import numpy as np
import pandas as pd

# -------------------------
# Basic indicators
# -------------------------

def sma(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).mean()

def std(series: pd.Series, period: int) -> pd.Series:
    return series.rolling(period).std()

def rsi(series: pd.Series, period: int = 14) -> pd.Series:
    delta = series.diff()
    up = delta.clip(lower=0)
    down = -1 * delta.clip(upper=0)
    ma_up = up.rolling(period).mean()
    ma_down = down.rolling(period).mean()
    rs = ma_up / (ma_down + 1e-9)
    return 100 - (100 / (1 + rs))

# -------------------------
# Feature builder
# -------------------------

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add indicator columns for model training and inference.
    Keep it consistent so training = prediction.
    """
    out = df.copy()

    out["sma20"] = sma(out["close"], 20)
    out["sma50"] = sma(out["close"], 50)

    out["std20"] = std(out["close"], 20)
    out["upper_bb"] = out["sma20"] + 2 * out["std20"]
    out["lower_bb"] = out["sma20"] - 2 * out["std20"]

    out["rsi14"] = rsi(out["close"], 14)

    # Price position
    out["close_over_sma20"] = out["close"] / (out["sma20"] + 1e-9)

    # Volume normalization
    out["vol_z"] = (out["volume"] - out["volume"].rolling(20).mean()) / (
        out["volume"].rolling(20).std() + 1e-9
    )

    # Drop early NaNs
    out = out.dropna().reset_index(drop=True)

    return out
