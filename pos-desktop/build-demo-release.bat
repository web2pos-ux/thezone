@echo off

REM =============================================================================

REM 데모 실행파일 빌드 (버전 bump + 패키징)

REM

REM 1) Back Office 버튼 비활성화: BUILD_DEMO=1 -> 프론트 build:demo (REACT_APP_WEB2POS_DEMO)

REM 2) web2pos.db 포함: 이 배치 실행 *전에* CMD에서 스냅샷 DB 경로 지정 (선택)

REM      set DEMO_SNAPSHOT_DB=C:\전체경로\web2pos.db

REM    지정하면 build.bat 이 파일을 pos-desktop\db\web2pos.db 로 복사해 패키지에 넣습니다.

REM    미지정 시 기존과 같이 빈 DB 템플릿이 들어갑니다.

REM =============================================================================



echo ================================================

echo WEB2POS Desktop DEMO release

echo ================================================

echo.



if defined DEMO_SNAPSHOT_DB (

  if exist "%DEMO_SNAPSHOT_DB%" (

    echo [INFO] DEMO_SNAPSHOT_DB 지정됨 - 패키지에 이 DB가 포함됩니다:

    echo        "%DEMO_SNAPSHOT_DB%"

  ) else (

    echo [WARN] DEMO_SNAPSHOT_DB 가 지정되었으나 파일이 없습니다. 무시합니다:

    echo        "%DEMO_SNAPSHOT_DB%"

  )

) else (

  echo [INFO] DEMO_SNAPSHOT_DB 없음 - 빈 DB 템플릿으로 패키징됩니다.

  echo        스냅샷 포함: set DEMO_SNAPSHOT_DB=C:\경로\web2pos.db 후 이 배치를 다시 실행하세요.

)

echo [INFO] Back Office 버튼 비활성화: BUILD_DEMO=1 ^(build:demo^)

echo.



cd /d "%~dp0"



echo [0/3] Bump patch version ^(pos-desktop\package.json^) ...

echo ------------------------------------------------

node scripts\bump-desktop-version.mjs

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: Version bump failed. Is Node.js installed?

  exit /b 1

)

echo.



echo [1/3] build.bat with BUILD_DEMO=1 ...

echo ------------------------------------------------

set BUILD_DEMO=1

call build.bat

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: build.bat failed!

  exit /b 1

)

set BUILD_DEMO=

echo.



echo [2/3] npm run build:win:demo ^(Thezone_Demo_VERSION-Setup.exe / Portable^) ...

echo ------------------------------------------------

cd /d "%~dp0"

call npm run build:win:demo

if %ERRORLEVEL% NEQ 0 (

  echo ERROR: npm run build:win:demo failed!

  exit /b 1

)



echo.

echo ================================================

echo Demo release build finished. Check dist29\

echo   - Thezone_Demo_VERSION-Setup.exe  ^(NSIS, VERSION = pos-desktop package.json^)

echo   - Thezone_Demo_VERSION-Portable.exe

echo.

echo 포함 내용: 데모 UI ^(Back Office 진입 버튼 비활성^)

if defined DEMO_SNAPSHOT_DB (

  if exist "%DEMO_SNAPSHOT_DB%" (

    echo            + 지정하신 web2pos.db 스냅샷

  ) else (

    echo            + DB: 빈 템플릿 ^(DEMO_SNAPSHOT_DB 경로 오류^)

  )

) else (

  echo            + DB: 빈 템플릿 ^(스냅샷은 set DEMO_SNAPSHOT_DB=...^)

)

echo ================================================

