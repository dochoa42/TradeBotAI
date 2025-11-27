# TradeBotAI Workspace Summary (updated Nov 26, 2025)

## Purpose & Flow

- Full-stack crypto trading research environment combining FastAPI services (`backend/` and root-level `main.py`) with a Vite/React front-end (`src/`) and supporting ML/offline tooling.
- Backend exposes REST endpoints for synthetic candles, Binance-powered history download, AI signal generation, Bollinger/ML backtests, dataset building, and an in-memory paper-trading engine with risk controls and SQLite persistence.
- Frontend delivers dashboard, multi-chart, simulation, and live-trading experiences that call the `/api` routes and visualize candles, indicators, and performance analytics.
- Data/ML layer stores historical CSVs and parquet datasets under `backend/data/`, plus trained model payloads in `backend/models/`, enabling offline training scripts (`build_dataset.py`, `train_model.py`) and runtime inference (`model_service.py`).

## Technology Stack

- **Backend**: FastAPI + Uvicorn (`requirements.txt`), extensive use of `pandas`, `numpy`, `joblib`, `httpx`, `scikit-learn`, `pandas-ta-classic`, etc. (imports reveal these extra dependencies are required even though they are not listed in `requirements.txt`).
- **Frontend**: React 18 + TypeScript + Vite 5 (`package.json`), `lightweight-charts`, `recharts`, custom indicator catalog plus Tailwind CSS (`tailwind.config.js`, `postcss.config.js`).
- **Storage**: SQLite WAL database (`backend/paper_trading.db*`) managed via `backend/storage.py` for paper trades, equity history, resets, and backtest summaries.
- **Tooling**: Node-based build artifacts (`dist/`, `node_modules/`), Python virtual environments (`.venv/`, `backend/.venv/`), VS Code settings (`.vscode/`).
- **Scripts**: Windows batch helpers for setup and runtime orchestration (`run_backend.bat`, `run_frontend.bat`, `setup_trading_bot.bat`, `start_trading_bot2.bat`, plus `run_backend.txt` with inline instructions).

## Top-Level Layout

| Path / File                                                                                                 | Role & Notes                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.py`                                                                                                   | Standalone FastAPI service that emits synthetic OHLCV candles for quick UI prototyping (`README.md` documents this minimal API).                                                                                                                       |
| `backend/`                                                                                                  | Primary trading backend with FastAPI app (`backend/main.py`), data ingestion, ML, backtesting, live-paper trading router, and SQLite persistence. Includes its own `.venv/` and `.vscode/`.                                                            |
| `src/`                                                                                                      | Vite/React TypeScript SPA: `App.tsx` orchestration (1.5k LOC) plus domain-specific components (Dashboard, MultiChartGrid, SimulationDesk, LiveTradingPanel, TvCandles). Contains `api/` clients, `config/indicatorCatalog.ts`, and `types/trading.ts`. |
| `public/public/`                                                                                            | Static assets currently only `favicon.svg`; note the double `public/` nesting.                                                                                                                                                                         |
| `dist/`                                                                                                     | Built frontend output (Vite) with `assets/`, duplicated `public/`, and production `index.html`.                                                                                                                                                        |
| `README.md`                                                                                                 | Describes the lightweight synthetic-candles API; does not yet reflect the richer backend/front-end stack.                                                                                                                                              |
| `requirements.txt`                                                                                          | Lists only `fastapi`, `uvicorn[standard]`, `pyarrow`; missing other backend dependencies mentioned earlier.                                                                                                                                            |
| `package.json` / `package-lock.json`                                                                        | Frontend dependencies & scripts (`dev`, `build`, `preview`).                                                                                                                                                                                           |
| `tailwind.config.js`, `postcss.config.js`, `tsconfig.json`, `tsconfig.tsbuildinfo`, `vite.config.ts`        | Frontend build, styling, and TS compiler configuration; proxy `/api` to `http://127.0.0.1:8000`.                                                                                                                                                       |
| `run_backend.bat`, `run_frontend.bat`, `setup_trading_bot.bat`, `start_trading_bot2.bat`, `run_backend.txt` | Windows automation for starting services, activating venvs, and guiding developers.                                                                                                                                                                    |
| `.venv/`, `.vscode/`, `__pycache__/`                                                                        | Environment/config artifacts at the repo root (Python venv, VS Code settings, bytecode caches).                                                                                                                                                        |
| `node_modules/`                                                                                             | Installed npm dependencies for the frontend workspace.                                                                                                                                                                                                 |
| `Big picture data flow.docx`                                                                                | Conceptual documentation artifact (binary, likely authored outside code).                                                                                                                                                                              |
| `TradeBotAI/`                                                                                               | Nested Git repo placeholder (`.git/`, `.gitattributes` only).                                                                                                                                                                                          |
| `trading-bot-ui/trading-bot-ui/.env`                                                                        | Legacy or alternate UI environment file; contents not referenced elsewhere.                                                                                                                                                                            |
| `temp.txt`, `index.html`, `run_backend.txt`, `run_backend.bat`, `run_backend.bat`                           | Miscellaneous helpers / placeholders.                                                                                                                                                                                                                  |

