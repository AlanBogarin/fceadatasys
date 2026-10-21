[CmdletBinding()]
param([string]$ClamAVDirectory = 'C:\Program Files\ClamAV')
$ErrorActionPreference = 'Stop'
$serverPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $serverPath '.local/clamav'
$databasePath = Join-Path $dataPath 'database'
New-Item -ItemType Directory -Path $databasePath -Force | Out-Null
$configPath = Join-Path $dataPath 'freshclam.conf'
$configLines = @(
  ('DatabaseDirectory "' + $databasePath + '"'),
  'DatabaseMirror database.clamav.net',
  ('UpdateLogFile "' + (Join-Path $dataPath 'freshclam.log') + '"'),
  'LogTime yes',
  'ConnectTimeout 15',
  'ReceiveTimeout 120'
)
# Windows PowerShell 5.1 adds a BOM with Set-Content -Encoding utf8; FreshClam rejects it.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($configPath, $configLines, $utf8NoBom)
& (Join-Path $ClamAVDirectory 'freshclam.exe') --quiet ('--config-file=' + $configPath)
exit $LASTEXITCODE
