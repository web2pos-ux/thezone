@echo off
chcp 65001 >nul
cd /d "%~dp0"

REM Node.js 확인
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 Node.js를 설치한 후 다시 실행하세요.
  pause
  exit /b 1
)

node run-launcher.js

if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [오류] 실행 중 문제가 발생했습니다.
  pause
  exit /b 1
)

pause
