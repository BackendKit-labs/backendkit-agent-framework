# Build standalone binary for BackendKit Console (Windows)
Write-Host "=== BackendKit Console — Build Standalone ===" -ForegroundColor Cyan

# Ir al fork
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$scriptDir/../vscode-fork"

# Instalar dependencias
Write-Host "Installing dependencies..." -ForegroundColor Yellow
yarn install --frozen-lockfile

# Compilar
Write-Host "Compiling..." -ForegroundColor Yellow
yarn compile

# Empaquetar con electron-builder
Write-Host "Creating standalone binary..." -ForegroundColor Yellow
npx electron-builder --win --x64 --config.extraMetadata.name=backendkit-console

Write-Host "=== Build complete ===" -ForegroundColor Green
Write-Host "Output: dist/BackendKit Console Setup.exe"
