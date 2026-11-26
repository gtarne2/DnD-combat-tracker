@echo off
rem Stage O0 Owlbear bridge spike. Results are saved in the "results" folder next to this file.
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
set "OBR_SPIKE_OUT=%~dp0results"
node "%~dp0server.cjs"
pause
