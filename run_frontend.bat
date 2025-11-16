@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules" (
    echo [ERROR] node_modules not found. Run setup_trading_bot.bat first.
    pause
    exit /b 1
)

echo Starting frontend (Vite)...
npm run dev
endlocal
