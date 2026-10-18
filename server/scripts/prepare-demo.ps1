param([string]$Owner = 'fcea_test', [string]$Runtime = 'fcea_demo_app')
$ErrorActionPreference = 'Stop'
if ($Owner -notmatch '^[a-zA-Z0-9_]+$' -or $Runtime -notmatch '^[a-zA-Z0-9_]+$' -or $Owner -eq $Runtime) { throw 'Roles locales inválidos.' }
$taskServer = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskCluster = [IO.Path]::GetFullPath((Join-Path $taskServer '.tmp/postgres-data'))
$taskPsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$taskDatabase = 'fceadatasys_demo'
function Assert-Exit([string]$Action) { if ($LASTEXITCODE -ne 0) { throw "$Action falló." } }
function Sql([string]$Database, [string]$Statement) {
  $result = & $taskPsql -h 127.0.0.1 -p 55439 -U $Owner -d $Database -v ON_ERROR_STOP=1 -Atc $Statement
  Assert-Exit 'PostgreSQL de demostración'
  return $result
}
# Únicamente el clúster local ya preparado. No lee .env ni modifica pg_hba.conf.
$taskActual = Sql 'postgres' 'SHOW data_directory'
if ([IO.Path]::GetFullPath($taskActual) -ne $taskCluster) { throw 'El servidor no es el clúster local aislado esperado.' }
if ((Sql 'postgres' "SELECT 1 FROM pg_roles WHERE rolname='$Runtime'") -ne '1') {
  Sql 'postgres' "CREATE ROLE $Runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT" | Out-Null
}
if ((Sql 'postgres' "SELECT count(*) FROM pg_roles WHERE rolname='$Runtime' AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole") -ne '1') { throw 'El rol demo debe ser un runtime limitado.' }
if ((Sql 'postgres' "SELECT 1 FROM pg_database WHERE datname='$taskDatabase'") -ne '1') {
  Sql 'postgres' "CREATE DATABASE $taskDatabase OWNER $Owner" | Out-Null
}
$taskPrevious = $env:DATABASE_URL
Push-Location -LiteralPath $taskServer
try {
  $env:DATABASE_URL = "postgresql://${Owner}@127.0.0.1:55439/$taskDatabase"
  & node node_modules/prisma/build/index.js migrate deploy
  Assert-Exit 'Migraciones demo'
  & $taskPsql -h 127.0.0.1 -p 55439 -U $Owner -d $taskDatabase -v "app_role=$Runtime" -f scripts/runtime-grants.sql
  Assert-Exit 'Grants demo'
  $taskEnv = Join-Path $taskServer '.env.demo'
  if (-not (Test-Path -LiteralPath $taskEnv)) {
    $taskBytes = [byte[]]::new(48)
    $taskGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $taskGenerator.GetBytes($taskBytes) } finally { $taskGenerator.Dispose() }
    $taskSecret = [Convert]::ToBase64String($taskBytes)
    $taskContent = [IO.File]::ReadAllText((Join-Path $taskServer '.env.demo.example'))
    $taskContent = $taskContent.Replace('postgresql://fcea_demo_app:CHANGE_ME@127.0.0.1:5432/fceadatasys_demo', "postgresql://${Runtime}@127.0.0.1:55439/$taskDatabase").Replace('replace-with-a-random-secret-at-least-32-characters', $taskSecret)
    [IO.File]::WriteAllText($taskEnv, $taskContent)
  }
  $taskClient = [IO.Path]::GetFullPath((Join-Path $taskServer '../client'))
  $taskClientEnv = Join-Path $taskClient '.env.demo'
  if (-not (Test-Path -LiteralPath $taskClientEnv)) {
    [IO.File]::Copy((Join-Path $taskClient '.env.api.example'), $taskClientEnv)
  }
  Write-Host 'Base demo preparada con migraciones/grants y configuración local separada. Ejecutar npm run db:init:demo para cargar el conjunto.'
} finally {
  Pop-Location
  $env:DATABASE_URL = $taskPrevious
}
