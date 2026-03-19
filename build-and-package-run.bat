@echo off
chcp 65001 >nul
setlocal

echo ================================================
echo TheZonePOS - 전체 빌드 + 패키징 + 실행
echo (설치 exe / 포터블 exe 생성 후 실행)
echo ================================================
echo.

set ROOT_DIR=%~dp0
set DESKTOP_DIR=%ROOT_DIR%pos-desktop

REM 1) 빌드 + 패키징
call "%DESKTOP_DIR%build-and-package-win.bat"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: 빌드 실패!
  pause
  exit /b 1
)
echo.

REM 2) 포터블 exe 실행 (설치 없이)
set DIST_DIR=%DESKTOP_DIR%dist22
for %%F in ("%DIST_DIR%\*Portable*.exe") do (
  echo [실행] %%F
  start "" "%%F"
  goto :done
)
echo [경고] 포터블 exe를 찾을 수 없습니다. dist22 폴더를 확인하세요.
:done

echo.
echo ================================================
echo 완료! TheZonePOS 포터블 앱이 실행됩니다.
echo ================================================
