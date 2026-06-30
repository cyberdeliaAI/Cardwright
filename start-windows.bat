@echo off
setlocal

cd /d "%~dp0"

echo Starting Cardwright...
echo.
echo Open this URL in your browser:
echo http://127.0.0.1:8787
echo.
echo Press Ctrl+C in this window to stop the server.
echo.

node server.mjs

pause
