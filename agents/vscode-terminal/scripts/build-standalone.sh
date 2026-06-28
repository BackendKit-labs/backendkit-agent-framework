#!/bin/bash
# Build standalone binary for BackendKit Console (Linux/Mac)
set -e

echo "=== BackendKit Console — Build Standalone ==="

# Ir al fork
cd "$(dirname "$0")/../vscode-fork"

# Instalar dependencias
echo "Installing dependencies..."
yarn install --frozen-lockfile

# Compilar
echo "Compiling..."
yarn compile

# Empaquetar con electron-builder
echo "Creating standalone binary..."
npx electron-builder --linux --x64 --config.extraMetadata.name=backendkit-console

echo "=== Build complete ==="
echo "Output: dist/backendkit-console-*.AppImage"
