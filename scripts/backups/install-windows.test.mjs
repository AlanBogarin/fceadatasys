import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
// Exercise the actual installer with substituted Windows cmdlets. No real task
// is created, changed or run, and Get-Credential never opens a prompt.
const harness = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$global:scenario = $env:FCEA_SCHEDULE_TEST_CASE | ConvertFrom-Json
$global:record = @{ updates = 0; prompts = 0; enabled = 0; registered = 0; disabled = 0; users = @(); passwordsValid = @(); promptedUser = $null; error = $null }
function Get-ScheduledTask {
  [CmdletBinding()] param($TaskName)
  if ($global:scenario.existing) {
    [pscustomobject]@{ Principal = [pscustomobject]@{ UserId = 'TEST\backup'; LogonType = 'Password' } }
  }
}
function New-ScheduledTaskAction { param($Execute, $Argument, $WorkingDirectory) 'action' }
function New-ScheduledTaskTrigger { param([switch]$Daily, $At) 'trigger' }
function New-ScheduledTaskSettingsSet {
  param([switch]$StartWhenAvailable, $MultipleInstances, $ExecutionTimeLimit, [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
  'settings'
}
function Set-ScheduledTask {
  [CmdletBinding()] param($TaskName, $Action, $Trigger, $Settings, $User, $Password)
  $global:record.updates++
  $global:record.users += $User
  $global:record.passwordsValid += ($Password -ceq 'test-only-password')
  if (($global:record.updates -eq 1 -and $global:scenario.failure -ne 'none') -or $global:scenario.failure -eq 'authTwice') {
    $id = if ($global:scenario.failure -eq 'permission') { 'HRESULT 0x80070005' } else { 'HRESULT 0x8007052e' }
    $exception = [System.Exception]::new('Simulated Windows failure')
    $errorRecord = [System.Management.Automation.ErrorRecord]::new($exception, $id, [System.Management.Automation.ErrorCategory]::AuthenticationError, $null)
    $PSCmdlet.ThrowTerminatingError($errorRecord)
  }
}
function Get-Credential {
  param($UserName, $Message)
  $global:record.prompts++
  $global:record.promptedUser = $UserName
  if (-not $global:scenario.cancel) {
    $secure = [System.Security.SecureString]::new()
    foreach ($character in 'test-only-password'.ToCharArray()) { $secure.AppendChar($character) }
    [System.Management.Automation.PSCredential]::new('TEST\backup', $secure)
  }
}
function Register-ScheduledTask {
  param($TaskName, $Action, $Trigger, $Settings, $User, $Password, $Description)
  $global:record.registered++
  $global:record.users += $User
  $global:record.passwordsValid += ($Password -ceq 'test-only-password')
}
function Enable-ScheduledTask { param($TaskName) $global:record.enabled++ }
function Disable-ScheduledTask { param($TaskName) $global:record.disabled++ }
$parameters = @{
  Root = $env:FCEA_SCHEDULE_TEST_ROOT
  ConfigFile = (Join-Path $env:FCEA_SCHEDULE_TEST_ROOT 'package.json')
  Profile = 'demo'
  Time = '02:00'
  NodeCommand = $env:FCEA_SCHEDULE_TEST_NODE
  TaskName = 'test-backup-task'
  NonInteractive = [bool]$global:scenario.nonInteractive
  Disable = [bool]$global:scenario.disable
}
try {
  & (Join-Path $env:FCEA_SCHEDULE_TEST_ROOT 'scripts/backups/install-windows.ps1') @parameters | Out-Null
} catch {
  $global:record.error = $_.Exception.Message + ' ' + $_.FullyQualifiedErrorId
}
$global:record | ConvertTo-Json -Compress -Depth 4
`;

function install(options = {}) {
  const result = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(harness, "utf16le").toString("base64"),
    ],
    {
      env: {
        ...process.env,
        FCEA_SCHEDULE_TEST_ROOT: root,
        FCEA_SCHEDULE_TEST_NODE: process.execPath,
        FCEA_SCHEDULE_TEST_CASE: JSON.stringify({
          existing: true,
          failure: "none",
          ...options,
        }),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 15000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

const windows = { skip: process.platform !== "win32" };
test("Windows: actualización válida conserva la cuenta sin pedir contraseña", windows, () => {
  const result = install();
  assert.equal(result.error, null);
  assert.equal(result.updates, 1);
  assert.equal(result.prompts, 0);
  assert.equal(result.enabled, 1);
  assert.equal(result.registered, 0);
});

test("Windows: 0x8007052e pide la cuenta registrada y reintenta con contraseña", windows, () => {
  const result = install({ failure: "auth" });
  assert.equal(result.error, null);
  assert.equal(result.updates, 2);
  assert.equal(result.prompts, 1);
  assert.equal(result.promptedUser, "TEST\\backup");
  assert.deepEqual(result.users, [null, "TEST\\backup"]);
  assert.deepEqual(result.passwordsValid, [false, true]);
  assert.equal(result.enabled, 1);
  assert.equal(result.registered, 0);
});

test("Windows: sin interacción informa cómo renovar credenciales sin abrir un diálogo", windows, () => {
  const result = install({ failure: "auth", nonInteractive: true });
  assert.match(result.error, /backup:schedule.*terminal interactiva/);
  assert.equal(result.updates, 1);
  assert.equal(result.prompts, 0);
  assert.equal(result.enabled, 0);
});

test("Windows: error de permisos se propaga sin solicitar contraseña", windows, () => {
  const result = install({ failure: "permission" });
  assert.match(result.error, /0x80070005/);
  assert.equal(result.updates, 1);
  assert.equal(result.prompts, 0);
  assert.equal(result.enabled, 0);
});

test("Windows: credenciales rechazadas en el reintento no provocan un bucle", windows, () => {
  const result = install({ failure: "authTwice" });
  assert.match(result.error, /0x8007052e/);
  assert.equal(result.updates, 2);
  assert.equal(result.prompts, 1);
  assert.equal(result.enabled, 0);
});

test("Windows: cancelar credenciales no actualiza ni habilita la tarea", windows, () => {
  const result = install({ failure: "auth", cancel: true });
  assert.match(result.error, /Se requiere una cuenta/);
  assert.equal(result.updates, 1);
  assert.equal(result.prompts, 1);
  assert.equal(result.enabled, 0);
});

test("Windows: crear una tarea sigue solicitando credenciales", windows, () => {
  const result = install({ existing: false });
  assert.equal(result.error, null);
  assert.equal(result.updates, 0);
  assert.equal(result.prompts, 1);
  assert.equal(result.registered, 1);
  assert.deepEqual(result.passwordsValid, [true]);
});

test("Windows: crear sin interacción falla antes de pedir credenciales", windows, () => {
  const result = install({ existing: false, nonInteractive: true });
  assert.match(result.error, /backup:schedule.*terminal interactiva/);
  assert.equal(result.prompts, 0);
  assert.equal(result.registered, 0);
});

test("Windows: deshabilitar no pide credenciales ni actualiza la definición", windows, () => {
  const result = install({ disable: true, nonInteractive: true });
  assert.equal(result.error, null);
  assert.equal(result.disabled, 1);
  assert.equal(result.updates, 0);
  assert.equal(result.prompts, 0);
  assert.equal(result.registered, 0);
});
