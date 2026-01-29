@echo off
chcp 65001 > nul
echo ========================================
echo   TheZonePOS 업데이트 배포 스크립트
echo ========================================
echo.

:: 버전 번호 입력
set /p VERSION="새 버전 번호를 입력하세요 (예: 1.0.1): "

if "%VERSION%"=="" (
    echo 버전 번호가 필요합니다!
    pause
    exit /b 1
)

echo.
echo [1/4] Frontend 빌드 중...
cd /d C:\Users\Luckyhan\web2pos\frontend
call npm run build
if errorlevel 1 (
    echo Frontend 빌드 실패!
    pause
    exit /b 1
)

echo.
echo [2/4] build.zip 생성 중...
cd /d C:\Users\Luckyhan\web2pos\update-server\public
if exist build.zip del build.zip
powershell -command "Compress-Archive -Path 'C:\Users\Luckyhan\web2pos\frontend\build\*' -DestinationPath 'build.zip' -Force"
if errorlevel 1 (
    echo ZIP 생성 실패!
    pause
    exit /b 1
)

echo.
echo [3/4] version.json 업데이트 중...
powershell -command "$json = Get-Content 'version.json' | ConvertFrom-Json; $json.version = '%VERSION%'; $json.releaseDate = (Get-Date -Format 'yyyy-MM-dd'); $json | ConvertTo-Json | Set-Content 'version.json'"

echo.
echo [4/4] Firebase에 배포 중...
cd /d C:\Users\Luckyhan\web2pos\update-server
call firebase deploy --only hosting

echo.
echo ========================================
echo   배포 완료! v%VERSION%
echo ========================================
echo.
echo 업데이트 서버: https://ezorder-platform.web.app
echo.
pause
