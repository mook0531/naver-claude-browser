@echo off
rem ASCII only on purpose: cmd.exe misreads UTF-8 Korean text in batch files.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto nonode

if exist "node_modules\electron\dist\electron.exe" goto run
echo First run: installing required files. This can take a few minutes...
rem A half-finished Electron download is not repaired by npm install, so remove it first.
if exist "node_modules\electron" rmdir /s /q "node_modules\electron"
call npm install
if errorlevel 1 goto fail
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
echo  2. Move this folder OUT of OneDrive, for example to C:\naver-claude-browser
echo  3. Run this file again.
pause
exit /b 1

:fail
echo.
echo [ERROR] Something went wrong. Please copy the messages above and send them.
pause
exit /b 1
