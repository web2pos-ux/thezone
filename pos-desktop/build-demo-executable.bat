@echo off
REM Demo exe only. Does NOT bump pos-desktop package.json version.
REM Output: dist29\Thezone_Demo_<version>-Setup.exe, Thezone_Demo_<version>-Portable.exe
REM Optional: set DEMO_SNAPSHOT_DB=C:\full\path\web2pos.db
REM Back Office buttons off: BUILD_DEMO=1 -> npm run build:demo

echo ================================================
echo Demo executable (no version bump in package.json)
echo ================================================
echo.

if defined DEMO_SNAPSHOT_DB (
  if exist "%DEMO_SNAPSHOT_DB%" (
    echo [INFO] DEMO_SNAPSHOT_DB: "%DEMO_SNAPSHOT_DB%"
  ) else (
    echo [WARN] DEMO_SNAPSHOT_DB path not found, using empty DB template.
  )
) else (
  echo [INFO] DEMO_SNAPSHOT_DB not set - empty DB template.
)

cd /d "%~dp0"

echo [1/2] build.bat (BUILD_DEMO=1) ...
echo ------------------------------------------------
set BUILD_DEMO=1
call build.bat
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: build.bat failed!
  set BUILD_DEMO=
  exit /b 1
)
set BUILD_DEMO=
echo.

REM build.bat ends in repo\backend cwd — npm must run from pos-desktop
cd /d "%~dp0"

echo [2/2] npm run build:win:demo (Thezone_Demo_VERSION-*.exe) ...
echo ------------------------------------------------
call npm run build:win:demo
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: build:win:demo failed!
  exit /b 1
)

echo.
echo ================================================
echo Done. Output: dist29\
echo   Thezone_Demo_VERSION-Setup.exe
echo   Thezone_Demo_VERSION-Portable.exe
echo ================================================
