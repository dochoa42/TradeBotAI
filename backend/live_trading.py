"""Phase 10.1 live trading scaffolding.

Purely in-memory paper trading state that resets whenever the backend restarts.
"""

from __future__ import annotations

from datetime import date
from typing import Dict, Optional
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
)

router = APIRouter(prefix="/api/live", tags=["live"])

CURRENT_MODE: TradingMode = "paper"
_paper_equity: float = 2000.0
_paper_start_of_day_equity: float = _paper_equity
_paper_positions: Dict[str, LivePosition] = {}
_paper_orders: Dict[str, LiveOrder] = {}
_current_day: date = date.today()


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
