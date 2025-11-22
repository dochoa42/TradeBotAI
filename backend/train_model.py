"""Offline training script for datasets produced by build_dataset.py."""

from __future__ import annotations

import argparse
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
from sklearn.model_selection import train_test_split


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train a RandomForest model on a dataset.")
    parser.add_argument(
        "--dataset",
        required=True,
        help="Path to a parquet dataset produced by build_dataset.py",
    )
    parser.add_argument(
        "--model-out",
        default="models/model_v1.pkl",
        help="Output path for the trained model payload",
    )
    return parser.parse_args()


def _load_dataset(dataset_path: str) -> tuple[np.ndarray, np.ndarray, list[str]]:
    df = pd.read_parquet(dataset_path)
    if "label" not in df.columns:
        raise ValueError("Dataset must contain a 'label' column")

    feature_cols = [col for col in df.columns if col != "label"]
    if not feature_cols:
        raise ValueError("Dataset must contain at least one feature column")

    X = df[feature_cols].values
    y = df["label"].values
    return X, y, feature_cols


def _train_model(X: np.ndarray, y: np.ndarray) -> tuple[RandomForestClassifier, np.ndarray, np.ndarray]:
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, shuffle=False
    )

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    return model, y_test, y_pred


def _print_metrics(y_test: np.ndarray, y_pred: np.ndarray) -> None:
    acc = accuracy_score(y_test, y_pred)
    print(f"Accuracy: {acc:.4f}")
    print("\nClassification report:")
    print(classification_report(y_test, y_pred))
    print("Confusion matrix:")
    print(confusion_matrix(y_test, y_pred))


def _save_model(model: RandomForestClassifier, feature_cols: list[str], out_path: str) -> Path:
    path = Path(out_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model,
        "feature_cols": feature_cols,
    }
    joblib.dump(payload, path)
    return path


def main() -> None:
    args = _parse_args()

    X, y, feature_cols = _load_dataset(args.dataset)
    model, y_test, y_pred = _train_model(X, y)

    _print_metrics(y_test, y_pred)

    saved_path = _save_model(model, feature_cols, args.model_out)
    print(f"\nSaved model to: {saved_path}")


if __name__ == "__main__":
    main()
