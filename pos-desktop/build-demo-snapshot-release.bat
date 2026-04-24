@echo off

REM =============================================================================

REM 데모 스냅샷 + 실행파일 + zip (압축 해제 후 Setup에서 Restaurant ID만 연결)

REM

REM 사전 준비:

REM   1) 현재 매장의 web2pos.db 복사

REM   2) (권장) ID 제거:  node pos-desktop\scripts\strip-demo-restaurant-id.mjs "C:\경로\web2pos.db"

REM   3) 이 배치 실행 전 CMD에서 스냅샷 경로 지정:

REM        set DEMO_SNAPSHOT_DB=C:\경로\web2pos.db

REM

REM 동작: 버전 bump -> BUILD_DEMO=1 + DEMO_SNAPSHOT_DB 로 build.bat -> build:win:demo

REM       -> dist29\Thezone_Demo-win-unpacked.zip 생성 (폴더째 압축)

REM =============================================================================

setlocal



if "%DEMO_SNAPSHOT_DB%"=="" (

  echo.

  echo [ERROR] DEMO_SNAPSHOT_DB 가 비어 있습니다.

  echo   예: set DEMO_SNAPSHOT_DB=C:\Users\Me\Desktop\demo-web2pos.db

  echo   그 다음 이 파일을 다시 실행하세요.

  echo.

  exit /b 1

)



if not exist "%DEMO_SNAPSHOT_DB%" (

  echo [ERROR] 파일 없음: "%DEMO_SNAPSHOT_DB%"

  exit /b 1

)



cd /d "%~dp0"



echo [0/4] Bump patch version...

echo ------------------------------------------------

node scripts\bump-desktop-version.mjs

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: Version bump failed.

  exit /b 1

)

echo.



echo [1/4] build.bat ^(BUILD_DEMO=1 + snapshot DB^) ...

echo ------------------------------------------------

set BUILD_DEMO=1

call build.bat

set BUILD_DEMO=

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: build.bat failed!

  exit /b 1

)

echo.



echo [2/4] npm run build:win:demo ...

echo ------------------------------------------------

cd /d "%~dp0"

call npm run build:win:demo

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: npm run build:win:demo failed!

  exit /b 1

)

echo.



echo [3/4] Zipping win-unpacked ^(압축 해제 후 Thezone_Demo.exe 실행^) ...

echo ------------------------------------------------

set "UNPACKED=%~dp0dist29\win-unpacked"

set "ZIPOUT=%~dp0dist29\Thezone_Demo-win-unpacked.zip"

if not exist "%UNPACKED%" (

  echo [ERROR] "%UNPACKED%" 없음. electron-builder 출력 경로를 확인하세요.

  exit /b 1

)

powershell -NoProfile -Command "Compress-Archive -Path '%UNPACKED%' -DestinationPath '%ZIPOUT%' -Force"

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: ZIP failed

  exit /b 1

)

echo Created: "%ZIPOUT%"

echo.



echo ================================================

echo Demo snapshot release done.

echo   - Installer/Portable: dist29\Thezone_Demo_*-Setup.exe / Thezone_Demo_*-Portable.exe

echo   - Zip (extract-and-run): dist29\Thezone_Demo-win-unpacked.zip

echo.

echo 수신자: zip 풀기 -^> win-unpacked\Thezone_Demo.exe 실행 -^> Setup에서

echo   Restaurant ID 입력 + Verify -^> Service Mode 확인 -^>

echo   "Use Existing Data" 선택(데모 빌드는 기본 선택) -^> Complete Setup

echo ================================================

endlocal

