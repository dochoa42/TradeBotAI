# train_model.py — Layer A
# ========================
# Usage:
#   .venv\Scripts\python.exe train_model.py BTCUSDT 1m

import json
import argparse
from pathlib import Path
import pandas as pd
import numpy as np

from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import confusion_matrix

from feature_engineering import build_features


def train(symbol: str, interval: str):
    data_path = Path(__file__).parent / "data" / f"{symbol}_{interval}.csv"
    if not data_path.exists():
        raise FileNotFoundError(f"CSV not found: {data_path}")

    print(f"[TRAIN] Loading {data_path}")
    df = pd.read_csv(data_path)

    # -------------------------
    # 1. FEATURE BUILDING
    # -------------------------
    df_feat = build_features(df)

    # -------------------------
    # 2. LABEL CREATION
    # -------------------------
    # Horizon = 5 bars future return
    df_feat["future_close"] = df_feat["close"].shift(-5)
    df_feat.dropna(inplace=True)

    df_feat["future_ret"] = (df_feat["future_close"] - df_feat["close"]) / df_feat["close"]

    # Label:
    # +1 if return > +0.1%
    # -1 if return < -0.1%
    #  0 otherwise
    df_feat["label"] = 0
    df_feat.loc[df_feat["future_ret"] > 0.001, "label"] = 1
    df_feat.loc[df_feat["future_ret"] < -0.001, "label"] = -1

    feature_cols = [
        "sma20", "sma50", "std20", "upper_bb", "lower_bb",
        "rsi14", "close_over_sma20", "vol_z"
    ]

    X = df_feat[feature_cols].values
    y = df_feat["label"].values

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.25, shuffle=False
    )

    print("[TRAIN] Training RandomForestClassifier...")
    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=6,
        min_samples_leaf=20,
        random_state=42
    )
    model.fit(X_train, y_train)

    # -------------------------
    # 3. METRICS
    # -------------------------
    preds = model.predict(X_test)
    cm = confusion_matrix(y_test, preds, labels=[-1, 0, 1])

    print("[TRAIN] Confusion matrix:")
    print(cm)

    # Feature importance
    fi = model.feature_importances_
    fi_list = [{"name": c, "importance": float(v)} for c, v in zip(feature_cols, fi)]

    # -------------------------
    # 4. SAVE MODEL
    # -------------------------
    models_dir = Path(__file__).parent / "models"
    models_dir.mkdir(exist_ok=True)

    pkl_path = models_dir / f"rf_{symbol}_{interval}.pkl"
    meta_path = models_dir / f"rf_{symbol}_{interval}.meta.json"

    import pickle
    with open(pkl_path, "wb") as f:
        pickle.dump(model, f)

    meta = {
        "model_type": "RandomForestClassifier",
        "model_version": f"rf_{symbol}_{interval}",
        "symbol_trained": symbol,
        "interval_trained": interval,
        "feature_cols": feature_cols,
        "confusion_matrix": cm.tolist(),
        "trained_at": pd.Timestamp.utcnow().isoformat(),
    }

    with open(meta_path, "w") as f:
        json.dump(meta, f, indent=2)

    print(f"[TRAIN] Saved model → {pkl_path}")
    print(f"[TRAIN] Saved meta  → {meta_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("symbol")
    parser.add_argument("interval")
    args = parser.parse_args()
    train(args.symbol.upper(), args.interval)
