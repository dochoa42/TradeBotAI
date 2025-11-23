"""Phase 10.1 live trading scaffolding.

Purely in-memory paper trading state that resets whenever the backend restarts.
"""

from __future__ import annotations

from datetime import date
from typing import Dict
from uuid import uuid4

from fastapi import APIRouter

from models import (
    LiveOrder,
    LivePosition,
    LiveStatus,
    PlacePaperOrderRequest,
    CancelPaperOrderRequest,
    TradingMode,
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
    return LiveStatus(
        mode=CURRENT_MODE,
        equity=_paper_equity,
        daily_pnl=_compute_daily_pnl(),
        positions=list(_paper_positions.values()),
        orders=list(_paper_orders.values()),
    )


@router.get("/paper/status", response_model=LiveStatus)
async def get_paper_status() -> LiveStatus:
    """Return the current in-memory paper trading snapshot."""
    return _status()


@router.post("/paper/place_order", response_model=LiveStatus)
async def place_paper_order(req: PlacePaperOrderRequest) -> LiveStatus:
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
