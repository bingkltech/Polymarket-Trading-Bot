@echo off
title Polymarket Trading Bot
echo Starting Polymarket Trading Bot...
cd /d "%~dp0"

:: Run the bot using the dev script (tsx)
npm run dev

pause
