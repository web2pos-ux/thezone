@echo off
chcp 65001 >nul
setlocal

set "ROOT=%~dp0"
set "ICON=%ROOT%pos-desktop\icon.ico"
set "TARGET=%ROOT%TheZonePOS-실행.bat"
set "SHORTCUT=%USERPROFILE%\Desktop\TheZonePOS 실행.lnk"

if not exist "%TARGET%" (
  echo [오류] TheZonePOS-실행.bat 을 찾을 수 없습니다.
  pause
  exit /b 1
)

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; ^
   $s = $ws.CreateShortcut('%SHORTCUT%'); ^
   $s.TargetPath = '%TARGET%'; ^
   $s.WorkingDirectory = '%ROOT:~0,-1%'; ^
   $s.Description = 'TheZonePOS 개발 모드 실행'; ^
   if (Test-Path '%ICON%') { $s.IconLocation = '%ICON%'; }; ^
   $s.Save(); ^
   Write-Host '바탕화면에 TheZonePOS 실행 바로가기가 생성되었습니다.'"

if %ERRORLEVEL% NEQ 0 (
  echo [오류] 바로가기 생성 실패
  pause
  exit /b 1
)

echo.
echo 완료! 바탕화면에서 "TheZonePOS 실행"을 더블클릭하세요.
pause
