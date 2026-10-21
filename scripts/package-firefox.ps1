$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'package-extension.ps1') -Target firefox
