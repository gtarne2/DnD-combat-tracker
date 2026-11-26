@echo off
rem Stage O0 Owlbear bridge spike. Run from anywhere; results go to target\tmp\obr-spike.
setlocal
cd /d "%~dp0\..\.."
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
node tools\obr-spike\server.cjs
pause
