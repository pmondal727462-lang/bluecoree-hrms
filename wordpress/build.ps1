$ErrorActionPreference = 'Stop'
$pluginRoot = Join-Path $PSScriptRoot 'bluecoree-hr'
$outputRoot = Join-Path $PSScriptRoot 'dist'
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
$archive = Join-Path $outputRoot 'bluecoree-hr.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveStream = [System.IO.File]::Open($archive, [System.IO.FileMode]::Create)
try {
    $zip = [System.IO.Compression.ZipArchive]::new($archiveStream, [System.IO.Compression.ZipArchiveMode]::Create, $true)
    try {
        Get-ChildItem -LiteralPath $pluginRoot -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($pluginRoot.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $_.FullName, ('bluecoree-hr/' + $relative), [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    } finally { $zip.Dispose() }
} finally { $archiveStream.Dispose() }
Write-Output "Installable WordPress plugin: $archive"
