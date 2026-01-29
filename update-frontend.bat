@echo off
echo ========================================
echo   WEB2POS Frontend Update Script
echo ========================================
echo.

:: 현재 디렉토리 확인
cd /d "%~dp0"

echo [1/3] Building frontend...
cd frontend
call npm run build
if errorlevel 1 (
    echo ERROR: Build failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Creating update package...
cd ..
if exist "update-package" rmdir /s /q "update-package"
mkdir "update-package"
xcopy /e /i /y "frontend\build" "update-package\build"

echo.
echo [3/3] Compressing...
powershell -command "Compress-Archive -Path 'update-package\build' -DestinationPath 'WEB2POS-Update-%date:~0,4%%date:~5,2%%date:~8,2%.zip' -Force"

echo.
echo ========================================
echo   Update package created!
echo   File: WEB2POS-Update-%date:~0,4%%date:~5,2%%date:~8,2%.zip
echo ========================================
echo.
echo Instructions for users:
echo 1. Close WEB2POS app
echo 2. Delete old frontend/build folder
echo 3. Extract this ZIP to frontend/ folder
echo 4. Restart WEB2POS app
echo.
pause
