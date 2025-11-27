"""Tiny SQLite helper for persisting paper trading history."""

from __future__ import annotations

import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from models import StrategyPerformanceRow

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

    CREATE TABLE IF NOT EXISTS equity_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        old_equity REAL NOT NULL,
        new_equity REAL NOT NULL,
        note TEXT
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at INTEGER NOT NULL,
        symbol TEXT NOT NULL,
        strategy_name TEXT NOT NULL,
        interval TEXT NOT NULL,
        params_json TEXT,
        pnl REAL NOT NULL,
        win_rate REAL NOT NULL,
        max_drawdown REAL NOT NULL,
        trades INTEGER NOT NULL
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


def _max_drawdown(values: List[float]) -> float:
    """Return the maximum peak-to-trough drawdown for an equity curve."""
    if not values:
        return 0.0
    peak = values[0]
    max_dd = 0.0
    for value in values:
        if value > peak:
            peak = value
        drawdown = peak - value
        if drawdown > max_dd:
            max_dd = drawdown
    return float(max_dd)


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


def get_last_equity_snapshot() -> Optional[float]:
    """Return the most recent persisted equity value, if any."""
    cur = _conn.execute(
        "SELECT equity FROM paper_equity ORDER BY id DESC LIMIT 1"
    )
    row = cur.fetchone()
    return float(row[0]) if row is not None else None


def record_equity_reset(
    old_equity: float,
    new_equity: float,
    note: Optional[str] = None,
) -> None:
    """Persist a ledger entry describing an equity reset."""
    normalized_note = note.strip() if note else None
    _conn.execute(
        """
        INSERT INTO equity_resets (ts, old_equity, new_equity, note)
        VALUES (?, ?, ?, ?)
        """,
        (int(time.time()), float(old_equity), float(new_equity), normalized_note),
    )
    _conn.commit()


def count_equity_resets() -> int:
    """Return total number of recorded equity reset events."""
    cur = _conn.execute("SELECT COUNT(1) FROM equity_resets")
    row = cur.fetchone()
    return int(row[0]) if row is not None else 0


