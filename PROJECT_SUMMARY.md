# TradeBotAI Workspace Summary (Nov 27, 2025)

## Mission Snapshot

- Full-stack research and paper-trading lab that pairs a FastAPI backend (`backend/`) and an experimental synthetic-data FastAPI (`main.py`) with a Vite/React TypeScript UI (`src/`).
- Backend responsibilities span market data ingestion (Binance + Alpaca), CSV caching, indicator/feature engineering, ML model inference, Bollinger/AI backtests, and a paper-trading router backed by SQLite (`backend/paper_trading.db`).
- Frontend delivers four major views (Dashboard, Multi-Chart, Simulation Desk, Live Trading) that visualize `lightweight-charts`, AI markers, and live/paper status via `/api/*` endpoints.
- Supporting assets include model artifacts (`backend/models/`), labeled datasets (`backend/data/datasets/`), Windows batch scripts for local workflows, and dual Python/Node toolchains.

## Runtime Components

- `main.py`: standalone FastAPI that emits random OHLCV bars documented in `README.md`; useful for decoupled UI prototyping.
- `backend/main.py`: production FastAPI app that exposes `/api` routes for candles, history downloads, ML signal prediction, Bollinger backtests, paper/live trading controls, and strategy library endpoints. Imports `pandas`, `numpy`, `joblib`, `scikit-learn`, `httpx`, etc.
- `src/`: Vite React SPA (TypeScript) orchestrated by `App.tsx` (~1,600 LOC) with domain-specific components (`components/`), API helpers (`api/`), indicator catalog config, and shared types.
- `backend/ml/`: offline tooling for AI signal synthesis and batch backtests; ties into `backend/models/` artifacts.
- Batch scripts (`run_backend.bat`, `run_frontend.bat`, `setup_trading_bot.bat`, `start_trading_bot2.bat`) codify Windows-friendly dev workflows.

## Top-Level Map

| Path                                                                                                        | Role                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `main.py`                                                                                                   | Synthetic FastAPI for lightweight candle demos; referenced by `README.md`.                                                  |
| `backend/`                                                                                                  | Primary trading backend (FastAPI app, data providers, ML, storage, live trading, SQLite DB, `.venv/`, `.vscode/`).          |
| `src/`                                                                                                      | React 18 + TS + Vite frontend, including `components/`, `api/`, `config/`, `types/`, and `utils/`.                          |
| `public/public/`                                                                                            | Only holds `favicon.svg`; duplicated inside `dist/public/`.                                                                 |
| `dist/`                                                                                                     | Built Vite output (`index.html`, hashed assets, duplicated `public/`).                                                      |
| `requirements.txt`                                                                                          | Minimal dependency list (FastAPI stack + `pyarrow`, `httpx`, `python-dotenv`); missing several imports used by the backend. |
| `package.json`                                                                                              | Frontend scripts (`vite`, `tsc -b`) and deps (`react`, `lightweight-charts`, `recharts`, Tailwind pipeline).                |
| `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `tsconfig.json`, `tsconfig.tsbuildinfo`        | Frontend build/styling/compiler plumbing; dev proxy to `http://127.0.0.1:8000` for `/api`.                                  |
| `run_backend.bat`, `run_frontend.bat`, `setup_trading_bot.bat`, `start_trading_bot2.bat`, `run_backend.txt` | Windows helpers for environment setup and launching backend/frontend servers.                                               |
| `.venv/`, `backend/.venv/`, `.vscode/`, `__pycache__/`                                                      | Tooling artifacts for Python and VS Code.                                                                                   |
| `node_modules/`                                                                                             | Installed npm packages; large and typically git-ignored.                                                                    |
| `backend/data/`                                                                                             | Cached CSV histories (BTC/ETH 1m–1h) and parquet datasets (`datasets/BTCUSDT_1m_L5_T0.3.parquet`).                          |
| `backend/models/`                                                                                           | Serialized RandomForest models + metadata (`model_v1.pkl`, `rf_BTCUSDT_1m.pkl`, `.meta.json`).                              |
| `TradeBotAI/`                                                                                               | Nested Git repo stub (`.git/`, `.gitattributes`)—likely leftover submodule marker.                                          |
| `trading-bot-ui/trading-bot-ui/.env`                                                                        | Legacy UI environment placeholder; not referenced by current Vite app.                                                      |
| `Big picture data flow.docx`, `temp.txt`, `index.html`                                                      | Miscellaneous documentation/scratch artifacts.                                                                              |

## Backend Highlights (`backend/`)

- **API & routing**: `main.py` (backend) registers CORS, symbol whitelists, `/api/candles` (Binance, CSV, Alpaca via `binance_client.py`/`alpaca_client.py`/`data_providers.py`), `/api/history/download`, `/api/model/predict`, `/api/backtest/bollinger`, `/api/ai/signals`, plus routers for live trading (`live_trading.py`) and strategy library (`strategy_library.py`).
- **Data ingestion**: `fetch_history.py` and `data_providers.py` bridge Binance REST downloads into `backend/data/*.csv`; `CandleProvider` abstraction allows swapping to API/CSV/Alpaca providers.
- **Indicators & features**: `indicators.py` (pandas-ta classic), `feature_engineering.py`, and `features.py` compute Bollinger/SMA/EMA/RSI features consumed by ML models and backtests.
- **Model lifecycle**: `build_dataset.py` builds parquet datasets, `train_model.py` trains RandomForest models saved under `backend/models/`, `model_service.py` loads cached payloads for inference, and `ml/backtest_engine.py` + `ml/ai_signals.py` evaluate/synthesize AI signals.
- **Backtesting**: `backtest.py` exposes Bollinger backtests plus helper metrics (Sharpe, max drawdown, win%); `load_candles_dataframe` centralizes CSV loading.
- **Live & risk**: `live_trading.py` exposes `/api/live/*` endpoints for paper engine status/orders/equity resets; `broker_client.py` defines broker interface, `risk.py` enforces kill-switches and per-trade guards, `storage.py` persists trades/equity/backtest summaries in SQLite (WAL mode files tracked).
- **Config & secrets**: `config.py` reads environment variables (Binance, Alpaca keys) via `python-dotenv`; ensure `.env` handling aligns with deployment.

