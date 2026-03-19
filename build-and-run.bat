@echo off
chcp 65001 >nul
setlocal

echo ================================================
echo TheZonePOS - 빌드 후 실행
echo ================================================
echo.

set ROOT_DIR=%~dp0
set DESKTOP_DIR=%ROOT_DIR%pos-desktop

REM 1) 빌드 실행 (build.bat)
echo [1/2] 프로젝트 빌드 중...
call "%DESKTOP_DIR%build.bat"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: 빌드 실패!
  pause
  exit /b 1
)
echo.

REM 2) pos-desktop 실행 (빌드된 frontend-build + backend 사용)
echo [2/2] TheZonePOS 앱 실행...
cd /d "%DESKTOP_DIR%"
call npm run start
