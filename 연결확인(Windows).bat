@echo off
rem Checks the connection between the Claude desktop app and this browser. ASCII only on purpose.
cd /d "%~dp0"
node check-claude.js
echo.
echo Please send a screenshot of this window.
pause
