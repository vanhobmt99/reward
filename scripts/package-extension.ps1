param(
    [ValidateSet('chrome', 'firefox')]
    [string]$Target = 'chrome'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot ('build-' + $Target + '.cjs'))
if ($LASTEXITCODE -ne 0) { throw "$Target build failed" }

$buildRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot ('dist\' + $Target))).Path
$manifest = Get-Content -Raw -LiteralPath (Join-Path $buildRoot 'manifest.json') | ConvertFrom-Json
if ($manifest.version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Invalid extension version' }
$archivePath = Join-Path $projectRoot ('dist\search-auto-' + $Target + '-' + $manifest.version + '.zip')
if ((Test-Path -LiteralPath $archivePath) -and
    ((Get-Item -LiteralPath $archivePath).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
    throw 'Refusing to overwrite a linked archive'
}
Add-Type -AssemblyName System.IO.Compression
# A fixed timestamp and ordinal entry order make repeated builds byte-identical.
$entryNames = [string[]](Get-ChildItem -LiteralPath $buildRoot -File -Recurse | ForEach-Object {
    $_.FullName.Substring($buildRoot.Length + 1).Replace('\', '/')
})
[Array]::Sort($entryNames, [StringComparer]::Ordinal)
$stream = [IO.File]::Open($archivePath, [IO.FileMode]::Create, [IO.FileAccess]::Write)
try {
    $archive = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        foreach ($name in $entryNames) {
            $entry = $archive.CreateEntry($name, [IO.Compression.CompressionLevel]::Optimal)
            $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
            $entryStream = $entry.Open()
            $inputStream = [IO.File]::OpenRead((Join-Path $buildRoot $name))
            try { $inputStream.CopyTo($entryStream) }
            finally {
                $inputStream.Dispose()
                $entryStream.Dispose()
            }
        }
    } finally { $archive.Dispose() }
} finally { $stream.Dispose() }
Write-Output $archivePath
