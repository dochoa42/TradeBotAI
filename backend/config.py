"""Central configuration for backend environment variables."""
from __future__ import annotations

import logging
import os
from typing import Final

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

APCA_API_KEY_ID: Final[str] = os.getenv("APCA_API_KEY_ID", "")
APCA_API_SECRET_KEY: Final[str] = os.getenv("APCA_API_SECRET_KEY", "")
ALPACA_DATA_BASE_URL: Final[str] = os.getenv(
    "ALPACA_DATA_BASE_URL", "https://data.alpaca.markets/v2"
)
ALPACA_TRADING_BASE_URL: Final[str] = os.getenv(
    "ALPACA_TRADING_BASE_URL", "https://paper-api.alpaca.markets/v2"
)

if not APCA_API_KEY_ID or not APCA_API_SECRET_KEY:
    logger.warning("Alpaca API keys missing; set APCA_API_KEY_ID and APCA_API_SECRET_KEY.")
