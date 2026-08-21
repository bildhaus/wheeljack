param(
    [string]$OutputDirectory = 'artifacts\desktop\windows',
    [string]$CertificateThumbprint = $env:WHEELJACK_WINDOWS_CERTIFICATE_THUMBPRINT,
    [string]$TimestampUrl = 'http://timestamp.digicert.com',
    [switch]$RequireSigned,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$output = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
$desktopRoot = [IO.Path]::GetFullPath((Join-Path $root 'artifacts\desktop'))
if (-not $output.StartsWith($desktopRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Desktop output must stay under $desktopRoot."
}
if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output -Force | Out-Null
if ($RequireSigned -and [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    throw 'A Windows code-signing certificate thumbprint is required.'
}
& (Get-Command bun).Source (Join-Path $root 'scripts\verify-desktop-version.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Desktop version alignment failed.' }
$targetDirectory = [IO.Path]::GetFullPath((Join-Path $root 'target'))
$releaseDirectory = [IO.Path]::GetFullPath((Join-Path $targetDirectory 'release'))
if (-not $releaseDirectory.StartsWith($targetDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing unsafe Tauri release cleanup path: $releaseDirectory"
}
foreach ($installerDirectory in 'bundle', 'wix') {
    Remove-Item -LiteralPath (Join-Path $releaseDirectory $installerDirectory) -Recurse -Force -ErrorAction SilentlyContinue
}
foreach ($unusedLibrary in 'wheeljack_ffi.dll', 'wheeljack_desktop_lib.dll') {
    Remove-Item -LiteralPath (Join-Path $releaseDirectory $unusedLibrary) -Force -ErrorAction SilentlyContinue
}
Push-Location (Join-Path $root 'apps\desktop')
try {
    if (-not $SkipInstall) {
        & (Get-Command bun).Source install --frozen-lockfile
        if ($LASTEXITCODE -ne 0) { throw 'bun install failed.' }
    }
    $tauriArguments = @('tauri', 'build', '--no-bundle')
    $tauriArguments += @('--', '--locked')
    & (Get-Command bun).Source @tauriArguments
    if ($LASTEXITCODE -ne 0) { throw 'Tauri build failed.' }
} finally {
    Pop-Location
}
$portableSource = Join-Path $root 'target\release\wheeljack-desktop.exe'
if (-not (Test-Path -LiteralPath $portableSource -PathType Leaf)) {
    throw "Tauri portable executable was not found: $portableSource"
}
$portable = Join-Path $output 'wheeljack-windows-x64-portable.exe'
Copy-Item -LiteralPath $portableSource -Destination $portable -Force
if (-not [string]::IsNullOrWhiteSpace($CertificateThumbprint)) {
    $normalizedThumbprint = $CertificateThumbprint.Replace(' ', '')
    $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$normalizedThumbprint"
    $signature = Set-AuthenticodeSignature -LiteralPath $portable -Certificate $certificate -HashAlgorithm SHA256 -TimestampServer $TimestampUrl
    if ($signature.Status -ne 'Valid') {
        throw "Windows signing verification failed for $($portable | Split-Path -Leaf): $($signature.StatusMessage)"
    }
}
Get-ChildItem -LiteralPath $output -File |
    Where-Object Extension -eq '.exe' |
    ForEach-Object {
        $fileHash = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        Set-Content -LiteralPath "$($_.FullName).sha256" -Value "$fileHash  $($_.Name)" -Encoding ascii
}
Write-Output $portable
