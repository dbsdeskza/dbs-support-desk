# Create a portable zip package
$version = (Get-Content package.json | ConvertFrom-Json).version
$sourceDir = ".\dist\win-unpacked"
$outputFile = ".\dist\DBS_Support_Desk_Portable_v$version.zip"

# Remove existing zip if it exists
if (Test-Path $outputFile) {
    Remove-Item $outputFile -Force
}

# Create zip file
Compress-Archive -Path "$sourceDir\*" -DestinationPath $outputFile -Force

Write-Host "Portable version created at: $outputFile"
