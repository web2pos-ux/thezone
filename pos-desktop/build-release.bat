@echo off
REM Release: bump pos-desktop package.json patch version, then build.bat + electron-builder.
echo ================================================
echo WEB2POS Desktop RELEASE build (version bump + package)
echo ================================================
echo.

cd /d "%~dp0"

echo [0/3] Bump patch version...
echo ------------------------------------------------
node scripts\bump-desktop-version.mjs
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: Version bump failed. Is Node.js installed?
  exit /b 1
)
echo.

echo [1/3] build.bat ...
echo ------------------------------------------------
call build.bat
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: build.bat failed!
  exit /b 1
)
echo.

echo [2/3] npm run build:win ...
echo ------------------------------------------------
REM build.bat ends in repo backend cwd; electron-builder must run from pos-desktop
cd /d "%~dp0"
call npm run build:win
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: npm run build:win failed!
  exit /b 1
)

echo.
echo ================================================
echo Release build finished. Check dist29\
echo ================================================
