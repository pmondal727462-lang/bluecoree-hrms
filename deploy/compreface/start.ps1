$ErrorActionPreference = 'Stop'
$dockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$dockerPath = if ($dockerCommand) { $dockerCommand.Source } else { Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\resources\bin\docker.exe' }
if (-not (Test-Path -LiteralPath $dockerPath)) {
    $dockerPath = 'C:\Program Files\Docker\Docker\resources\bin\docker.exe'
}
if (-not (Test-Path -LiteralPath $dockerPath)) {
    throw 'Install and start Docker Desktop with Linux containers, then run this script again.'
}
$engineType = & $dockerPath info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker is not running. Start Docker Desktop first.' }
if ($engineType -ne 'linux') { throw 'Switch Docker Desktop to Linux containers first.' }
$faceEnv = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $faceEnv)) {
    $bytes = New-Object byte[] 32
    $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $random.GetBytes($bytes) } finally { $random.Dispose() }
    $password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
    [IO.File]::WriteAllText($faceEnv, "COMPREFACE_DB_PASSWORD=$password`n")
}
& $dockerPath compose --env-file $faceEnv -f (Join-Path $PSScriptRoot 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { throw 'CompreFace containers could not start.' }
Write-Host 'Containers started. Models may take several minutes to load. Open http://localhost:8000 once ready.'
Write-Host 'Create Face Detection and Face Verification services; keep both API keys private.'
