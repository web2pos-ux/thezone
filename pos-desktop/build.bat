@echo off
echo ================================================
echo WEB2POS Build Script
echo ================================================
echo.

REM Path variables
set ROOT_DIR=%~dp0..
set FRONTEND_DIR=%ROOT_DIR%\frontend
set BACKEND_DIR=%ROOT_DIR%\backend
set DESKTOP_DIR=%~dp0

echo [1/5] Building Frontend...
echo ------------------------------------------------
cd /d "%FRONTEND_DIR%"
if "%BUILD_DEMO%"=="1" (
  echo BUILD_DEMO=1 -^> frontend build:demo ^(REACT_APP_WEB2POS_DEMO^)
  call npm run build:demo
) else (
  call npm run build
)
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Frontend build failed!
    exit /b 1
)
echo Frontend build completed.
echo.

echo [2/5] Copying Frontend Build...
echo ------------------------------------------------
if exist "%DESKTOP_DIR%frontend-build" rmdir /s /q "%DESKTOP_DIR%frontend-build"
xcopy /s /e /i /y "%FRONTEND_DIR%\build" "%DESKTOP_DIR%frontend-build"
echo Frontend copied.
echo.

echo [3/5] Copying Backend...
echo ------------------------------------------------
if exist "%DESKTOP_DIR%backend" rmdir /s /q "%DESKTOP_DIR%backend"
mkdir "%DESKTOP_DIR%backend"

REM Copy backend (no node_modules, uploads, db)
xcopy /s /e /i /y "%BACKEND_DIR%\*.js" "%DESKTOP_DIR%backend\"
xcopy /s /e /i /y "%BACKEND_DIR%\routes" "%DESKTOP_DIR%backend\routes\"
xcopy /s /e /i /y "%BACKEND_DIR%\services" "%DESKTOP_DIR%backend\services\"
xcopy /s /e /i /y "%BACKEND_DIR%\utils" "%DESKTOP_DIR%backend\utils\"
xcopy /s /e /i /y "%BACKEND_DIR%\config" "%DESKTOP_DIR%backend\config\"
xcopy /s /e /i /y "%BACKEND_DIR%\printer-presets" "%DESKTOP_DIR%backend\printer-presets\"
copy /y "%BACKEND_DIR%\package.json" "%DESKTOP_DIR%backend\"
copy /y "%BACKEND_DIR%\package-lock.json" "%DESKTOP_DIR%backend\"
echo Backend copied.
echo.

echo [4/5] Installing Backend Dependencies...
echo ------------------------------------------------
cd /d "%DESKTOP_DIR%backend"
call npm install --production
echo Backend dependencies installed.
echo.

echo [5/7] Generating Empty Database Template...
echo ------------------------------------------------
cd /d "%BACKEND_DIR%"
if not exist "%DESKTOP_DIR%db-empty" mkdir "%DESKTOP_DIR%db-empty"
call node scripts\create-empty-db-for-build.js
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to generate empty database template!
    exit /b 1
)
echo Empty database template generated.
echo.

echo [6/7] Copying Empty Database for New Restaurant...
echo ------------------------------------------------
if exist "%DESKTOP_DIR%db" rmdir /s /q "%DESKTOP_DIR%db"
mkdir "%DESKTOP_DIR%db"

REM Optional: set DEMO_SNAPSHOT_DB=full path to web2pos.db before build to bundle snapshot
if not exist "%DESKTOP_DIR%db-empty\web2pos.db" (
    echo ERROR: Missing %DESKTOP_DIR%db-empty\web2pos.db
    exit /b 1
)
copy /y "%DESKTOP_DIR%db-empty\web2pos.db" "%DESKTOP_DIR%db\"
echo Empty database copied for new restaurant installation.
if defined DEMO_SNAPSHOT_DB (
    if exist "%DEMO_SNAPSHOT_DB%" (
        copy /y "%DEMO_SNAPSHOT_DB%" "%DESKTOP_DIR%db\web2pos.db"
        echo DEMO_SNAPSHOT_DB applied: "%DEMO_SNAPSHOT_DB%"
    ) else (
        echo ERROR: DEMO_SNAPSHOT_DB file not found: "%DEMO_SNAPSHOT_DB%"
        exit /b 1
    )
)

echo.
echo [7/7] Resetting Setup Status for Fresh Installation...
echo ------------------------------------------------
REM Reset setup-status.json (UTF-8 no BOM)
powershell -Command "[IO.File]::WriteAllText('%DESKTOP_DIR%backend\config\setup-status.json', '{\"isFirstRun\":true,\"setupCompleted\":false,\"storeName\":\"\",\"restaurantId\":null,\"setupDate\":null}', (New-Object System.Text.UTF8Encoding $false))"
echo Setup status reset for new restaurant.
echo.

cd /d "%DESKTOP_DIR%"

echo ================================================
echo Build preparation completed!
echo.
echo Now run: npm run dist  (or: npm run build:win)
echo ================================================
