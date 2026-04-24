$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$env:BUILD_DEMO = '1'
try {
  cmd /c "call `"$PSScriptRoot\build.bat`""
  if ($LASTEXITCODE -ne 0) { throw "build.bat failed" }
} finally {
  Remove-Item Env:\BUILD_DEMO -ErrorAction SilentlyContinue
}
npm run build:win:demo
if ($LASTEXITCODE -ne 0) { throw "build:win:demo failed" }
Write-Host "Done: dist29\Thezone_Demo_<version>-Setup.exe and Thezone_Demo_<version>-Portable.exe"
