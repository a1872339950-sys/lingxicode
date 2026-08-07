param(
  [switch]$SkipPack,
  [string]$OutputRoot = '',
  [string]$WebView2Directory = '',
  [string]$WebView2LoaderPath = ''
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

if (-not $OutputRoot) {
  $OutputRoot = if ($env:LINGXI_INSTALLER_OUTPUT) {
    $env:LINGXI_INSTALLER_OUTPUT
  } else {
    Join-Path $Root '.installer-build'
  }
}
$BuildRoot = [System.IO.Path]::GetFullPath($OutputRoot)

function Assert-X64PortableExecutable([string]$path) {
  if (-not (Test-Path -LiteralPath $path)) { throw "Missing x64 native dependency: $path" }
  $stream = [System.IO.File]::OpenRead($path)
  try {
    $reader = New-Object System.IO.BinaryReader($stream)
    $stream.Position = 0x3c
    $peOffset = $reader.ReadInt32()
    $stream.Position = $peOffset + 4
    $machine = $reader.ReadUInt16()
    if ($machine -ne 0x8664) {
      throw ("Native dependency must be x64 (machine 0x8664), got 0x{0:X4}: {1}" -f $machine, $path)
    }
  }
  finally { $stream.Dispose() }
}
$InstallerRoot = Join-Path $Root 'installer'
$Source = Join-Path $InstallerRoot 'LingxiInstaller\Installer.cs'
$WebGlScene = Join-Path $InstallerRoot 'LingxiInstaller\WebGlScene.html'
$WebView2Dir = if ($WebView2Directory) {
  $WebView2Directory
} elseif ($env:LINGXI_WEBVIEW2_DIR) {
  $env:LINGXI_WEBVIEW2_DIR
} else {
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\PrivateAssemblies'
}
$WebView2Core = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Core.dll'
$WebView2Wpf = Join-Path $WebView2Dir 'Microsoft.Web.WebView2.Wpf.dll'
$WebView2Loader = if ($WebView2LoaderPath) {
  $WebView2LoaderPath
} elseif ($env:LINGXI_WEBVIEW2_LOADER) {
  $env:LINGXI_WEBVIEW2_LOADER
} else {
  'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\IDE\CommonExtensions\Microsoft\Markdown\runtimes\win-x64\native\WebView2Loader.dll'
}
$PayloadDir = Join-Path $BuildRoot 'payload'
$DistDir = Join-Path $BuildRoot 'installer'
$AppDir = Join-Path $BuildRoot 'dist\win-unpacked'
$PayloadZip = Join-Path $PayloadDir 'app.zip'
$Uninstaller = Join-Path $DistDir 'LingxiUninstall.exe'
$SetupName = ([string][char]0x7075 + [string][char]0x7280 + ' LingXiCode Installer 1.0.0.exe')
$Setup = Join-Path $DistDir $SetupName
$ProductName = ([string][char]0x7075 + [string][char]0x7280 + ' LingXiCode')

function Remove-PathIfExists([string]$path) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

function Resolve-AppIconPath([string]$root) {
  $preferred = Join-Path $root 'build\icon.ico'
  if (Test-Path -LiteralPath $preferred) {
    return (Resolve-Path -LiteralPath $preferred).Path
  }
  $fallback = Get-ChildItem -LiteralPath $root -File -Filter '*.ico' -ErrorAction SilentlyContinue |
    Sort-Object Length -Descending |
    Select-Object -First 1
  if ($fallback) {
    return $fallback.FullName
  }
  throw 'App icon not found. Expected build\icon.ico or a root *.ico.'
}

function Resolve-RceditPath([string]$root) {
  # Prefer electron-builder x64 rcedit; electron-winstaller vendor binary may fail with Unable to load file.
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\rcedit-x64.exe'),
    (Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign\winCodeSign-2.6.0\rcedit-ia32.exe'),
    (Join-Path $root 'node_modules\electron-winstaller\vendor\rcedit.exe')
  )
  foreach ($candidate in $candidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Resolve-Path -LiteralPath $candidate).Path
    }
  }
  $found = Get-ChildItem -LiteralPath (Join-Path $root 'node_modules') -Recurse -Filter 'rcedit*.exe' -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($found) {
    return $found.FullName
  }
  throw 'rcedit.exe not found. Install electron-builder/electron-winstaller tools first.'
}

function Ensure-AppExeIcon([string]$appDir, [string]$root, [string]$productName) {
  $appExe = Join-Path $appDir 'lingxi-lingxicode.exe'
  if (-not (Test-Path -LiteralPath $appExe)) {
    throw "Missing app executable: $appExe"
  }

  $iconPath = Resolve-AppIconPath $root
  $rcedit = Resolve-RceditPath $root
  Write-Host "Applying app icon: $iconPath"
  Write-Host "Using rcedit: $rcedit"

  & $rcedit $appExe --set-icon $iconPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set app icon on $appExe (exit=$LASTEXITCODE)"
  }

  & $rcedit $appExe --set-version-string ProductName $productName
  & $rcedit $appExe --set-version-string FileDescription $productName
  & $rcedit $appExe --set-version-string InternalName 'lingxi-lingxicode'
  & $rcedit $appExe --set-version-string OriginalFilename 'lingxi-lingxicode.exe'

  $vi = [Diagnostics.FileVersionInfo]::GetVersionInfo((Resolve-Path -LiteralPath $appExe).Path)
  if ($vi.ProductName -notmatch 'LingXiCode') {
    throw "App product metadata not updated: ProductName=$($vi.ProductName)"
  }
  Write-Host "App icon applied: ProductName=$($vi.ProductName); FileDescription=$($vi.FileDescription)"
}

