# 把免安装目录打成便于分发的 zip（自用路线：解压即用，避免安装包 SmartScreen）
$scriptDir = $PSScriptRoot
if (-not $scriptDir) { $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path }
$root = Split-Path -Parent $scriptDir
$release = Join-Path $root 'release'
$unpacked = Join-Path $release 'win-unpacked'
if (-not (Test-Path $unpacked)) {
  Write-Error "未找到 $unpacked，请先运行 npm run dist"
  exit 1
}

$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$builderYml = Get-Content (Join-Path $root 'electron-builder.yml') -Raw
$product = [regex]::Match($builderYml, '(?m)^productName:\s*(.+)$').Groups[1].Value.Trim()
if (-not $product) { $product = 'TickNote' }
$zip = Join-Path $release "$product-$version-portable.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }

Compress-Archive -Path (Join-Path $unpacked '*') -DestinationPath $zip -CompressionLevel Optimal
$size = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Output "portable zip: $zip ($size MB)"
