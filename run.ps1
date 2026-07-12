# ClearLoad Bootstrap & Startup Script (Windows PowerShell)

# Force PowerShell console to use UTF-8 so emojis render correctly
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Define emojis using Unicode code points to prevent encoding interpretation issues
$bubble = [char]::ConvertFromUtf32(0x1FAE7)
$cross = [char]::ConvertFromUtf32(0x274C)

Write-Host "$bubble Checking environment..." -ForegroundColor Cyan
if (!(Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "$cross Error: Node.js is not installed. Please download it from https://nodejs.org/" -ForegroundColor Red
    Exit 1
}

# Detect if we are outside the repo directory
if (!(Test-Path "package.json")) {
    Write-Host "$bubble Repository not detected locally. Cloning ClearLoad..." -ForegroundColor Cyan
    git clone https://github.com/nichu42/clearload.git
    Set-Location clearload
}

Write-Host "$bubble Installing dependencies..." -ForegroundColor Cyan
npm install

Write-Host "$bubble Starting ClearLoad on http://localhost:3000..." -ForegroundColor Green
try {
    $env:OPEN_BROWSER="true"
    node server.js
} finally {
    Remove-Item env:OPEN_BROWSER -ErrorAction SilentlyContinue
}
