@echo off
rem Registers this browser as a tool in the Claude desktop app. ASCII only on purpose.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install the LTS version from https://nodejs.org
  start "" https://nodejs.org
  pause
  exit /b 1
)
if exist "node_modules\@modelcontextprotocol\sdk\package.json" if exist "node_modules\electron\dist\electron.exe" goto setup
echo Installing required files first. This can take a few minutes...
if exist "node_modules\electron" rmdir /s /q "node_modules\electron"
call npm install
if not exist "node_modules\electron\dist\electron.exe" call node scripts\install-electron.js
if not exist "node_modules\electron\dist\electron.exe" (
  echo [ERROR] Install failed. Please send a screenshot of this window.
  pause
  exit /b 1
)
:setup
node setup-claude.js
pause
