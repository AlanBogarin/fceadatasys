[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$ConfigFile,
  [ValidateSet('demo','production')][string]$Profile = 'production',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$Time = '02:00',
  [Parameter(Mandatory=$true)][string]$NodeCommand,
  [Parameter(Mandatory=$true)][string]$TaskName,
  [switch]$Disable
)
$ErrorActionPreference = 'Stop'
$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($Disable) {
  if ($existing) { Disable-ScheduledTask -TaskName $TaskName | Out-Null }
  Write-Output "Tarea $TaskName deshabilitada si existía."
  return
}
$taskRoot = (Resolve-Path -LiteralPath $Root).Path
$taskConfig = (Resolve-Path -LiteralPath $ConfigFile).Path
$backupScript = Join-Path $taskRoot 'scripts\backup.mjs'
foreach ($taskPath in @($taskRoot, $taskConfig, $backupScript, $NodeCommand)) {
  if ($taskPath -match '["\r\n]') { throw 'Ruta inválida para la tarea.' }
}
$arguments = '"' + $backupScript + '" --profile ' + $Profile + ' --config "' + $taskConfig + '"'
$action = New-ScheduledTaskAction -Execute $NodeCommand -Argument $arguments -WorkingDirectory $taskRoot
$trigger = New-ScheduledTaskTrigger -Daily -At ([datetime]::Today.Add([timespan]::Parse($Time)))
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if ($existing) {
  Set-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings | Out-Null
  Enable-ScheduledTask -TaskName $TaskName | Out-Null
} else {
  # Password logon permits network access when the operator is signed out.
  $credential = Get-Credential -UserName ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) -Message 'Cuenta del servicio de copias (acceso a configuración, PostgreSQL y Google Drive)'
  if (-not $credential) { throw 'Se requiere una cuenta para la ejecución sin sesión interactiva.' }
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -User $credential.UserName -Password $credential.GetNetworkCredential().Password -Description 'Copia diaria FCEA Datasys: servidor y Google Drive' | Out-Null
}
Write-Output "Tarea $TaskName configurada diariamente a las $Time (hora local del servidor)."