## Backend Highlights (`backend/`)

- **API entrypoint**: `backend/main.py` registers CORS, mounts `/api` routes, whitelists supported symbols, exposes health, candle retrieval (from Binance via `binance_client.py` or CSV via `data_providers.py`), history download, AI signals, Bollinger backtests, live trading router (`backend/live_trading.py`), and records backtest runs in SQLite.
- **Market data**: `binance_client.py` fetches klines with host fallback logic; `fetch_history.py` CLI dumps candles to `backend/data/*.csv`; `data_providers.py` supplies CSV-backed candles for offline use.
- **Indicator & feature engineering**: `indicators.py` (pandas-ta), `feature_engineering.py`, and `features.py` build the columns consumed by ML models and inference.
- **Backtesting & ML**:
  - `backtest.py` implements both signal-driven and Bollinger strategies plus metrics (win rate, profit factor, Sharpe, drawdown).
  - `ml/backtest_engine.py` runs dual (baseline vs AI) backtests and reports confusion matrices/feature importances from trained models.
  - `ml/ai_signals.py` synthesizes AI signals from CSV candles using Bollinger-based heuristics.
  - `build_dataset.py` and `train_model.py` create parquet datasets and RandomForest models saved under `backend/models/` (`model_v1.pkl`, `rf_BTCUSDT_1m.pkl`, etc. with `.meta.json`).
  - `model_service.py` loads cached models + metadata and turns candles into inference-ready feature matrices.
- **Live/paper trading**: `live_trading.py` exposes `/api/live/*` routes for paper status, order placement/cancellation, equity resets, kill switch, strategy analytics; integrates `risk.py` (kill switch + position/daily loss guards), `broker_client.py` (protocol + stub broker), and `storage.py` (SQLite CRUD + migrations for trades, equity, resets, backtests, strategy performance).
- **Data & persistence**: `backend/data/` stores raw CSVs per symbol/interval plus parquet datasets; `backend/models/` stores serialized models; `paper_trading.db`, `.db-wal`, `.db-shm` hold WAL-mode SQLite state.

## Frontend Highlights (`src/`)

- **Stateful shell**: `App.tsx` manages navigation (`Dashboard`, `Multi-Chart Grid`, `Simulation Desk`, `Live Trading`), symbol/timeframe selection, indicator toggles, AI/backtest requests, multi-chart tiling, and overlays (SMA/EMA/Bollinger) with helper utilities (SMA/EMA/StdDev implementations, random demo data fallback, API fetchers, tile factories).
- **Components**:
  - `components/ChartPanel.tsx` (indicator toggles), `MultiChartGrid.tsx`, `SimulationDesk.tsx` + `SimulationViewer.tsx`, `DashboardView.tsx`, `LiveTradingPanel.tsx`, `StrategyComparisonCard.tsx`, `TvCandles.tsx` (TradingView-like rendering).
  - Comments are sparse but logic handles chart overlays, AI markers (`TvMarkerData`), multi-symbol comparisons, simulation playback.
