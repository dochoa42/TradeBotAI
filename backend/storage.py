"""Tiny SQLite helper for persisting paper trading history."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable, Optional, Tuple

DB_PATH = str(Path(__file__).with_name("paper_trading.db"))


def get_connection() -> sqlite3.Connection:
    """Return a shared SQLite connection bound to the backend DB file."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


_conn = get_connection()
_conn.execute("PRAGMA journal_mode=WAL;")
_conn.execute("PRAGMA synchronous=NORMAL;")
_conn.executescript(
    """
    CREATE TABLE IF NOT EXISTS paper_trades (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts DATETIME DEFAULT CURRENT_TIMESTAMP,
        symbol TEXT NOT NULL,
        side TEXT NOT NULL,
        qty REAL NOT NULL,
        entry_price REAL NOT NULL,
        exit_price REAL NOT NULL,
        pnl REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS paper_equity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts DATETIME DEFAULT CURRENT_TIMESTAMP,
        equity REAL NOT NULL,
        daily_pnl REAL NOT NULL
    );
    """
)


_PAPER_TRADE_EXTRA_COLUMNS = {
    "strategy_name": "TEXT",
    "alpha_score": "REAL",
    "entry_signal_time": "DATETIME",
    "holding_minutes": "REAL",
    "tags": "TEXT",
}


def _ensure_paper_trade_columns() -> None:
    """Add newly required columns to paper_trades if missing (simple migration)."""
    cur = _conn.execute("PRAGMA table_info(paper_trades);")
    existing = {row[1] for row in cur.fetchall()}
    for column, column_type in _PAPER_TRADE_EXTRA_COLUMNS.items():
        if column not in existing:
            _conn.execute(
                f"ALTER TABLE paper_trades ADD COLUMN {column} {column_type};"
            )
    _conn.commit()


_ensure_paper_trade_columns()
_conn.commit()


def record_paper_trade(
    symbol: str,
    side: str,
    qty: float,
    entry_price: float,
    exit_price: float,
    pnl: float,
    *,
    strategy_name: Optional[str] = None,
    alpha_score: Optional[float] = None,
    entry_signal_time: Optional[Any] = None,
    holding_minutes: Optional[float] = None,
    tags: Optional[Any] = None,
) -> None:
    """Persist a realized paper trade."""
    serialized_tags: Optional[str]
    if tags is None:
        serialized_tags = None
    elif isinstance(tags, str):
        serialized_tags = tags
    else:
        try:
            serialized_tags = json.dumps(tags)
        except (TypeError, ValueError):
            serialized_tags = None

    _conn.execute(
        """
        INSERT INTO paper_trades (
            symbol,
            side,
            qty,
            entry_price,
            exit_price,
            pnl,
            strategy_name,
            alpha_score,
            entry_signal_time,
            holding_minutes,
            tags
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            symbol,
            side,
            qty,
            entry_price,
            exit_price,
            pnl,
            strategy_name,
            alpha_score,
            entry_signal_time,
            holding_minutes,
            serialized_tags,
        ),
    )
    _conn.commit()


def record_equity_snapshot(equity: float, daily_pnl: float) -> None:
    """Persist an equity snapshot for trend analytics."""
    _conn.execute(
        "INSERT INTO paper_equity (equity, daily_pnl) VALUES (?, ?)",
        (equity, daily_pnl),
    )
    _conn.commit()


def fetch_recent_trades(limit: int = 100) -> Iterable[Tuple]:
    """Return most recent paper trades (latest first)."""
    cur = _conn.execute(
        """
        SELECT
            ts,
            symbol,
            side,
            qty,
            entry_price,
            exit_price,
            pnl,
            strategy_name,
            alpha_score,
            entry_signal_time,
            holding_minutes,
            tags
        FROM paper_trades
        ORDER BY id DESC
        LIMIT ?
        """,
        (limit,),
    )
    return cur.fetchall()


def fetch_equity_history(limit: int = 200) -> Iterable[Tuple]:
    """Return equity snapshots (latest first)."""
    cur = _conn.execute(
        "SELECT ts, equity, daily_pnl FROM paper_equity ORDER BY id DESC LIMIT ?",
        (limit,),
    )
    return cur.fetchall()


def _normalize_epoch(ts: Optional[int]) -> Optional[str]:
    """Convert incoming unix timestamps (ms or s) into the DB format."""
    if ts is None:
        return None
    value = float(ts)
    if value > 1_000_000_000_000:  # assume milliseconds
        value /= 1000.0
    try:
        dt = datetime.utcfromtimestamp(value)
    except (OverflowError, OSError, ValueError):
        return None
    return dt.strftime("%Y-%m-%d %H:%M:%S")


def fetch_paper_trades_filtered(
    *,
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
) -> Iterable[sqlite3.Row]:
    """Return paper trades ordered by time with lightweight filtering."""

    symbol_filter = symbol.upper() if symbol else None
    start_filter = _normalize_epoch(start_ts)
    end_filter = _normalize_epoch(end_ts)

    query = [
        """
        SELECT
            ts,
            symbol,
            side,
            qty,
            entry_price,
            exit_price,
            pnl,
            strategy_name,
            alpha_score,
            entry_signal_time,
            holding_minutes,
            tags
        FROM paper_trades
        """
    ]
    clauses = []
    params: list[Any] = []

    if symbol_filter:
        clauses.append("symbol = ?")
        params.append(symbol_filter)
    if strategy:
        clauses.append("strategy_name = ?")
        params.append(strategy)
    if start_filter:
        clauses.append("ts >= ?")
        params.append(start_filter)
    if end_filter:
        clauses.append("ts <= ?")
        params.append(end_filter)

    if clauses:
        query.append("WHERE " + " AND ".join(clauses))

    query.append("ORDER BY ts ASC")

    cur = _conn.execute(" ".join(query), tuple(params))
    return cur.fetchall()
