# Synthetic Candles API

Minimal FastAPI service that emits lightweight OHLCV candles for frontend prototyping.

## Requirements

- Python 3.11+
- pip packages: `fastapi`, `uvicorn[standard]`

Install dependencies (inside your preferred virtualenv):

```bash
pip install fastapi "uvicorn[standard]"
```

## Running the server

```bash
uvicorn main:app --reload --port 8000
```

The API is CORS-enabled for `http://localhost:5173` and `http://127.0.0.1:5173`, matching the default Vite dev server origins.

## Endpoints

- `GET /api/health` – simple readiness probe.
- `GET /api/candles?count=200` – returns synthetic OHLCV data (Unix timestamps in seconds). The `count` query parameter caps at 500 bars.

Example request:

```bash
curl http://127.0.0.1:8000/api/candles?count=50
```

The response is a JSON array of Candle objects:

```json
[
  {
    "time": 1700000000,
    "open": 29111.5,
    "high": 29163.94,
    "low": 29098.44,
    "close": 29120.02,
    "volume": 64.38
  }
]
```

Use the payload directly with `lightweight-charts` or other charting libraries while your production data pipeline is still under construction.
