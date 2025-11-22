from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

import pandas as pd

from backtest import load_candles_dataframe
from indicators import IndicatorSpec, compute_indicators

DATASETS_DIR = Path(__file__).parent / "data" / "datasets"

DEFAULT_INDICATORS: List[IndicatorSpec] = [
    {"id": "sma", "kind": "trend", "params": {"length": 20}},
    {"id": "ema", "kind": "trend", "params": {"length": 50}},
    {"id": "rsi", "kind": "oscillator", "params": {"length": 14}},
    {"id": "macd", "kind": "trend", "params": {"fast": 12, "slow": 26, "signal": 9}},
    {"id": "bbands", "kind": "volatility", "params": {"length": 20, "std": 2}},
]

BASE_FEATURES = ["open", "high", "low", "close", "volume"]


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build an offline dataset with indicators and binary labels."
    )
    parser.add_argument("--symbol", required=True, help="Trading pair symbol, e.g. BTCUSDT")
    parser.add_argument("--interval", default="1m", help="Candle interval, default 1m")
    parser.add_argument(
        "--lookahead",
        type=int,
        default=5,
        help="Bars to look ahead when computing the label (default 5)",
    )
    parser.add_argument(
        "--threshold",
        type=float,
        default=0.3,
        help="Percent move required to tag label=1 (default 0.3)",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=5000,
        help="Maximum number of candles to load; 0 means full history",
    )
    return parser.parse_args()


def _validate_args(args: argparse.Namespace) -> None:
    if args.lookahead <= 0:
        raise ValueError("--lookahead must be a positive integer")
    if args.threshold <= 0:
        raise ValueError("--threshold must be positive")
    if args.limit < 0:
        raise ValueError("--limit must be zero or positive")


def _build_labelled_dataset(
    symbol: str,
    interval: str,
    lookahead: int,
    threshold: float,
    limit: int,
) -> pd.DataFrame:
    df = load_candles_dataframe(symbol, interval, limit)
    df = compute_indicators(df, DEFAULT_INDICATORS)

    df["future_return"] = (df["close"].shift(-lookahead) - df["close"]) / df["close"] * 100.0
    df["label"] = (df["future_return"] >= threshold).astype(int)

    df = df.dropna(subset=["future_return"]).copy()
    df = df.drop(columns=["future_return"])

    indicator_cols = [
        col
        for col in df.columns
        if col not in BASE_FEATURES and col not in ("ts", "label")
    ]
    ordered_cols = BASE_FEATURES + indicator_cols + ["label"]
    dataset = df[ordered_cols].dropna().reset_index(drop=True)

    if dataset.empty:
        raise ValueError("Dataset is empty after processing; try increasing --limit")

    return dataset


def _save_dataset(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(path, index=False)


def _print_summary(path: Path, df: pd.DataFrame) -> None:
    total = len(df)
    label_counts = df["label"].value_counts().sort_index()
    zeros = int(label_counts.get(0, 0))
    ones = int(label_counts.get(1, 0))

    print(f"Dataset saved to: {path}")
    print(f"Rows: {total}")
    if total > 0:
        zero_pct = zeros / total * 100.0
        one_pct = ones / total * 100.0
    else:
        zero_pct = one_pct = 0.0
    print(f"Label 0: {zeros} ({zero_pct:.2f}%)")
    print(f"Label 1: {ones} ({one_pct:.2f}%)")


def main() -> None:
    args = _parse_args()
    _validate_args(args)

    symbol = args.symbol.upper()
    dataset = _build_labelled_dataset(
        symbol=symbol,
        interval=args.interval,
        lookahead=args.lookahead,
        threshold=args.threshold,
        limit=args.limit,
    )

    dataset_path = DATASETS_DIR / f"{symbol}_{args.interval}_L{args.lookahead}_T{args.threshold}.parquet"
    _save_dataset(dataset, dataset_path)
    _print_summary(dataset_path, dataset)


if __name__ == "__main__":
    main()
