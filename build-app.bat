@echo off
chcp 65001 >nul
echo ================================================
echo TheZonePOS - 최신 코드로 앱 빌드
echo ================================================
echo.

set ROOT_DIR=%~dp0
set DESKTOP_DIR=%ROOT_DIR%pos-desktop

echo [1/2] build.bat 실행 (프론트엔드 빌드 + 백엔드 복사 + DB 준비)...
call "%DESKTOP_DIR%\build.bat"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: 빌드 준비 실패!
  pause
  exit /b 1
)
echo.

echo [2/2] Electron 앱 패키징 (NSIS 설치파일 + Portable)...
cd /d "%DESKTOP_DIR%"
call npm run build:win
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Electron 빌드 실패!
  pause
  exit /b 1
)
echo.

echo ================================================
echo 빌드 완료!
echo.
echo 출력 위치: %DESKTOP_DIR%\dist22\
echo   - TheZonePOS Setup 1.0.22.exe (설치형)
echo   - TheZonePOS-Portable-1.0.22.exe (포터블)
echo ================================================
pause