## Frontend Highlights (`src/`)

- **Shell (`App.tsx`)**: Handles navigation state, provider selection (`csv`/`api`/`alpaca`), indicator toggles, AI thresholding, multi-chart tile management, AI marker overlays, history download commands, and live trading interactions.
- **Components**: `components/ChartPanel.tsx`, `MultiChartGrid.tsx`, `SimulationDesk.tsx`, `SimulationViewer.tsx`, `DashboardView.tsx`, `LiveTradingPanel.tsx`, `StrategyComparisonCard.tsx`, `StrategyLibraryPanel.tsx`, `TvCandles.tsx`, `CandlesWithMarkers.tsx`, `LiveCandlesPanel.tsx` provide chart rendering, layout, and analytics widgets.
- **API helpers**: `api/liveTrading.ts` and `api/strategyLibrary.ts` wrap backend endpoints with typed responses (status, trades, strategies, comparisons, resets, kill switch, etc.).
- **Config & types**: `config/indicatorCatalog.ts` defines UI-driven indicator metadata; `types/trading.ts` centralizes domain types (candles, trades, equity points, providers, live state) shared across components.
- **Utilities & styling**: `utils/strategyLibrary.ts` houses helper transforms; `index.css`, Tailwind (`tailwind.config.js`, `postcss.config.js`) plus `vite.config.ts` manage styling and dev proxying.

## Data, Models, and Assets

- **Historical data**: CSV snapshots per symbol/interval under `backend/data/` plus parquet training datasets under `backend/data/datasets/`.
- **Model artifacts**: `backend/models/*.pkl` + `.meta.json` for RandomForest predictors (`model_v1.pkl`, `model_rf_v1.pkl`, `rf_BTCUSDT_1m.pkl`).
- **SQLite state**: `backend/paper_trading.db`, `.db-wal`, `.db-shm` store trades/equity/backtests for the paper engine; confirm whether these should remain versioned.
- **Static assets**: `public/public/favicon.svg` and `dist/public/favicon.svg`; duplication suggests the asset pipeline can be flattened.

## Tooling & Automation

- **Python environments**: Root `.venv/` and `backend/.venv/` coexist; clarify which interpreter scripts should activate (`setup_trading_bot.bat` currently bootstraps backend). Ensure `requirements.txt` (root) includes every imported package (pandas, numpy, scikit-learn, joblib, pandas-ta-classic, sqlite-utils, etc.).
- **Node builds**: `package.json` + `tsconfig.json` + `tsconfig.tsbuildinfo` handle Vite builds. `node_modules/` and `dist/` are generated artifacts.
- **Batch scripts**: `run_backend.bat` runs `uvicorn backend.main:app --reload`; `run_frontend.bat` drives `npm run dev`; `setup_trading_bot.bat` chains Python venv creation + dependency installs; `start_trading_bot2.bat` appears to orchestrate both services sequentially.

## Current Issues & Fix Ideas

1. **README misalignment (`README.md`)**: Only documents the synthetic `main.py` service, ignoring the real backend/frontend stack. Update to describe the Trading Bot architecture, setup steps for both servers, and how to use batch scripts.
2. **Incomplete dependencies (`requirements.txt`)**: Backend imports `pandas`, `numpy`, `scikit-learn`, `joblib`, `pandas-ta-classic`, `sqlite-utils`, etc., but the file lists only FastAPI basics plus `pyarrow`, `httpx`, `python-dotenv`. Extend the requirements list or split into backend-specific `requirements-backend.txt` to prevent runtime import errors.
3. **Duplicated asset roots (`public/public`, `dist/public`)**: Having nested `public/public/favicon.svg` plus the same asset copied to `dist/public/` hints at incorrect `publicDir` handling in `vite.config.ts`. Consider moving assets to a single `public/` root and pointing Vite there to avoid confusion.
4. **Synthetic vs. real backend split (`main.py` vs. `backend/main.py`)**: Two FastAPI apps with overlapping routes (`/api/candles`) can confuse deployment scripts. Decide whether the synthetic service should be a separate example (e.g., move into `examples/`) or clearly document which entry point `uvicorn` should run in production.
5. **Version-controlled stateful artifacts (`backend/paper_trading.db*`, `dist/`, `node_modules/`)**: Database WAL files and build outputs are currently present. Ensure `.gitignore` excludes them unless intentionally committed. Storing database snapshots in git risks leaking sensitive trade/test data.
6. **Legacy directories (`TradeBotAI/`, `trading-bot-ui/`)**: Nested `.git/` and unused `.env` files suggest unfinished submodules or legacy code. Confirm whether these should be removed, migrated, or documented to prevent accidental edits.
7. **Dual Python environments (`.venv/` and `backend/.venv/`)**: Having two venvs increases setup friction and complicates batch scripts. Consider consolidating to one venv at the repo root (or documenting why two are required).
8. **Lack of automated tests**: No pytest/unit tests exist for either backend or frontend. Adding regression tests (e.g., for `backtest.py`, `model_service.py`, UI hooks) would help validate trading logic and indicator math changes.

Use this document as the authoritative snapshot for ChatGPT or other reviewers to understand the workspace structure, identify problem areas quickly, and prioritize fixes.
