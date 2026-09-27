$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$clusterPath = Join-Path $projectRoot 'data\postgres'
$envPath = Join-Path $projectRoot '.env'
if (-not (Test-Path -LiteralPath "$pgBin\initdb.exe")) { throw 'Install PostgreSQL 18 or update pgBin in this script.' }
if (-not (Test-Path -LiteralPath $envPath)) { throw 'Run npm run env:init first.' }
if (-not (Test-Path -LiteralPath (Join-Path $clusterPath 'PG_VERSION'))) {
  $envText = [IO.File]::ReadAllText($envPath)
  if ($envText -notmatch 'DATABASE_URL="postgresql://hrms:CHANGE_ME@localhost:5432/hrms\?schema=public"') { throw 'DATABASE_URL was configured manually. Use that database, or restore the example DATABASE_URL before creating the isolated database.' }
  $random = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($random)
  $rng.Dispose()
  $databasePassword = [Convert]::ToBase64String($random).Replace('+','a').Replace('/','b').Replace('=','')
  New-Item -ItemType Directory -Force -Path (Join-Path $projectRoot 'data') | Out-Null
  $passwordFile = Join-Path $projectRoot 'data\init-password.tmp'
  try {
    [IO.File]::WriteAllText($passwordFile, $databasePassword)
    & "$pgBin\initdb.exe" -D $clusterPath -U hrms -A scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --locale=C
    if ($LASTEXITCODE -ne 0) { throw 'Database initialization failed.' }
    $envText = $envText.Replace('postgresql://hrms:CHANGE_ME@localhost:5432/hrms?schema=public', "postgresql://hrms:${databasePassword}@localhost:55432/hrms?schema=public")
    # Runtime role URLs from env:init point at the same isolated cluster.
    $envText = $envText.Replace('@localhost:5432/hrms?schema=public', '@localhost:55432/hrms?schema=public')
    [IO.File]::WriteAllText($envPath, $envText)
  } finally { if (Test-Path -LiteralPath $passwordFile) { Remove-Item -LiteralPath $passwordFile } }
}
& "$pgBin\pg_ctl.exe" -D $clusterPath status *> $null
if ($LASTEXITCODE -ne 0) {
  & "$pgBin\pg_ctl.exe" -D $clusterPath -l (Join-Path $projectRoot 'data\postgres.log') -o '-p 55432 -h 127.0.0.1' -w start
  if ($LASTEXITCODE -ne 0) { throw 'Database startup failed. Check data/postgres.log.' }
}
$currentEnv = [IO.File]::ReadAllText($envPath)
$connection = [regex]::Match($currentEnv, '(?m)^DATABASE_URL="([^"]+)"').Groups[1].Value
$dbUri = [Uri]$connection
$env:PGPASSWORD = [Uri]::UnescapeDataString($dbUri.UserInfo.Split(':',2)[1])
try {
  $databaseExists = & "$pgBin\psql.exe" -U hrms -h 127.0.0.1 -p 55432 -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='hrms'"
  if ($databaseExists -ne '1') { & "$pgBin\createdb.exe" -U hrms -h 127.0.0.1 -p 55432 hrms; if ($LASTEXITCODE -ne 0) { throw 'Could not create hrms database.' } }
} finally { Remove-Item Env:PGPASSWORD }
Write-Host 'Project PostgreSQL is ready on localhost:55432. Credentials are stored in .env. After migrating, run npm run db:roles.'
