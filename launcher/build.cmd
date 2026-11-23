@echo off
setlocal
set "AURORA_LAUNCHER_DIR=%~dp0"
set "AURORA_OUTPUT_DIR=%AURORA_LAUNCHER_DIR%..\target\release"
if not exist "%AURORA_OUTPUT_DIR%\combat-sheet.exe" (
    echo Build combat-sheet.exe with cargo build --release --bin combat-sheet first.
    exit /b 1
)
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /out:"%AURORA_OUTPUT_DIR%\Aurora Combat Tracker.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll "%AURORA_LAUNCHER_DIR%TrackerLauncher.cs"
exit /b %errorlevel%
