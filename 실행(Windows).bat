@echo off
rem ASCII only on purpose: cmd.exe misreads UTF-8 Korean text in batch files.
cd /d "%~dp0"

where node >/dev/null 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\electron\dist\electron.exe" goto run
echo First run: installing required files. This can take a few minutes...
call npm install
if errorlevel 1 goto fail

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

:fail
echo.
echo [ERROR] Something went wrong. Please copy the messages above and send them.
pause
exit /b 1
