"""Broker client protocol definitions for future Alpaca adapter support."""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from itertools import count
from typing import Dict, Optional, Protocol, runtime_checkable

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


class StubBrokerClient(BrokerClientProtocol):
    """Simple in-memory broker implementation for early integration tests."""

    def __init__(self, starting_equity: float = 10_000.0, default_fill_price: float = 0.0) -> None:
        self._orders: Dict[str, BrokerOrder] = {}
        self._positions: Dict[str, BrokerPosition] = {}
        self._order_counter = count(1)
        self._starting_equity = starting_equity
        self._cash = starting_equity
        self._default_fill_price = default_fill_price

    async def place_order(self, order: BrokerOrderRequest) -> BrokerOrder:
        order_id = f"stub-{next(self._order_counter)}"
        fill_price = order.limit_price if order.limit_price is not None else self._default_fill_price
        broker_order = BrokerOrder(
            id=order_id,
            symbol=order.symbol,
            side=order.side,
            qty=order.qty,
            order_type=order.order_type,
            time_in_force=order.time_in_force,
            limit_price=order.limit_price,
            status="filled",
            filled_qty=order.qty,
            avg_fill_price=fill_price,
            created_at=datetime.utcnow(),
        )
        self._orders[order_id] = broker_order
        self._apply_fill(order, fill_price)
        return broker_order

    async def cancel_order(self, order_id: str) -> None:
        existing = self._orders.get(order_id)
        if existing and existing.status not in {"filled", "canceled"}:
            self._orders[order_id] = existing.copy(update={"status": "canceled"})

    async def fetch_order(self, order_id: str) -> BrokerOrder:
        if order_id not in self._orders:
            raise KeyError(f"Unknown stub order id: {order_id}")
        return self._orders[order_id]

    async def fetch_open_orders(self) -> list[BrokerOrder]:
        return [order for order in self._orders.values() if order.status not in {"filled", "canceled"}]

    async def fetch_positions(self) -> list[BrokerPosition]:
        return list(self._positions.values())

    async def fetch_account(self) -> BrokerAccountSnapshot:
        unrealized = sum((pos.unrealized_pnl or 0.0) for pos in self._positions.values())
        equity = self._cash + unrealized
        buying_power = self._cash
        return BrokerAccountSnapshot(
            equity=equity,
            cash=self._cash,
            buying_power=buying_power,
            last_equity=self._starting_equity,
        )

    def _apply_fill(self, order: BrokerOrderRequest, fill_price: float) -> None:
        cash_delta = -fill_price * order.qty if order.side == BrokerSide.BUY else fill_price * order.qty
        self._cash += cash_delta
        self._update_position(order, fill_price)

    def _update_position(self, order: BrokerOrderRequest, fill_price: float) -> None:
        position = self._positions.get(order.symbol)
        signed_qty = self._signed_quantity(position)
        delta_qty = order.qty if order.side == BrokerSide.BUY else -order.qty
        new_signed_qty = signed_qty + delta_qty

        if new_signed_qty == 0:
            if order.symbol in self._positions:
                del self._positions[order.symbol]
            return

        same_direction = (
            signed_qty == 0
            or (signed_qty > 0 and delta_qty > 0)
            or (signed_qty < 0 and delta_qty < 0)
        )
        if same_direction:
            prev_abs = abs(signed_qty)
            total = prev_abs + abs(delta_qty)
            prev_cost = position.avg_entry_price * prev_abs if position else 0.0
            avg_price = (prev_cost + fill_price * abs(delta_qty)) / total if total else fill_price
        else:
            flipped_direction = (signed_qty > 0 and new_signed_qty < 0) or (signed_qty < 0 and new_signed_qty > 0)
            avg_price = fill_price if flipped_direction else (position.avg_entry_price if position else fill_price)

        side = BrokerSide.BUY if new_signed_qty > 0 else BrokerSide.SELL
        self._positions[order.symbol] = BrokerPosition(
            symbol=order.symbol,
            qty=abs(new_signed_qty),
            side=side,
            avg_entry_price=avg_price,
            unrealized_pnl=0.0,
        )

    @staticmethod
    def _signed_quantity(position: Optional[BrokerPosition]) -> float:
        if position is None:
            return 0.0
        return position.qty if position.side == BrokerSide.BUY else -position.qty


STUB_BROKER_CLIENT = StubBrokerClient()
