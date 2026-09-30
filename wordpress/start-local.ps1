$ErrorActionPreference = 'Stop'
$localEnv = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path -LiteralPath $localEnv)) {
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $passwordBytes = New-Object byte[] 32
    $rootPasswordBytes = New-Object byte[] 32
    $rng.GetBytes($passwordBytes)
    $rng.GetBytes($rootPasswordBytes)
    $dbPassword = [Convert]::ToBase64String($passwordBytes)
    $dbRootPassword = [Convert]::ToBase64String($rootPasswordBytes)
    Set-Content -LiteralPath $localEnv -Value "WP_TEST_PASSWORD=$dbPassword`nWP_TEST_ROOT_PASSWORD=$dbRootPassword" -Encoding ascii
    $rng.Dispose()
}
docker compose --project-directory $PSScriptRoot -f (Join-Path $PSScriptRoot 'compose.yaml') up -d
if ($LASTEXITCODE -ne 0) { throw 'Could not start isolated WordPress test environment.' }
