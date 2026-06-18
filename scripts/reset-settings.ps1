# Reset OYEN's app settings — deletes the entire userData folder (settings/cache/localStorage).
# Quit the app first. After deletion, the next launch starts fresh with defaults.

$ErrorActionPreference = 'Stop'

$target = Join-Path $env:APPDATA 'oyen'

if (!(Test-Path $target)) {
  Write-Output "Already empty: $target"
  return
}

# If the app is running, the files are locked and deletion fails — warn first
$running = Get-Process -Name 'oyen', 'electron' -ErrorAction SilentlyContinue
if ($running) {
  Write-Warning 'An OYEN (or electron) process is running. Quit the app and run this again.'
  return
}

Write-Output "Target: $target"
$answer = Read-Host 'Really reset all settings? (y/N)'
if ($answer -ne 'y' -and $answer -ne 'Y') {
  Write-Output 'Cancelled.'
  return
}

Remove-Item -Recurse -Force -LiteralPath $target
Write-Output 'Reset complete. The next launch will start with defaults.'
