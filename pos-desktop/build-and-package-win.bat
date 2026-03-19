@echo off
setlocal

echo ================================================
echo TheZonePOS - Windows Build + Package (.exe)
echo ================================================
echo.

REM 경로 설정
set ROOT_DIR=%~dp0..
set FRONTEND_DIR=%ROOT_DIR%\frontend
set DESKTOP_DIR=%~dp0

REM 1) Frontend dependencies
if not exist "%FRONTEND_DIR%\node_modules" (
  echo [1/4] Installing Frontend dependencies...
  echo ------------------------------------------------
  cd /d "%FRONTEND_DIR%"
  call npm install
  if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend npm install failed!
    exit /b 1
  )
  echo.
) else (
  echo [1/4] Frontend node_modules already exists - skipping install.
  echo.
)

REM 2) pos-desktop dependencies (electron-builder 포함)
if not exist "%DESKTOP_DIR%node_modules" (
  echo [2/4] Installing pos-desktop dependencies...
  echo ------------------------------------------------
  cd /d "%DESKTOP_DIR%"
  call npm install
  if %ERRORLEVEL% NEQ 0 (
    echo ERROR: pos-desktop npm install failed!
    exit /b 1
  )
  echo.
) else (
  echo [2/4] pos-desktop node_modules already exists - skipping install.
  echo.
)

REM 3) 빌드 준비 (Frontend build + Backend copy + Empty DB)
echo [3/4] Preparing app resources (build.bat)...
echo ------------------------------------------------
call "%DESKTOP_DIR%build.bat"
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: build.bat failed!
  exit /b 1
)
echo.

REM 4) Electron 패키징 (.exe)
echo [4/4] Packaging Electron app (npm run build:win)...
echo ------------------------------------------------
cd /d "%DESKTOP_DIR%"
call npm run build:win
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Electron build failed!
  exit /b 1
)
echo.

echo ================================================
echo DONE!
echo - Output folder: pos-desktop\dist24
echo - Look for:
echo   - "TheZonePOS Setup *.exe"      (Installer)
echo   - "TheZonePOS-Portable-*.exe"   (Portable)
echo ================================================

