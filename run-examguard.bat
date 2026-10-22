@echo off
setlocal
set "ROOT=%~dp0"

if not exist "%ROOT%detection\.venv\Scripts\python.exe" (
    echo Python environment not found: %ROOT%detection\.venv
    echo Create the environment and install detection\requirements.txt first.
    pause
    exit /b 1
)

where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo Node.js and npm were not found. Install Node.js, then try again.
    pause
    exit /b 1
)

where py.exe >nul 2>nul
if errorlevel 1 (
    echo Python Launcher was not found. Install Python, then try again.
    pause
    exit /b 1
)

start "ExamGuard - Backend" /D "%ROOT%backend" cmd.exe /k "npm.cmd install && npm.cmd start"
start "ExamGuard - MediaPipe" /D "%ROOT%" cmd.exe /k ""%ROOT%detection\.venv\Scripts\python.exe" "%ROOT%detection\tes.py""
start "ExamGuard - Website" /D "%ROOT%" cmd.exe /k "py.exe -m http.server 8080"

timeout /t 5 /nobreak >nul
start "" "http://127.0.0.1:8080"
