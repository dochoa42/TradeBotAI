# Repository Guidelines

## Project Structure & Module Organization
TradeBotAI pairs a Python backend and a Vite/React frontend. `backend/` hosts the production FastAPI app plus data/ML helpers (`data/`, `models/`, `ml/`, CSV caches, SQLite files). `main.py` at repo root is a synthetic candle service for lightweight demos. The SPA lives under `src/` with `components/`, `api/`, `config/`, `types/`, and `utils/`; assets reside in `public/` and bundled output lands in `dist/`. Windows helpers such as `run_backend.bat`, `run_frontend.bat`, and `setup_trading_bot.bat` orchestrate local workflows.

## Build, Test, and Development Commands
Use `run_backend.bat` (or `python -m uvicorn backend.main:app --reload --port 8000`) to serve the primary API; `python main.py` stays available for synthetic data spikes. Frontend tasks sit in `package.json`: `npm run dev` launches Vite with proxying to `127.0.0.1:8000`, `npm run build` runs `tsc -b` then `vite build`, and `npm run preview` serves the optimized bundle. Run `setup_trading_bot.bat` once per machine to create the Python venv and install npm packages.

## Coding Style & Naming Conventions
Backend code targets Python 3.11, Pydantic v2, and FastAPI. Use 4-space indents, type hints, and docstrings for every public function; module and file names remain `snake_case`. Prefer dependency injection over globals; place reusable logic inside `backend/*.py` helpers instead of routes. Frontend files mirror Vite defaults: React components in PascalCase (`ChartPanel.tsx`), hooks/utilities camelCase, and TypeScript interfaces inside `types/`. Keep styles in Tailwind-friendly classes and lean on `config/indicatorCatalog.ts` for indicator metadata.

## Testing Guidelines
Automated tests are not yet committed, so seed suites before touching trading logic. Backend tests should live in `backend/tests/test_<feature>.py` and run with `pytest -q backend/tests`; target >80% coverage for risk, storage, and indicator math. Frontend stateful helpers belong under `src/__tests__/` and can use `npx vitest run`. For visual changes, capture screenshot diffs of Dashboard and Live Trading views.

## Commit & Pull Request Guidelines
Existing history favors short milestone prefixes (`P13A_14`, `Phase 13A_12`). Continue with `Phase<track>_<ticket>` or `P13A_<id>` and keep summaries under 60 characters. Each PR should describe the change set, list impacted endpoints or UI panels, link the relevant GitHub issue or Notion task, include backend/frontend checklist results, and attach before/after screenshots when UI changes occur.

## Security & Configuration Tips
Never commit `.env` or credentialed files; copy `backend/.env` to `.env.example` when adding new keys. API keys for Binance or Alpaca load through `backend/config.py`, so prefer `python-dotenv` over hard-coded strings. SQLite artifacts in `backend/paper_trading.db*` contain live trade history--wipe or redact before sharing logs. Frontend `.env` entries (for example `VITE_API_BASE`) belong in the repo root and should default to `http://127.0.0.1:8000`.
