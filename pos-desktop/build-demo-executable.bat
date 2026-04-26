@echo off
REM Demo exe: bump pos-desktop package.json patch, then build.bat + electron-builder demo.
REM Output: dist29\Thezone_Demo_<version>-Setup.exe, Thezone_Demo_<version>-Portable.exe
REM Optional: set DEMO_SNAPSHOT_DB=C:\full\path\web2pos.db
REM BUILD_DEMO=1 -> npm run build:demo

echo ================================================
echo Demo executable (version bump + package)
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

echo [0/3] Bump patch version (package.json) ...
echo ------------------------------------------------
node scripts\bump-desktop-version.mjs
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Version bump failed. Is Node.js installed?
  exit /b 1
)
echo.

echo [1/3] build.bat (BUILD_DEMO=1) ...
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

echo [2/3] npm run build:win:demo (Thezone_Demo_VERSION-*.exe) ...
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
