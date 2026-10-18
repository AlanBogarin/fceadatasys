param([string]$Owner = 'fcea_test', [string]$Runtime = 'fcea_test_app')
$ErrorActionPreference = 'Stop'
if ($Owner -notmatch '^[a-zA-Z0-9_]+$' -or $Runtime -notmatch '^[a-zA-Z0-9_]+$') { throw 'Roles de prueba inválidos.' }
$taskServer = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../server'))
$taskDatabase = 'fceadatasys_client_connection_test'
function Assert-Exit([string]$Action) { if ($LASTEXITCODE -ne 0) { throw "$Action falló." } }
function Sql([string]$Database, [string]$Statement) {
  $result = & psql -h 127.0.0.1 -p 55439 -U $Owner -d $Database -v ON_ERROR_STOP=1 -Atc $Statement
  Assert-Exit 'PostgreSQL de integración'
  return $result
}
# Solo esta base y el puerto del clúster aislado. Nunca lee server/.env.
if ((Sql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$taskDatabase'") -ne '1') {
  Sql 'postgres' "CREATE DATABASE $taskDatabase" | Out-Null
}
$taskKeys = @('DATABASE_URL', 'BOOTSTRAP_ADMIN_NAME', 'BOOTSTRAP_ADMIN_CI', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_USERNAME', 'BOOTSTRAP_ADMIN_PASSWORD')
$taskPrevious = @{}
foreach ($key in $taskKeys) { $taskPrevious[$key] = [Environment]::GetEnvironmentVariable($key, 'Process') }
Push-Location -LiteralPath $taskServer
try {
  $env:DATABASE_URL = "postgresql://${Owner}@127.0.0.1:55439/$taskDatabase"
  & node node_modules/prisma/build/index.js migrate deploy
  Assert-Exit 'Migraciones'
  & psql -h 127.0.0.1 -p 55439 -U $Owner -d $taskDatabase -v "app_role=$Runtime" -f scripts/runtime-grants.sql
  Assert-Exit 'Grants runtime'
  if ((Sql $taskDatabase 'SELECT count(*) FROM usuarios') -eq '0') {
    $env:DATABASE_URL = "postgresql://${Runtime}@127.0.0.1:55439/$taskDatabase"
    $env:BOOTSTRAP_ADMIN_NAME = 'Administrador integración cliente'
    $env:BOOTSTRAP_ADMIN_CI = '80000001'
    $env:BOOTSTRAP_ADMIN_EMAIL = 'admin-client@example.test'
    $env:BOOTSTRAP_ADMIN_USERNAME = 'integration-admin'
    $env:BOOTSTRAP_ADMIN_PASSWORD = 'ConexionCliente2026!'
    & node --import tsx scripts/bootstrap-admin.ts
    Assert-Exit 'Bootstrap auditado'
  } elseif ((Sql $taskDatabase "SELECT count(*) FROM usuarios WHERE usuario='integration-admin' AND rol='ADMINISTRADOR' AND activo=true") -ne '1') {
    throw 'La base no contiene el administrador esperado. No se reemplazan cuentas ni credenciales existentes.'
  }
  $taskApplied = @(Sql $taskDatabase 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name')
  if ($taskApplied.Count -ne 7 -or $taskApplied[-1] -ne '20261017010000_summary_limits') { throw 'No se verificaron las siete migraciones esperadas.' }
  Write-Host 'Base exclusiva del cliente preparada: siete migraciones, grants y bootstrap. Los datos de prueba se conservan.'
} finally {
  Pop-Location
  foreach ($key in $taskKeys) { [Environment]::SetEnvironmentVariable($key, $taskPrevious[$key], 'Process') }
}
