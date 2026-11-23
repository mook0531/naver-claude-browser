@echo off
rem One-click installer: browser + desktop shortcut + Claude app connection. ASCII only on purpose.
cd /d "%~dp0"
echo ============================================================
echo  Naver + Claude Browser - Installer
echo ============================================================

where node >/dev/null 2>nul
if errorlevel 1 goto nonode

echo.
echo [1/3] Installing the browser (first time: a few minutes)...
if exist "node_modules\@modelcontextprotocol\sdk\package.json" if exist "node_modules\electron\dist\electron.exe" goto shortcut
if exist "node_modules\electron" rmdir /s /q "node_modules\electron"
call npm install
if errorlevel 1 goto fail
if not exist "node_modules\electron\dist\electron.exe" call node scripts\install-electron.js
if not exist "node_modules\electron\dist\electron.exe" goto fail

:shortcut
echo.
echo [2/3] Creating the desktop icon...
node create-shortcut.js
if errorlevel 1 goto fail

echo.
echo [3/3] Connecting to the Claude desktop app...
node setup-claude.js
if errorlevel 1 goto fail

echo.
echo ============================================================
echo  Done. Open Claude, go to the Code tab, start a LOCAL session,
echo  and ask: search the weather on Naver.
echo ============================================================
pause
exit /b 0

:nonode
echo [ERROR] Node.js is not installed.
echo Install the LTS version from https://nodejs.org , then run this file again.
start "" https://nodejs.org
pause
exit /b 1

:fail
echo.
echo [ERROR] Installation stopped. Please send a screenshot of this window.
pause
exit /b 1
