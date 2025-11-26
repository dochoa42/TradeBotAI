"""Phase 10.1 live trading scaffolding.

Purely in-memory paper trading state that resets whenever the backend restarts.
"""

from __future__ import annotations

import json
import time
from datetime import date
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from broker_client import (
    STUB_BROKER_CLIENT,
    BrokerOrderRequest,
    BrokerOrderType,
    BrokerSide,
    BrokerTimeInForce,
)
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
    StrategyPerformanceRow,
    ExecutionMode,
    ExecutionModeResponse,
    ExecutionModeUpdateRequest,
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
    fetch_strategy_performance,
)

router = APIRouter(prefix="/api/live", tags=["live"])

# Keep a reference handy for upcoming live-mode wiring without altering paper behavior yet.
_ = STUB_BROKER_CLIENT

# Phase 10.6: UI "Live Trading" tab uses paper mode only.
# Actual live trading will be wired later and gated by risk.LIVE_TRADING_ENABLED.
CURRENT_MODE: TradingMode = "paper"
CURRENT_EXECUTION_MODE: ExecutionMode = ExecutionMode.PAPER
_paper_equity: float = 2000.0
_paper_start_of_day_equity: float = _paper_equity
_paper_positions: Dict[str, LivePosition] = {}
_paper_orders: Dict[str, LiveOrder] = {}
_current_day: date = date.today()


def _current_unix_ms() -> int:
    """Return current Unix timestamp in milliseconds."""
    return int(time.time() * 1000)


def _map_place_request_to_broker(req: PlacePaperOrderRequest) -> BrokerOrderRequest:
    side = BrokerSide.BUY if req.side == "buy" else BrokerSide.SELL
    order_type = (
        BrokerOrderType.MARKET
        if req.type == "market"
        else BrokerOrderType.LIMIT
    )
    limit_price = req.price if order_type == BrokerOrderType.LIMIT else None
    return BrokerOrderRequest(
        symbol=req.symbol,
        side=side,
        qty=req.qty,
        order_type=order_type,
        time_in_force=BrokerTimeInForce.GTC,
        limit_price=limit_price,
    )


def _register_local_fill(
    *,
    order_id: str,
    req: PlacePaperOrderRequest,
    fill_price: float,
    entry_signal_time: int,
) -> None:
    """Mirror a filled order into the paper state for UI continuity."""
    pos_side = "long" if req.side == "buy" else "short"
    order = LiveOrder(
        id=order_id,
        symbol=req.symbol,
        side=req.side,
        qty=req.qty,
        type=req.type,
        price=fill_price,
        status="filled",
        strategy_name=req.strategy_name,
        alpha_score=req.alpha_score,
        tags=req.tags,
        entry_signal_time=entry_signal_time,
    )
    _paper_orders[order_id] = order

    pos_key = f"{req.symbol}:{pos_side}"
    existing = _paper_positions.get(pos_key)
    if existing:
        total_qty = existing.size + req.qty
        if total_qty > 0:
            weighted_price = (
                (existing.entry_price * existing.size) + (fill_price * req.qty)
            ) / total_qty
        else:
            weighted_price = existing.entry_price
        strategy_name = existing.strategy_name
        entry_signal_time_value = existing.entry_signal_time
        alpha_score = (
            req.alpha_score
            if req.alpha_score is not None
            else existing.alpha_score
        )
        tags = req.tags if req.tags is not None else existing.tags
        _paper_positions[pos_key] = LivePosition(
            symbol=req.symbol,
            side=pos_side,
            size=total_qty,
            entry_price=weighted_price,
            current_price=weighted_price,
            unrealized_pnl=0.0,
            strategy_name=strategy_name,
            alpha_score=alpha_score,
            tags=tags,
            entry_signal_time=entry_signal_time_value,
        )
    else:
        _paper_positions[pos_key] = LivePosition(
            symbol=req.symbol,
            side=pos_side,
            size=req.qty,
            entry_price=fill_price,
            current_price=fill_price,
            unrealized_pnl=0.0,
            strategy_name=req.strategy_name,
            alpha_score=req.alpha_score,
            tags=req.tags,
            entry_signal_time=entry_signal_time,
        )


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

    now_ts = time.time()
    position_entry_ts = getattr(pos, "entry_signal_time", None)
    normalized_entry_ts: Optional[float] = None
    if position_entry_ts is not None:
        try:
            normalized_entry_ts = float(position_entry_ts)
        except (TypeError, ValueError):
            normalized_entry_ts = None
        else:
            # Older positions may keep ms timestamps; normalize to seconds before diffing.
            if normalized_entry_ts > 1_000_000_000_000:
                normalized_entry_ts /= 1000.0

    holding_minutes = (
        (now_ts - normalized_entry_ts) / 60.0
        if normalized_entry_ts is not None
        else None
    )

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
        strategy_name=getattr(pos, "strategy_name", None),
        alpha_score=getattr(pos, "alpha_score", None),
        entry_signal_time=position_entry_ts,
        holding_minutes=holding_minutes,
        tags=getattr(pos, "tags", None),
    )
    del _paper_positions[pos_key]


