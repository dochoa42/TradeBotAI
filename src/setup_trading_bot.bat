@echo off
setlocal

echo ==============================
echo Trading Bot 2 - First-time Setup
echo ==============================
echo.

REM Go to the folder this script is in
cd /d "%~dp0"

REM ---------- FRONTEND ----------
if exist "node_modules" (
    echo [Frontend] node_modules already exists - skipping npm install.
) else (
    echo [Frontend] Installing npm packages...
    npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed. Make sure Node.js is installed and try again.
        pause
        exit /b 1
    )
)

REM ---------- BACKEND ----------
cd backend

if exist ".venv\Scripts\python.exe" (
    echo [Backend] .venv already exists - skipping venv creation and pip install.
) else (
    echo [Backend] Creating Python 3.11 virtual environment...
    py -3.11 -m venv .venv
    if errorlevel 1 (
        echo [ERROR] Could not create virtual env. Check Python installation.
        pause
        exit /b 1
    )

    echo [Backend] Installing Python dependencies...
    ".\.venv\Scripts\python.exe" -m pip install --upgrade pip
    ".\.venv\Scripts\python.exe" -m pip install fastapi "uvicorn[standard]" httpx pydantic numpy pandas scikit-learn
    if errorlevel 1 (
        echo [ERROR] pip install failed. Check network and try again.
        pause
        exit /b 1
    )
)

echo.
echo ==============================
echo Setup complete!
echo Next steps:
echo   1) Run run_backend.bat
echo   2) Run run_frontend.bat
echo ==============================
echo.
pause
endlocal
