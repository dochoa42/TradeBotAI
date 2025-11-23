"""
Phase 10.2 - Risk management and kill switch logic for live / paper trading.
"""

from typing import Optional

from pydantic import BaseModel

from models import LiveStatus, PlacePaperOrderRequest, TradingMode


class RiskConfig(BaseModel):
    # Max units per side per symbol (paper/live position size cap)
    max_position_size: float = 1.0
    # Max loss in account currency allowed for the day before blocking new trades
    max_daily_loss: float = 100.0
    # Max distinct open positions (symbol + side) allowed
    max_open_positions: int = 5


class KillSwitchState(BaseModel):
    tripped: bool = False
    reason: Optional[str] = None


class RiskDecision(BaseModel):
    allowed: bool
    reason: str
    kill_switch_tripped: bool = False


# Phase 10.6 - explicit live trading enable flag (defaults to False for safety)
# Live trading will only be enabled once this is deliberately set to True and a real broker integration is wired.
LIVE_TRADING_ENABLED = False

# Global config and kill-switch state (module-level singletons)
RISK_CONFIG = RiskConfig()
KILL_SWITCH = KillSwitchState()


def get_kill_switch_state() -> KillSwitchState:
    """Return the current kill switch state."""
    return KILL_SWITCH


def set_kill_switch(tripped: bool, reason: Optional[str] = None) -> KillSwitchState:
    """Trip or reset the kill switch, storing an optional reason."""
    KILL_SWITCH.tripped = tripped
    KILL_SWITCH.reason = reason
    return KILL_SWITCH


def risk_check(
    status: LiveStatus,
    order: PlacePaperOrderRequest,
    mode: TradingMode,
) -> RiskDecision:
    """
    Decide whether a new order is allowed based on:
    - current LiveStatus
    - global risk config
    - kill switch
    - trading mode (backtest / paper / live)
    """

    # 1) If kill switch is already tripped, block everything (paper/live)
    if KILL_SWITCH.tripped:
        return RiskDecision(
            allowed=False,
            reason=f"kill switch tripped: {KILL_SWITCH.reason or 'no reason'}",
            kill_switch_tripped=True,
        )

    # 2) Always allow in backtest mode (no real capital at risk)
    if mode == "backtest":
        return RiskDecision(
            allowed=True,
            reason="backtest mode",
            kill_switch_tripped=False,
        )

    # 3) Live mode gated by explicit enable flag
    if mode == "live":
        if not LIVE_TRADING_ENABLED:
            return RiskDecision(
                allowed=False,
                reason="live trading disabled by configuration",
                kill_switch_tripped=False,
            )
        # When LIVE_TRADING_ENABLED becomes True in the future,
        # additional live-mode risk checks can go here before allowing.

    # 4) Paper mode risk checks
    # Daily loss limit (note: daily_pnl is negative when losing)
    if status.daily_pnl <= -RISK_CONFIG.max_daily_loss:
        # Trip kill switch as an extra safety
        set_kill_switch(True, "daily loss limit reached")
        return RiskDecision(
            allowed=False,
            reason="daily loss limit reached",
            kill_switch_tripped=True,
        )

    # Determine logical position side for this order
    pos_side = "long" if order.side == "buy" else "short"

    # Find existing position (if any) in the status snapshot
    existing_pos = next(
        (
            p
            for p in status.positions
            if p.symbol == order.symbol and p.side == pos_side
        ),
        None,
    )
    current_size = existing_pos.size if existing_pos else 0.0
    resulting_size = current_size + order.qty

    # Max open positions: only when opening a NEW position
    if existing_pos is None and len(status.positions) >= RISK_CONFIG.max_open_positions:
        return RiskDecision(
            allowed=False,
            reason="max open positions reached",
            kill_switch_tripped=False,
        )

    # Max position size per side
    if resulting_size > RISK_CONFIG.max_position_size:
        return RiskDecision(
            allowed=False,
            reason="max position size exceeded",
            kill_switch_tripped=False,
        )

    # Everything ok
    return RiskDecision(
        allowed=True,
        reason="ok",
        kill_switch_tripped=False,
    )
