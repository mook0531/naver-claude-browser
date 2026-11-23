@echo off
rem Creates a desktop shortcut for the browser. ASCII only on purpose.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed. Install the LTS version from https://nodejs.org
  pause
  exit /b 1
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo The browser is not installed yet. Running the installer first...
  call npm install
  if not exist "node_modules\electron\dist\electron.exe" call node scripts\install-electron.js
)
node create-shortcut.js
pause
