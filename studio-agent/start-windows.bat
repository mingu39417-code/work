@echo off
rem Studio Agent launcher for Windows - double-click to run.
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Install the LTS version from https://nodejs.org and run this file again.
  echo.
  start "" "https://nodejs.org"
  pause
  exit /b 1
)
title Studio Agent
node launcher.mjs
