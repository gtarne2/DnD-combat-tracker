@echo off
setlocal
set "AURORA_LAUNCHER_DIR=%~dp0"
if defined CARGO_TARGET_DIR (
    for %%I in ("%CARGO_TARGET_DIR%\release") do set "AURORA_RELEASE_DIR=%%~fI"
) else (
    for %%I in ("%AURORA_LAUNCHER_DIR%..\target\release") do set "AURORA_RELEASE_DIR=%%~fI"
)
set "AURORA_OUTPUT_DIR=%AURORA_RELEASE_DIR%"
if not "%~1"=="" set "AURORA_OUTPUT_DIR=%~f1"
if not exist "%AURORA_OUTPUT_DIR%\" mkdir "%AURORA_OUTPUT_DIR%" || exit /b 1
for %%F in (combat-sheet.exe aurora-party.exe) do (
    if not exist "%AURORA_RELEASE_DIR%\%%F" (
        echo Build both helpers with cargo build --release --bins first.
        exit /b 1
    )
    if /I not "%AURORA_OUTPUT_DIR%"=="%AURORA_RELEASE_DIR%" copy /Y "%AURORA_RELEASE_DIR%\%%F" "%AURORA_OUTPUT_DIR%\%%F" >nul || exit /b 1
)
for %%F in (SRD-5.1-NOTICES.txt SRD-5.2.1-NOTICES.txt) do (
    copy /Y "%AURORA_LAUNCHER_DIR%..\content\monster-packs\%%F" "%AURORA_OUTPUT_DIR%\%%F" >nul || exit /b 1
)
rem Optional private DM window (R79): copy the WebView2 SDK DLLs when launcher\webview2 has them.
for %%F in (Microsoft.Web.WebView2.Core.dll Microsoft.Web.WebView2.WinForms.dll WebView2Loader.dll) do (
    if exist "%AURORA_LAUNCHER_DIR%webview2\%%F" copy /Y "%AURORA_LAUNCHER_DIR%webview2\%%F" "%AURORA_OUTPUT_DIR%\%%F" >nul || exit /b 1
)
"%SystemRoot%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /optimize+ /out:"%AURORA_OUTPUT_DIR%\Aurora Combat Tracker.exe" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll /resource:"%AURORA_LAUNCHER_DIR%..\src\combat\party.js",party.js /resource:"%AURORA_LAUNCHER_DIR%dm-dashboard.html",dm-dashboard.html /resource:"%AURORA_LAUNCHER_DIR%dm-dashboard.js",dm-dashboard.js /resource:"%AURORA_LAUNCHER_DIR%dm-initiative.js",dm-initiative.js /resource:"%AURORA_LAUNCHER_DIR%dm-monsters.js",dm-monsters.js /resource:"%AURORA_LAUNCHER_DIR%dm-monster-assist.js",dm-monster-assist.js /resource:"%AURORA_LAUNCHER_DIR%dm-monster-actions.js",dm-monster-actions.js /resource:"%AURORA_LAUNCHER_DIR%dm-dashboard.css",dm-dashboard.css "%AURORA_LAUNCHER_DIR%TrackerLauncher.cs" "%AURORA_LAUNCHER_DIR%RefreshBridge.cs" "%AURORA_LAUNCHER_DIR%PartySession.cs" "%AURORA_LAUNCHER_DIR%DmWindow.cs"
exit /b %errorlevel%