Write-Host "Root=$Root"
Write-Host "BuildRoot=$BuildRoot"

if (-not $SkipPack) {
  Remove-PathIfExists (Join-Path $BuildRoot 'dist')
  Remove-PathIfExists $PayloadZip
  Remove-PathIfExists $Uninstaller
  Remove-PathIfExists $Setup

  Push-Location $Root
  try {
    npx electron-builder --dir "--config.directories.output=$($BuildRoot)\dist"
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed (exit=$LASTEXITCODE)" }
  } finally { Pop-Location }
}

if (-not (Test-Path -LiteralPath $AppDir)) { throw "Missing app output: $AppDir" }

# Desktop/start-menu shortcuts use the installed main exe icon.
# Force-write logo into the packaged exe before zipping payload.
Ensure-AppExeIcon -appDir $AppDir -root $Root -productName $ProductName

New-Item -ItemType Directory -Force $PayloadDir, $DistDir | Out-Null
if (Test-Path -LiteralPath $PayloadZip) { Remove-Item -LiteralPath $PayloadZip -Force }
if (Test-Path -LiteralPath $Uninstaller) { Remove-Item -LiteralPath $Uninstaller -Force }
if (Test-Path -LiteralPath $Setup) { Remove-Item -LiteralPath $Setup -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem | Out-Null
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $AppDir,
  $PayloadZip,
  [System.IO.Compression.CompressionLevel]::Optimal,
  $false
)
if (-not (Test-Path -LiteralPath $PayloadZip) -or (Get-Item -LiteralPath $PayloadZip).Length -le 0) {
  throw 'Payload compression failed: app.zip missing or empty.'
}

$cscCandidates = @(
  "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
  "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319\csc.exe"
)
$csc = $cscCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $csc) { throw 'No .NET Framework csc.exe found.' }

function Resolve-AssemblyRef([string]$name) {
  $frameworkPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
  $direct = Join-Path $frameworkPath $name
  if (Test-Path $direct) { return $direct }
  $assemblyRoot = Join-Path $env:WINDIR 'Microsoft.NET\assembly'
  $found = Get-ChildItem $assemblyRoot -Recurse -Filter $name -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
  if ($found) { return $found }
  return $name
}

$refs = @(
  'System.dll',
  'System.Core.dll',
  'System.Xaml.dll',
  'System.Web.Extensions.dll',
  'System.IO.Compression.dll',
  'System.IO.Compression.FileSystem.dll',
  'System.Windows.Forms.dll',
  'PresentationCore.dll',
  'PresentationFramework.dll',
  'WindowsBase.dll',
  'Microsoft.CSharp.dll'
)
$refs += @($WebView2Core, $WebView2Wpf)
$refArgs = $refs | ForEach-Object { "/reference:$(Resolve-AssemblyRef $_)" }

# Prefer build/icon.ico, then any root ico for installer bootstrap icon.
$icon = Resolve-AppIconPath $Root
$iconArg = "/win32icon:$icon"
if (-not (Test-Path $WebGlScene)) { throw "Missing WebGL scene: $WebGlScene" }
@($WebView2Core, $WebView2Wpf, $WebView2Loader) | ForEach-Object { if (-not (Test-Path $_)) { throw "Missing WebView2 dependency: $_" } }
Assert-X64PortableExecutable $WebView2Loader

& $csc /nologo /target:winexe /platform:x64 /optimize+ /define:UNINSTALLER /out:$Uninstaller $iconArg $refArgs "/resource:$WebGlScene,LingxiPayload.webgl-scene.html" "/resource:$WebView2Core,LingxiPayload.webview2-core.dll" "/resource:$WebView2Wpf,LingxiPayload.webview2-wpf.dll" "/resource:$WebView2Loader,LingxiPayload.webview2-loader.dll" $Source
if ($LASTEXITCODE -ne 0) { throw 'Uninstaller compile failed.' }

& $csc /nologo /target:winexe /platform:x64 /optimize+ /out:$Setup $iconArg $refArgs "/resource:$PayloadZip,LingxiPayload.app.zip" "/resource:$Uninstaller,LingxiPayload.uninstaller.exe" "/resource:$WebGlScene,LingxiPayload.webgl-scene.html" "/resource:$WebView2Core,LingxiPayload.webview2-core.dll" "/resource:$WebView2Wpf,LingxiPayload.webview2-wpf.dll" "/resource:$WebView2Loader,LingxiPayload.webview2-loader.dll" $Source
if ($LASTEXITCODE -ne 0) { throw 'Installer compile failed.' }

# WebView2 assemblies must sit beside the bootstrap EXE before it can extract its embedded copies.
Copy-Item $WebView2Core $DistDir -Force
Copy-Item $WebView2Wpf $DistDir -Force
Copy-Item $WebView2Loader $DistDir -Force

Write-Host "Self installer built: $Setup"
