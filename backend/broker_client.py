"""
Phase 10.6 - Broker client skeleton.
This will be extended to talk to a real exchange (e.g. Binance, Tradovate).
For now, it just defines the interface and returns dummy values.
"""

from typing import Optional, List

from pydantic import BaseModel


class BrokerOrder(BaseModel):
    id: str
    symbol: str
    side: str  # "buy" or "sell"
    qty: float
    type: str  # "market" or "limit"
    price: Optional[float] = None
    status: str = "new"


class BrokerPosition(BaseModel):
    symbol: str
    side: str  # "long" or "short"
    size: float
    entry_price: float


class BrokerAccountSnapshot(BaseModel):
    equity: float
    balance: float
    margin_used: float


def place_live_order(order: BrokerOrder) -> BrokerOrder:
    """
    TODO: implement real exchange call.
    For now, just echo back with status 'filled'.
    """
    order.status = "filled"
    return order


def fetch_live_positions() -> List[BrokerPosition]:
    """
    TODO: call real exchange positions endpoint.
    Currently returns an empty list.
    """
    return []


def fetch_live_account() -> BrokerAccountSnapshot:
    """
    TODO: call real exchange account/balance endpoint.
    Currently returns zeros.
    """
    return BrokerAccountSnapshot(
        equity=0.0,
        balance=0.0,
        margin_used=0.0,
    )