async def _route_flatten_through_stub(req: FlattenPaperPositionRequest) -> None:
    pos_key = f"{req.symbol}:{req.side}"
    pos = _paper_positions.get(pos_key)
    if not pos or pos.size <= 0:
        return

    broker_side = BrokerSide.SELL if req.side == "long" else BrokerSide.BUY
    broker_request = BrokerOrderRequest(
        symbol=req.symbol,
        side=broker_side,
        qty=pos.size,
        order_type=BrokerOrderType.LIMIT,
        time_in_force=BrokerTimeInForce.GTC,
        limit_price=req.exit_price,
    )
    await STUB_BROKER_CLIENT.place_order(broker_request)


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


@router.get("/execution-mode", response_model=ExecutionModeResponse)
async def get_execution_mode() -> ExecutionModeResponse:
    """Return the current execution routing mode for the live engine."""
    return ExecutionModeResponse(mode=CURRENT_EXECUTION_MODE)


@router.post("/execution-mode", response_model=ExecutionModeResponse)
async def update_execution_mode(
    body: ExecutionModeUpdateRequest,
) -> ExecutionModeResponse:
    """Update the execution routing mode (paper vs broker stub)."""
    global CURRENT_EXECUTION_MODE

    if body.mode not in {
        ExecutionMode.PAPER,
        ExecutionMode.BROKER_STUB,
    }:
        raise HTTPException(
            status_code=400,
            detail="Execution mode not supported yet",
        )

    CURRENT_EXECUTION_MODE = body.mode
    return ExecutionModeResponse(mode=CURRENT_EXECUTION_MODE)


@router.post("/paper/place_order", response_model=LiveStatus)
async def place_paper_order(req: PlacePaperOrderRequest) -> LiveStatus:
    global _paper_equity

    # Phase 10.2: central risk manager gate
    current_status = _status()
    decision = risk_check(current_status, req, CURRENT_MODE)
    if not decision.allowed:
        return _status()

    resolved_entry_signal_time = (
        req.entry_signal_time if req.entry_signal_time is not None else _current_unix_ms()
    )
    if CURRENT_EXECUTION_MODE == ExecutionMode.PAPER:
        fill_price = req.price if req.price is not None else 0.0
        _register_local_fill(
            order_id=str(uuid4()),
            req=req,
            fill_price=fill_price,
            entry_signal_time=resolved_entry_signal_time,
        )
    elif CURRENT_EXECUTION_MODE == ExecutionMode.BROKER_STUB:
        broker_request = _map_place_request_to_broker(req)
        broker_order = await STUB_BROKER_CLIENT.place_order(broker_request)
        fill_price = (
            broker_order.avg_fill_price
            or broker_order.limit_price
            or 0.0
        )
        _register_local_fill(
            order_id=broker_order.id,
            req=req,
            fill_price=fill_price,
            entry_signal_time=resolved_entry_signal_time,
        )
    else:
        raise HTTPException(status_code=400, detail="Unsupported execution mode")

    return _status()


@router.post("/paper/cancel_order", response_model=LiveStatus)
async def cancel_paper_order(req: CancelPaperOrderRequest) -> LiveStatus:
    order = _paper_orders.get(req.order_id)
    if CURRENT_EXECUTION_MODE == ExecutionMode.PAPER:
        if order and order.status == "new":
            _paper_orders[req.order_id] = LiveOrder(
                **{**order.dict(), "status": "canceled"}
            )
    elif CURRENT_EXECUTION_MODE == ExecutionMode.BROKER_STUB:
        await STUB_BROKER_CLIENT.cancel_order(req.order_id)
        if order:
            _paper_orders[req.order_id] = LiveOrder(
                **{**order.dict(), "status": "canceled"}
            )
    else:
        raise HTTPException(status_code=400, detail="Unsupported execution mode")
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
    if CURRENT_EXECUTION_MODE == ExecutionMode.BROKER_STUB:
        await _route_flatten_through_stub(req)
    elif CURRENT_EXECUTION_MODE != ExecutionMode.PAPER:
        raise HTTPException(status_code=400, detail="Unsupported execution mode")

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


@router.get(
    "/paper/strategy-performance",
    response_model=List[StrategyPerformanceRow],
)
async def get_strategy_performance(
    symbol: Optional[str] = None,
) -> List[StrategyPerformanceRow]:
    """Return per-strategy paper performance grouped by symbol."""

    return fetch_strategy_performance(symbol)
