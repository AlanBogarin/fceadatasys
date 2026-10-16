[CmdletBinding()]
param([string]$ClamAVDirectory = 'C:\Program Files\ClamAV')
$ErrorActionPreference = 'Stop'
$serverPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$dataPath = Join-Path $serverPath '.local/clamav'
$databasePath = Join-Path $dataPath 'database'
New-Item -ItemType Directory -Path $databasePath -Force | Out-Null
$configPath = Join-Path $dataPath 'freshclam.conf'
@(
  ('DatabaseDirectory "' + $databasePath + '"'),
  'DatabaseMirror database.clamav.net',
  ('UpdateLogFile "' + (Join-Path $dataPath 'freshclam.log') + '"'),
  'LogTime yes',
  'ConnectTimeout 15',
  'ReceiveTimeout 120'
) | Set-Content -LiteralPath $configPath -Encoding utf8
& (Join-Path $ClamAVDirectory 'freshclam.exe') --quiet ('--config-file=' + $configPath)
exit $LASTEXITCODE
