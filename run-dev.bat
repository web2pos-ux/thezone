@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  pause
  exit /b 1
)

node run-launcher.js
pause