def fetch_recent_trades(limit: int = 100, offset: int = 0) -> Iterable[Tuple]:
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
        LIMIT ? OFFSET ?
        """,
        (limit, offset),
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


def fetch_strategy_performance(symbol: Optional[str] = None) -> List[StrategyPerformanceRow]:
    """Return aggregated performance rows grouped by strategy and symbol."""

    symbol_filter = symbol.upper() if symbol else None
    base_query = (
        """
        SELECT
            strategy_name,
            symbol,
            pnl,
            holding_minutes,
            ts
        FROM paper_trades
        WHERE strategy_name IS NOT NULL AND TRIM(strategy_name) <> ''
        """
    )

    params: List[Any] = []
    if symbol_filter:
        base_query += " AND symbol = ?"
        params.append(symbol_filter)

    base_query += " ORDER BY strategy_name ASC, symbol ASC, ts ASC"

    rows = _conn.execute(base_query, tuple(params)).fetchall()
    grouped: Dict[tuple[str, str], Dict[str, Any]] = {}

    for row in rows:
        raw_strategy = row["strategy_name"]
        if raw_strategy is None:
            continue
        strategy_name = raw_strategy.strip()
        if not strategy_name:
            continue
        symbol_value = row["symbol"]
        key = (strategy_name, symbol_value)

        stats = grouped.setdefault(
            key,
            {
                "strategy_name": strategy_name,
                "symbol": symbol_value,
                "total_trades": 0,
                "win_trades": 0,
                "loss_trades": 0,
                "net_pnl": 0.0,
                "pnl_sequence": [],
                "holding_samples": [],
            },
        )

        pnl_value = float(row["pnl"] or 0.0)
        stats["total_trades"] += 1
        if pnl_value > 0:
            stats["win_trades"] += 1
        elif pnl_value < 0:
            stats["loss_trades"] += 1
        stats["net_pnl"] += pnl_value
        stats["pnl_sequence"].append(pnl_value)

        holding_value = row["holding_minutes"]
        if holding_value is not None:
            try:
                stats["holding_samples"].append(float(holding_value))
            except (TypeError, ValueError):
                pass

    results: List[StrategyPerformanceRow] = []
    for key in sorted(grouped.keys()):
        stats = grouped[key]
        total = stats["total_trades"]
        net_pnl = float(stats["net_pnl"])
        win_trades = stats["win_trades"]
        loss_trades = stats["loss_trades"]
        win_rate = (win_trades / total) if total > 0 else 0.0
        avg_trade_pnl_value = (net_pnl / total) if total > 0 else 0.0

        holding_samples: List[float] = stats["holding_samples"]
        avg_holding = (
            sum(holding_samples) / len(holding_samples)
            if holding_samples
            else None
        )

        running = 0.0
        equity_curve: List[float] = []
        for pnl in stats["pnl_sequence"]:
            running += pnl
            equity_curve.append(running)
        max_drawdown = _max_drawdown(equity_curve)

        results.append(
            StrategyPerformanceRow(
                strategy_name=stats["strategy_name"],
                symbol=stats["symbol"],
                total_trades=total,
                win_trades=win_trades,
                loss_trades=loss_trades,
                win_rate=float(win_rate),
                net_pnl=net_pnl,
                max_drawdown=float(max_drawdown),
                avg_trade_pnl=float(avg_trade_pnl_value),
                avg_holding_minutes=
                    float(avg_holding) if avg_holding is not None else None,
            )
        )

    return results


def list_paper_strategies(symbol: Optional[str] = None) -> List[str]:
    """Return distinct non-empty strategy names, optionally filtered by symbol."""

    query = [
        """
        SELECT DISTINCT strategy_name
        FROM paper_trades
        WHERE strategy_name IS NOT NULL AND TRIM(strategy_name) <> ''
        """
    ]
    params: List[Any] = []

    if symbol:
        query.append("AND symbol = ?")
        params.append(symbol.upper())

    query.append("ORDER BY strategy_name ASC")
    rows = _conn.execute(" ".join(query), tuple(params)).fetchall()
    return [row[0] for row in rows if row[0]]


def _normalize_strategy_name(strategy_name: Optional[str]) -> str:
    if not strategy_name:
        return "-"
    value = strategy_name.strip()
    return value if value else "-"


def _extract_summary_field(summary: Any, field: str, default: float = 0.0) -> float:
    if summary is None:
        return float(default)
    if hasattr(summary, field):
        try:
            return float(getattr(summary, field))
        except (TypeError, ValueError):
            return float(default)
    if isinstance(summary, dict):
        try:
            value = summary.get(field, default)
            return float(value)
        except (TypeError, ValueError):
            return float(default)
    return float(default)


def record_backtest_run(
    symbol: str,
    strategy_name: Optional[str],
    interval: str,
    params_json: Optional[str],
    result: Any,
) -> None:
    """Persist a single backtest execution summary for later comparison."""

    summary = getattr(result, "summary", None)
    trades = getattr(result, "trades", None)
    if summary is None and isinstance(result, dict):
        summary = result.get("summary")
    if trades is None and isinstance(result, dict):
        trades = result.get("trades")

    pnl = _extract_summary_field(summary, "total_pnl", 0.0)
    win_rate = _extract_summary_field(summary, "win_pct", 0.0)
    max_drawdown = _extract_summary_field(summary, "max_drawdown", 0.0)
    trade_count = len(trades) if isinstance(trades, (list, tuple)) else 0

    _conn.execute(
        """
        INSERT INTO backtest_runs (
            created_at,
            symbol,
            strategy_name,
            interval,
            params_json,
            pnl,
            win_rate,
            max_drawdown,
            trades
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(time.time()),
            symbol.upper(),
            _normalize_strategy_name(strategy_name),
            interval,
            params_json,
            float(pnl),
            float(win_rate),
            float(max_drawdown),
            int(trade_count),
        ),
    )
    _conn.commit()


def get_latest_backtest_for_strategy(
    symbol: str,
    strategy_name: str,
) -> Optional[sqlite3.Row]:
    """Return the most recent stored backtest for the pair."""

    cur = _conn.execute(
        """
        SELECT * FROM backtest_runs
        WHERE symbol = ? AND strategy_name = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (symbol.upper(), _normalize_strategy_name(strategy_name)),
    )
    return cur.fetchone()


def fetch_latest_backtest_runs(
    symbol: Optional[str] = None,
) -> Dict[Tuple[str, str], sqlite3.Row]:
    """Return latest backtest rows keyed by (symbol, strategy)."""

    clauses: List[str] = []
    params: List[Any] = []
    if symbol:
        clauses.append("symbol = ?")
        params.append(symbol.upper())

    query = [
        """
        SELECT
            id,
            created_at,
            symbol,
            strategy_name,
            interval,
            params_json,
            pnl,
            win_rate,
            max_drawdown,
            trades
        FROM backtest_runs
        """
    ]

    if clauses:
        query.append("WHERE " + " AND ".join(clauses))

    query.append("ORDER BY symbol ASC, strategy_name ASC, created_at DESC, id DESC")

    rows = _conn.execute(" ".join(query), tuple(params)).fetchall()
    latest: Dict[Tuple[str, str], sqlite3.Row] = {}
    for row in rows:
        key = (row["symbol"], row["strategy_name"])
        if key not in latest:
            latest[key] = row
    return latest
