@echo off
setlocal

REM Bootstraps JDK 17 + Android SDK (local) for sideload builds.
REM Then you can run build-apk-sideload.bat

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup-android-build.ps1" %*

endlocal

