@echo off
REM === Trading Bot 2 launcher ===

REM Make sure we're on the correct drive
E:

REM === Start BACKEND (FastAPI / Uvicorn) in its own window ===
start "TradingBot2 Backend" cmd /k ^
 "cd "G:\Trading Bot V2.1\backend\" && uvicorn main:app --reload --port 8000"

REM === Start FRONTEND (Vite / React) in its own window ===
start "TradingBot2 Frontend" cmd /k ^
 "cd "G:\Trading Bot V2.1\trading-bot-ui\" && npm run dev"

REM Optional: keep this starter window clean and exit
exit
