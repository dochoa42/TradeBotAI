"""Phase 10.1 live trading scaffolding.

Purely in-memory paper trading state that resets whenever the backend restarts.
"""

from __future__ import annotations

import json
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter
from pydantic import BaseModel

from models import (
    LiveOrder,
    LivePosition,
    LiveStatus,
    PlacePaperOrderRequest,
    CancelPaperOrderRequest,
    TradingMode,
    FlattenPaperPositionRequest,
    PaperTradeRecord,
    EquitySnapshot,
    PaperPerformanceSummary,
)
from risk import (
    RISK_CONFIG,
    risk_check,
    get_kill_switch_state,
    set_kill_switch,
    RiskConfig,
    KillSwitchState,
)
from storage import (
    record_paper_trade,
    record_equity_snapshot,
    fetch_recent_trades,
    fetch_equity_history,
    fetch_paper_trades_filtered,
)

router = APIRouter(prefix="/api/live", tags=["live"])

# Phase 10.6: UI "Live Trading" tab uses paper mode only.
# Actual live trading will be wired later and gated by risk.LIVE_TRADING_ENABLED.
CURRENT_MODE: TradingMode = "paper"
_paper_equity: float = 2000.0
_paper_start_of_day_equity: float = _paper_equity
_paper_positions: Dict[str, LivePosition] = {}
_paper_orders: Dict[str, LiveOrder] = {}
_current_day: date = date.today()


def _max_drawdown_absolute(values: List[float]) -> float:
    """Return max drawdown in absolute currency terms."""
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


def _ensure_daily_reset() -> None:
    """Reset daily reference equity if a new day started."""
    global _current_day, _paper_start_of_day_equity
    today = date.today()
    if today != _current_day:
        _current_day = today
        _paper_start_of_day_equity = _paper_equity


def _compute_daily_pnl() -> float:
    _ensure_daily_reset()
    return _paper_equity - _paper_start_of_day_equity


def _status() -> LiveStatus:
    _ensure_daily_reset()
    ks = get_kill_switch_state()
    status = LiveStatus(
        mode=CURRENT_MODE,
        equity=_paper_equity,
        daily_pnl=_compute_daily_pnl(),
        positions=list(_paper_positions.values()),
        orders=list(_paper_orders.values()),
        kill_switch_tripped=ks.tripped,
        kill_switch_reason=ks.reason,
        daily_loss_limit=RISK_CONFIG.max_daily_loss,
        max_position_size=RISK_CONFIG.max_position_size,
        max_open_positions=RISK_CONFIG.max_open_positions,
    )
    record_equity_snapshot(status.equity, status.daily_pnl)
    return status


def _flatten_position(req: FlattenPaperPositionRequest) -> None:
    """Close a paper position and update equity using realized PnL."""
    global _paper_equity

    pos_key = f"{req.symbol}:{req.side}"
    pos = _paper_positions.get(pos_key)
    if not pos or pos.size <= 0:
        return

    if req.side == "long":
        pnl = (req.exit_price - pos.entry_price) * pos.size
    else:
        pnl = (pos.entry_price - req.exit_price) * pos.size

    _paper_equity += pnl
    record_paper_trade(
        symbol=pos.symbol,
        side=pos.side,
        qty=pos.size,
        entry_price=pos.entry_price,
        exit_price=req.exit_price,
        pnl=pnl,
    )
    del _paper_positions[pos_key]


@router.get("/paper/status", response_model=LiveStatus)
async def get_paper_status() -> LiveStatus:
    """Return the current in-memory paper trading snapshot."""
    return _status()


def _deserialize_tags(raw: Any) -> Optional[Dict[str, Any]]:
    """Convert the stored JSON string (if any) into a dict for the API response."""
    if raw is None:
        return None
    if isinstance(raw, dict):
        return raw  # already parsed
    if not isinstance(raw, str):
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


@router.post("/paper/place_order", response_model=LiveStatus)
async def place_paper_order(req: PlacePaperOrderRequest) -> LiveStatus:
    global _paper_equity

    # Phase 10.2: central risk manager gate
    current_status = _status()
    decision = risk_check(current_status, req, CURRENT_MODE)
    if not decision.allowed:
        return _status()

    price = req.price if req.price is not None else 0.0
    order_id = str(uuid4())
    pos_side = "long" if req.side == "buy" else "short"
    order = LiveOrder(
        id=order_id,
        symbol=req.symbol,
        side=req.side,
        qty=req.qty,
        type=req.type,
        price=price,
        status="filled",
    )
    _paper_orders[order_id] = order

    pos_key = f"{req.symbol}:{pos_side}"
    existing = _paper_positions.get(pos_key)
    if existing:
        total_qty = existing.size + req.qty
        if total_qty > 0:
            weighted_price = (
                (existing.entry_price * existing.size) + (price * req.qty)
            ) / total_qty
        else:
            weighted_price = existing.entry_price
        _paper_positions[pos_key] = LivePosition(
            symbol=req.symbol,
            side=pos_side,
            size=total_qty,
            entry_price=weighted_price,
            current_price=weighted_price,
            unrealized_pnl=0.0,
        )
    else:
        _paper_positions[pos_key] = LivePosition(
            symbol=req.symbol,
            side=pos_side,
            size=req.qty,
            entry_price=price,
            current_price=price,
            unrealized_pnl=0.0,
        )

    return _status()


