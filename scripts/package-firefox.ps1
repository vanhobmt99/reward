$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
& node (Join-Path $PSScriptRoot 'build-firefox.cjs')
if ($LASTEXITCODE -ne 0) { throw 'Firefox build failed' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'dist\firefox\manifest.json') | ConvertFrom-Json
$archivePath = Join-Path $projectRoot ('dist\search-auto-firefox-' + $manifest.version + '.zip')
Compress-Archive -Path (Join-Path $projectRoot 'dist\firefox\*') -DestinationPath $archivePath -Force
Write-Output $archivePath
