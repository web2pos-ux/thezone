param(
  [switch]$BuildApk
)

$ErrorActionPreference = "Stop"

function Write-Section($title) {
  Write-Host ""
  Write-Host "================================================"
  Write-Host $title
  Write-Host "================================================"
}

function Ensure-Dir($p) {
  if (!(Test-Path -LiteralPath $p)) { New-Item -ItemType Directory -Path $p | Out-Null }
}

function Download-File($url, $destPath) {
  Write-Host "Downloading:"
  Write-Host "  $url"
  Write-Host "To:"
  Write-Host "  $destPath"
  Invoke-WebRequest -Uri $url -OutFile $destPath -UseBasicParsing
}

function Expand-ZipTo($zipPath, $destDir) {
  Ensure-Dir $destDir
  Expand-Archive -LiteralPath $zipPath -DestinationPath $destDir -Force
}

function Set-EnvForSession($name, $value) {
  Set-Item -Path ("Env:{0}" -f $name) -Value $value
  Write-Host "Set $name=$value"
}

function Prepend-PathForSession($dir) {
  if ([string]::IsNullOrWhiteSpace($dir)) { return }
  if (!(Test-Path -LiteralPath $dir)) { return }
  $current = $env:Path
  if ($current -notlike "$dir;*") {
    $env:Path = "$dir;$current"
  }
}

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$toolsDir = Join-Path $root ".build-tools"
$jdkDir = Join-Path $toolsDir "jdk-17"
$sdkRoot = Join-Path $toolsDir "android-sdk"
$cmdlineToolsRoot = Join-Path $sdkRoot "cmdline-tools"
$cmdlineLatest = Join-Path $cmdlineToolsRoot "latest"
$androidDir = Join-Path $root "android"
$localPropsPath = Join-Path $androidDir "local.properties"

Ensure-Dir $toolsDir

Write-Section "1) Ensure JDK 17 (local)"

$javaOk = $false
try {
  if ($env:JAVA_HOME -and (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\\java.exe"))) {
    $javaOk = $true
  } else {
    & java -version *> $null
    $javaOk = $true
  }
} catch {}

if (-not $javaOk) {
  Ensure-Dir $jdkDir

  $tmpZip = Join-Path $toolsDir "temurin-jdk17-win.zip"
  # Eclipse Temurin 17 (Windows x64, GA). This endpoint returns a zip binary.
  $jdkUrl = "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"

  Download-File $jdkUrl $tmpZip

  $extractDir = Join-Path $toolsDir "jdk-17-extract"
  if (Test-Path -LiteralPath $extractDir) { Remove-Item -Recurse -Force -LiteralPath $extractDir }
  Expand-ZipTo $tmpZip $extractDir

  $candidate = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
  if (-not $candidate) { throw "Failed to locate extracted JDK directory." }

  if (Test-Path -LiteralPath $jdkDir) { Remove-Item -Recurse -Force -LiteralPath $jdkDir }
  Move-Item -LiteralPath $candidate.FullName -Destination $jdkDir
  Remove-Item -Recurse -Force -LiteralPath $extractDir

  Set-EnvForSession "JAVA_HOME" $jdkDir
} else {
  Write-Host "JDK detected (JAVA_HOME or java on PATH)."
  if (-not $env:JAVA_HOME) {
    Write-Host "NOTE: JAVA_HOME is not set; build may still work via PATH."
  }
}

if ($env:JAVA_HOME) {
  Prepend-PathForSession (Join-Path $env:JAVA_HOME "bin")
}

Write-Section "2) Ensure Android SDK (cmdline-tools + packages) (local)"

Ensure-Dir $sdkRoot
Ensure-Dir $cmdlineToolsRoot

$sdkManagerBat = Join-Path $cmdlineLatest "bin\\sdkmanager.bat"
$needCmdline = -not (Test-Path -LiteralPath $sdkManagerBat)

if ($needCmdline) {
  $tmpZip = Join-Path $toolsDir "android-cmdline-tools-win.zip"
  # Official stable "latest" link. If Google updates the version behind this URL, the filename may change but link stays stable.
  $cmdlineUrl = "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  Download-File $cmdlineUrl $tmpZip

  $extractDir = Join-Path $toolsDir "android-cmdline-extract"
  if (Test-Path -LiteralPath $extractDir) { Remove-Item -Recurse -Force -LiteralPath $extractDir }
  Expand-ZipTo $tmpZip $extractDir

  # Zip contains cmdline-tools/{bin,lib,...}. We need cmdline-tools/latest/{bin,lib,...}
  $cmdlineSource = Join-Path $extractDir "cmdline-tools"
  if (-not (Test-Path -LiteralPath $cmdlineSource)) { throw "Unexpected cmdline-tools zip layout (missing cmdline-tools folder)." }

  if (Test-Path -LiteralPath $cmdlineLatest) { Remove-Item -Recurse -Force -LiteralPath $cmdlineLatest }
  Ensure-Dir $cmdlineLatest

  Get-ChildItem -LiteralPath $cmdlineSource | ForEach-Object {
    Move-Item -LiteralPath $_.FullName -Destination $cmdlineLatest
  }

  Remove-Item -Recurse -Force -LiteralPath $extractDir
}

$sdkManagerBat = Join-Path $cmdlineLatest "bin\\sdkmanager.bat"
if (-not (Test-Path -LiteralPath $sdkManagerBat)) {
  throw "sdkmanager.bat not found after install: $sdkManagerBat"
}

Set-EnvForSession "ANDROID_SDK_ROOT" $sdkRoot
Prepend-PathForSession (Join-Path $cmdlineLatest "bin")
Prepend-PathForSession (Join-Path $sdkRoot "platform-tools")

Write-Host "Accepting Android SDK licenses..."
$yes = ("y`n" * 400)
$yes | & $sdkManagerBat --sdk_root="$sdkRoot" --licenses | Out-Host

Write-Host "Installing required SDK packages..."
& $sdkManagerBat --sdk_root="$sdkRoot" "platform-tools" "platforms;android-34" "build-tools;34.0.0" "ndk;25.1.8937393" "cmake;3.22.1" | Out-Host

Write-Section "3) Write android/local.properties for this machine"

$sdkDirEscaped = ($sdkRoot -replace '\\','\\')
"sdk.dir=$sdkDirEscaped" | Set-Content -LiteralPath $localPropsPath -Encoding ASCII
Write-Host "Wrote: $localPropsPath"
Write-Host "  sdk.dir=$sdkRoot"

Write-Section "4) Next step"
Write-Host "Environment ready for Gradle build."
Write-Host "You can now run:"
Write-Host "  android-app\\build-apk-sideload.bat"

if ($BuildApk) {
  Write-Section "5) Building APK now (-BuildApk)"
  & (Join-Path $root "build-apk-sideload.bat")
}