@router.post("/paper/cancel_order", response_model=LiveStatus)
async def cancel_paper_order(req: CancelPaperOrderRequest) -> LiveStatus:
    order = _paper_orders.get(req.order_id)
    if order and order.status == "new":
        _paper_orders[req.order_id] = LiveOrder(**{**order.dict(), "status": "canceled"})
    return _status()


@router.get("/paper/kill-switch", response_model=KillSwitchState)
async def get_paper_kill_switch() -> KillSwitchState:
    """Return the current kill switch state for paper/live trading."""
    return get_kill_switch_state()


class KillSwitchToggleRequest(BaseModel):
    tripped: bool
    reason: Optional[str] = None


@router.post("/paper/kill-switch", response_model=KillSwitchState)
async def set_paper_kill_switch_state(body: KillSwitchToggleRequest) -> KillSwitchState:
    """Manually toggle the kill switch from the UI (Phase 10.2)."""
    return set_kill_switch(body.tripped, body.reason)


@router.get("/paper/risk-config", response_model=RiskConfig)
async def get_paper_risk_config() -> RiskConfig:
    """Return the current paper trading risk configuration."""
    return RISK_CONFIG


@router.post("/paper/flatten", response_model=LiveStatus)
async def flatten_paper_position(req: FlattenPaperPositionRequest) -> LiveStatus:
    """Flatten a paper position at a provided exit price."""
    _flatten_position(req)
    return _status()


@router.get("/paper/trades", response_model=List[PaperTradeRecord])
async def get_paper_trades(limit: int = 100) -> List[PaperTradeRecord]:
    """
    Return recent paper trades (most recent first).
    """
    rows = list(fetch_recent_trades(limit=limit))
    return [
        PaperTradeRecord(
            ts=row["ts"],
            symbol=row["symbol"],
            side=row["side"],
            qty=row["qty"],
            entry_price=row["entry_price"],
            exit_price=row["exit_price"],
            pnl=row["pnl"],
            strategy_name=row["strategy_name"],
            alpha_score=row["alpha_score"],
            entry_signal_time=row["entry_signal_time"],
            holding_minutes=row["holding_minutes"],
            tags=_deserialize_tags(row["tags"]),
        )
        for row in rows
    ]


@router.get("/paper/equity-history", response_model=List[EquitySnapshot])
async def get_paper_equity_history(limit: int = 200) -> List[EquitySnapshot]:
    """
    Return recent equity snapshots for charting the paper equity curve.
    """
    rows = list(fetch_equity_history(limit=limit))
    return [
        EquitySnapshot(
            ts=row[0],
            equity=row[1],
            daily_pnl=row[2],
        )
        for row in rows
    ]


def _summarize_trades(
    trades: List[dict],
) -> PaperPerformanceSummary:
    total = len(trades)
    pnl_values = [float(row["pnl"]) for row in trades]
    win_trades = sum(1 for pnl in pnl_values if pnl > 0)
    loss_trades = sum(1 for pnl in pnl_values if pnl < 0)
    gross_pnl = float(sum(pnl_values))
    net_pnl = gross_pnl
    win_rate = (win_trades / total) if total > 0 else 0.0
    best_trade_pnl = max(pnl_values) if pnl_values else None
    worst_trade_pnl = min(pnl_values) if pnl_values else None

    holding_samples = [float(row["holding_minutes"]) for row in trades if row["holding_minutes"] is not None]
    avg_holding = (
        float(sum(holding_samples) / len(holding_samples))
        if holding_samples
        else None
    )

    equity_curve: List[float] = []
    running = 0.0
    for pnl in pnl_values:
        running += pnl
        equity_curve.append(running)
    max_drawdown = _max_drawdown_absolute(equity_curve)

    avg_r_multiple: Optional[float] = None
    if total > 0 and loss_trades > 0:
        avg_pnl = gross_pnl / total
        avg_loss = abs(sum(pnl for pnl in pnl_values if pnl < 0) / loss_trades)
        if avg_loss > 0:
            avg_r_multiple = avg_pnl / avg_loss

    return PaperPerformanceSummary(
        total_trades=total,
        win_trades=win_trades,
        loss_trades=loss_trades,
        win_rate=float(win_rate),
        gross_pnl=float(gross_pnl),
        net_pnl=float(net_pnl),
        max_drawdown=float(max_drawdown),
        avg_r_multiple=avg_r_multiple,
        best_trade_pnl=float(best_trade_pnl) if best_trade_pnl is not None else None,
        worst_trade_pnl=float(worst_trade_pnl) if worst_trade_pnl is not None else None,
        avg_holding_minutes=avg_holding,
    )


@router.get("/paper/summary", response_model=PaperPerformanceSummary)
async def get_paper_performance_summary(
    symbol: Optional[str] = None,
    strategy: Optional[str] = None,
    start_ts: Optional[int] = None,
    end_ts: Optional[int] = None,
) -> PaperPerformanceSummary:
    """Aggregate light-weight performance stats for the UI cards."""

    rows = [
        dict(row)
        for row in fetch_paper_trades_filtered(
            symbol=symbol,
            strategy=strategy,
            start_ts=start_ts,
            end_ts=end_ts,
        )
    ]

    if not rows:
        return PaperPerformanceSummary(
            total_trades=0,
            win_trades=0,
            loss_trades=0,
            win_rate=0.0,
            gross_pnl=0.0,
            net_pnl=0.0,
            max_drawdown=0.0,
            avg_r_multiple=None,
            best_trade_pnl=None,
            worst_trade_pnl=None,
            avg_holding_minutes=None,
        )

    return _summarize_trades(rows)