- **API clients**: `api/liveTrading.ts` mirrors FastAPI live routes (status, execution mode, orders, kill switch, equity resets, trades, summaries, strategy performance/comparison, flattening positions).
- **Config & types**: `config/indicatorCatalog.ts` defines available indicators and UI schema; `types/trading.ts` centralizes shared TypeScript types for candles, trades, equity points, live status, etc.
- **Entry & styling**: `main.tsx` bootstraps React, `index.css` + Tailwind pipeline supply styling, `vite.config.ts` proxies `/api` to backend in dev.

## Data, Models, and Assets

- `backend/data/*.csv` (BTCUSDT/ETHUSDT across 1m/5m/1h) plus `datasets/BTCUSDT_1m_L5_T0.3.parquet` for ML training.
- `backend/models/*.pkl` and corresponding `.meta.json` store RandomForest models with feature metadata consumed by `model_service.py` and `ml/backtest_engine.py`.
- `backend/paper_trading.db*` persists paper trading/equity/backtest records; be mindful of WAL companions (`.db-wal`, `.db-shm`).
- `public/public/favicon.svg` and `dist/` provide runtime/static assets; duplication suggests cleanup potential.
- `TradeBotAI/` nested Git repo and `trading-bot-ui/trading-bot-ui/.env` appear to be placeholders or historical artifacts—verify before deletion.

## Automation & Scripts

- Windows batch files at root (`run_backend.bat`, `run_frontend.bat`, `setup_trading_bot.bat`, `start_trading_bot2.bat`) wrap environment activation and dev server startup; `run_backend.txt` documents the same logic inline.
- Backend CLIs: `backend/fetch_history.py`, `backend/build_dataset.py`, `backend/train_model.py` for data acquisition and model training.
- `run_backend.bat` (root) expects `backend/main.py` and optionally activates `.venv` before running `uvicorn main:app`. Frontend script presumably runs `npm run dev` via Vite.

## Configuration & Environment Files

- Python: `.venv/`, `backend/.venv/`, `requirements.txt`, implicit dependencies from code imports (pandas, numpy, scikit-learn, pandas-ta-classic, httpx, joblib, sqlite3, etc.).
- Node/React: `package.json`, `package-lock.json`, `tsconfig.json`, `tailwind.config.js`, `postcss.config.js`, `vite.config.ts`, `tsconfig.tsbuildinfo` (TS incremental state).
- VS Code: `.vscode/` directories at root and inside `backend/` (contents not inspected, typically hold launch/settings).
- Misc: `TradeBotAI/.git`, `.gitattributes` (likely submodule), `trading-bot-ui/trading-bot-ui/.env` (env placeholders), `temp.txt` (scratch), `Big picture data flow.docx` (architecture diagram/reference).

## Notable Observations

- `README.md` only documents the standalone synthetic-candles FastAPI and does not mention the richer backend, UI, or ML tooling—consider expanding it or linking to this summary.
- `requirements.txt` omits several mandatory backend packages (pandas, numpy, httpx, joblib, scikit-learn, pandas-ta-classic, etc.); installing dependencies will currently fail unless developers infer them manually.
- Static assets are nested (`public/public`) and duplicated inside `dist/public`; verify whether Vite config should instead point to a single `public/` root.
- Multiple git roots (`.git/` at repo root and `TradeBotAI/.git/`) plus legacy folder `trading-bot-ui/trading-bot-ui` suggest prior restructuring—confirm whether they should remain or be merged.
- SQLite database files (`backend/paper_trading.db*`) are committed; ensure this is intentional if sensitive trade history should remain local.
- Generated artifacts (`node_modules/`, `dist/`, `tsconfig.tsbuildinfo`, `__pycache__/`, `.db-wal/.db-shm`) can be large; confirm `.gitignore` covers them if they should stay untracked.
