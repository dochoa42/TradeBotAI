"""Tiny SQLite helper for persisting paper trading history."""

from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Iterable, Tuple

DB_PATH = str(Path(__file__).with_name("paper_trading.db"))


def get_connection() -> sqlite3.Connection:
    """Return a shared SQLite connection bound to the backend DB file."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
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
_conn.commit()


def record_paper_trade(
    symbol: str,
    side: str,
    qty: float,
    entry_price: float,
    exit_price: float,
    pnl: float,
) -> None:
    """Persist a realized paper trade."""
    _conn.execute(
        "INSERT INTO paper_trades (symbol, side, qty, entry_price, exit_price, pnl) VALUES (?, ?, ?, ?, ?, ?)",
        (symbol, side, qty, entry_price, exit_price, pnl),
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
        "SELECT ts, symbol, side, qty, entry_price, exit_price, pnl FROM paper_trades ORDER BY id DESC LIMIT ?",
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
