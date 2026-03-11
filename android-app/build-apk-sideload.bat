@echo off
setlocal

REM Build a signed Release APK for sideload (no Play Store).
REM Output: android-app\dist-apk\table-order-app-release.apk

set ROOT_DIR=%~dp0
set ANDROID_DIR=%ROOT_DIR%android
set OUT_DIR=%ROOT_DIR%dist-apk
set APK_PATH=%ANDROID_DIR%\app\build\outputs\apk\release\app-release.apk
set LOCAL_PROPERTIES=%ANDROID_DIR%\local.properties
set LOCAL_TOOLS_DIR=%ROOT_DIR%.build-tools
set LOCAL_JDK=%LOCAL_TOOLS_DIR%\jdk-17
set LOCAL_SDK=%LOCAL_TOOLS_DIR%\android-sdk

echo ================================================
echo WEB2POS Table Order - Sideload APK Build
echo ================================================
echo.

if not exist "%OUT_DIR%" mkdir "%OUT_DIR%" >nul 2>nul

REM ----------------------------------------------------------------
REM Environment checks (JDK + Android SDK)
REM ----------------------------------------------------------------
REM Prefer locally bootstrapped JDK (android-app\.build-tools\jdk-17)
if exist "%LOCAL_JDK%\bin\java.exe" (
  set "JAVA_HOME=%LOCAL_JDK%"
  set "PATH=%JAVA_HOME%\bin;%PATH%"
  goto :java_ok
)

if not "%JAVA_HOME%"=="" (
  if exist "%JAVA_HOME%\bin\java.exe" (
    set "PATH=%JAVA_HOME%\bin;%PATH%"
    goto :java_ok
  ) else (
    echo ERROR: JAVA_HOME is set but java.exe not found:
    echo   %JAVA_HOME%\bin\java.exe
    exit /b 1
  )
)

where java >nul 2>nul
if errorlevel 1 (
  echo ERROR: Java (JDK) not found.
  echo - Run: setup-android-build.bat  ^(auto installs local JDK+SDK^)
  echo   or install JDK 17 then set JAVA_HOME / PATH.
  exit /b 1
)
:java_ok

set SDK_DIR=
REM Prefer locally bootstrapped Android SDK (android-app\.build-tools\android-sdk)
if exist "%LOCAL_SDK%\cmdline-tools" (
  set "SDK_DIR=%LOCAL_SDK%"
  set "ANDROID_SDK_ROOT=%SDK_DIR%"
  goto :sdk_ok
)

if not "%ANDROID_SDK_ROOT%"=="" set "SDK_DIR=%ANDROID_SDK_ROOT%"
if not "%ANDROID_HOME%"=="" set "SDK_DIR=%ANDROID_HOME%"
if "%SDK_DIR%"=="" if exist "%LOCALAPPDATA%\Android\Sdk" set "SDK_DIR=%LOCALAPPDATA%\Android\Sdk"

if "%SDK_DIR%"=="" (
  echo ERROR: Android SDK not found.
  echo - Run: setup-android-build.bat  ^(auto installs local JDK+SDK^)
  echo   or install Android Studio/SDK then set ANDROID_SDK_ROOT (or ANDROID_HOME).
  exit /b 1
)
:sdk_ok

REM Ensure local.properties points to the current machine SDK path (avoid user-specific committed path)
echo sdk.dir=%SDK_DIR:\=\\%> "%LOCAL_PROPERTIES%"

echo [1/2] Building Release APK...
echo ------------------------------------------------
cd /d "%ANDROID_DIR%"
call gradlew.bat assembleRelease
if %ERRORLEVEL% NEQ 0 (
  echo ERROR: APK build failed!
  exit /b 1
)

echo.
echo [2/2] Copying APK to dist-apk...
echo ------------------------------------------------
if not exist "%APK_PATH%" (
  echo ERROR: APK not found: %APK_PATH%
  exit /b 1
)

copy /y "%APK_PATH%" "%OUT_DIR%\table-order-app-release.apk" >nul

echo.
echo ================================================
echo DONE!
echo APK: %OUT_DIR%\table-order-app-release.apk
echo ================================================

endlocal

