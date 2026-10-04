@echo off
title Polymarket Trading Bot
echo Starting Polymarket Trading Bot on port 3002...
cd /d "%~dp0"
set DASHBOARD_PORT=3002

:: Run the bot using the dev script (tsx)
npm run dev

pause

