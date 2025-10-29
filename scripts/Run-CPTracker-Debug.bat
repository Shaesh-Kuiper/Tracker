@echo off
setlocal
cd /d "%~dp0\..\dist" 2>nul || (
  echo Could not find dist folder next to this script.
  echo Build the exe first: npm run build:exe
  pause
  exit /b 1
)
echo Starting CPTracker.exe ...
echo (A browser tab should open automatically when the server starts)
echo.
CPTracker.exe
echo.
echo If it closed unexpectedly, check logs at: %CD%\logs\cptracker.log
echo Press any key to close this window...
pause >nul
