"""Broker client protocol definitions for future Alpaca adapter support."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional, Protocol, runtime_checkable

from pydantic import BaseModel


class BrokerSide(str, Enum):
    BUY = "buy"
    SELL = "sell"


class BrokerOrderType(str, Enum):
    MARKET = "market"
    LIMIT = "limit"


class BrokerTimeInForce(str, Enum):
    DAY = "day"
    GTC = "gtc"
    IOC = "ioc"
    FOK = "fok"


class BrokerOrder(BaseModel):
    id: str
    symbol: str
    side: BrokerSide
    qty: float
    order_type: BrokerOrderType
    time_in_force: BrokerTimeInForce
    limit_price: Optional[float] = None
    status: str
    filled_qty: float = 0.0
    avg_fill_price: Optional[float] = None
    created_at: datetime


class BrokerPosition(BaseModel):
    symbol: str
    qty: float
    avg_entry_price: float
    side: BrokerSide
    unrealized_pnl: Optional[float] = None


class BrokerAccountSnapshot(BaseModel):
    equity: float
    cash: float
    buying_power: float
    daytrade_count: Optional[int] = None
    last_equity: Optional[float] = None


class BrokerOrderRequest(BaseModel):
    """Represents the intent to place a new order with the broker."""

    symbol: str
    side: BrokerSide
    qty: float
    order_type: BrokerOrderType
    time_in_force: BrokerTimeInForce
    limit_price: Optional[float] = None


@runtime_checkable
class BrokerClientProtocol(Protocol):
    async def place_order(self, order: BrokerOrderRequest) -> BrokerOrder: ...

    async def cancel_order(self, order_id: str) -> None: ...

    async def fetch_order(self, order_id: str) -> BrokerOrder: ...

    async def fetch_open_orders(self) -> list[BrokerOrder]: ...

    async def fetch_positions(self) -> list[BrokerPosition]: ...

    async def fetch_account(self) -> BrokerAccountSnapshot: ...
