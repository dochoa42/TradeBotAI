from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Dict, Tuple, Any

import pandas as pd

from feature_engineering import build_features

# cache: key -> {"model": ..., "meta": ...}
_MODEL_CACHE: Dict[str, Dict[str, Any]] = {}


def _load_model(key: str) -> Tuple[Any, Dict[str, Any]]:
    """
    Internal helper: load model + meta for a given key (e.g. "rf_BTCUSDT_1m").
    """
    models_dir = Path(__file__).parent / "models"
    pkl_path = models_dir / f"{key}.pkl"
    meta_path = models_dir / f"{key}.meta.json"

    if not pkl_path.exists() or not meta_path.exists():
        raise FileNotFoundError(f"Model files not found for key '{key}'")

    with open(pkl_path, "rb") as f:
        model = pickle.load(f)
    with open(meta_path, "r") as f:
        meta = json.load(f)

    _MODEL_CACHE[key] = {"model": model, "meta": meta}
    return model, meta


def get_model_and_meta() -> Tuple[Any, Dict[str, Any]]:
    """
    Load the first trained model that has BOTH .pkl and .meta.json.
    (Skips old demo files like model_rf_v1.pkl that lack metadata.)
    """
    # If we already loaded something, just return it
    if _MODEL_CACHE:
        key = next(iter(_MODEL_CACHE.keys()))
        m = _MODEL_CACHE[key]
        return m["model"], m["meta"]

    models_dir = Path(__file__).parent / "models"

    # Look for any model that has a matching .meta.json
    for pkl in models_dir.glob("*.pkl"):
        key = pkl.stem
        meta_path = models_dir / f"{key}.meta.json"
        if not meta_path.exists():
            # skip old models without metadata, e.g. model_rf_v1.pkl
            continue
        return _load_model(key)

    raise RuntimeError("No trained models with metadata found in backend/models.")


def predict_signals_from_candles(
    df: pd.DataFrame,
    params_override: dict | None = None,
):
    """
    Convert raw candles -> features -> model predictions -> signal list.
    """
    model, meta = get_model_and_meta()
    feature_cols = meta.get("feature_cols", [])

    df_feat = build_features(df)

    if not feature_cols:
        raise RuntimeError("Model meta is missing 'feature_cols'.")

    X = df_feat[feature_cols].values
    preds = model.predict(X)

    signals = []
    for i, row in df_feat.iterrows():
        signals.append(
            {
                "ts": int(row["ts"]),
                "signal": int(preds[i]),
            }
        )

    # We just return meta as-is; backend/main.py converts it into the Pydantic response.
    return signals, meta
