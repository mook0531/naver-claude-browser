@echo off
rem ASCII only on purpose: cmd.exe misreads UTF-8 Korean text in batch files.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if not exist "node_modules\@modelcontextprotocol\sdk\package.json" goto install
if exist "node_modules\electron\dist\electron.exe" goto run
:install
echo First run: installing required files. This can take a few minutes...
rem A half-finished Electron download is not repaired by npm install, so remove it first.
if exist "node_modules\electron" rmdir /s /q "node_modules\electron"
call npm install
if errorlevel 1 goto fail
rem npm 12+ skips dependency install scripts, so download the Electron app directly as well.
if not exist "node_modules\electron\dist\electron.exe" call node scripts\install-electron.js
if not exist "node_modules\electron\dist\electron.exe" goto noelectron

:run
echo Starting Naver + Claude Browser...
call npm start
if errorlevel 1 goto fail
exit /b 0

:nonode
echo [ERROR] Node.js is not installed.
echo Install the LTS version from https://nodejs.org , then run this file again.
start "" https://nodejs.org
pause
exit /b 1

:noelectron
echo.
echo [ERROR] Electron could not be downloaded.
echo  1. Check your internet connection.
echo  2. Make sure antivirus or a company firewall is not blocking github.com downloads.
echo  3. Send a screenshot of this window.
pause
exit /b 1

:fail
echo.
echo [ERROR] Something went wrong. Please copy the messages above and send them.
pause
exit /b 1
