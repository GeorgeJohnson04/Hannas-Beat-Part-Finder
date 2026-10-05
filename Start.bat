@echo off
title Hanna's Beat
cd /d "%~dp0"

where node >NUL 2>NUL
if errorlevel 1 (
    echo.
    echo   Node.js isn't installed yet. It's the only thing this needs.
    echo   Opening the download page now. Grab the LTS one, install it,
    echo   then double click Start.bat again.
    echo.
    start "" https://nodejs.org/en/download
    pause
    exit /b
)

node server.js
pause
