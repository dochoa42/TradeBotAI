"""Strategy library endpoints for Phase 13.2."""

from __future__ import annotations

import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Query

from models import StrategyDefinition, StrategyDefinitionIn
from storage import list_strategy_definitions, upsert_strategy_definition

router = APIRouter(prefix="/api/strategies", tags=["strategy-library"])


def _serialize_row(row) -> StrategyDefinition:
    return StrategyDefinition(
        id=int(row["id"]),
        symbol=row["symbol"],
        strategy_name=row["strategy_name"],
        indicators_json=row["indicators_json"],
        notes=row["notes"] or "",
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def _normalize_symbol(symbol: str) -> str:
    normalized = (symbol or "").strip().upper()
    if not normalized:
        raise HTTPException(status_code=400, detail="symbol is required")
    return normalized


def _normalize_strategy_name(strategy_name: str) -> str:
    normalized = (strategy_name or "").strip()
    if not normalized:
        raise HTTPException(status_code=400, detail="strategy_name is required")
    return normalized


def _normalize_indicators_json(raw: str) -> str:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid indicators_json: {exc}") from exc

    if not isinstance(parsed, list):
        raise HTTPException(
            status_code=400,
            detail="indicators_json must encode a JSON list",
        )

    # Re-serialize to ensure consistent formatting
    return json.dumps(parsed, separators=(",", ":"))


@router.get("", response_model=List[StrategyDefinition])
async def list_strategies(symbol: Optional[str] = Query(None)) -> List[StrategyDefinition]:
    """Return known strategies for an optional symbol filter."""

    rows = list_strategy_definitions(symbol)
    return [_serialize_row(row) for row in rows]


@router.post("", response_model=StrategyDefinition)
async def save_strategy(definition: StrategyDefinitionIn) -> StrategyDefinition:
    """Create or update a strategy library entry."""

    normalized_symbol = _normalize_symbol(definition.symbol)
    normalized_strategy = _normalize_strategy_name(definition.strategy_name)
    normalized_json = _normalize_indicators_json(definition.indicators_json)
    notes_value = definition.notes or ""

    row = upsert_strategy_definition(
        symbol=normalized_symbol,
        strategy_name=normalized_strategy,
        indicators_json=normalized_json,
        notes=notes_value,
    )
    return _serialize_row(row)
