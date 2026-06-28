#!/bin/bash
# Build VSIX package for BackendKit Console
set -e

echo "=== BackendKit Console — Build VSIX ==="

# Ir al fork
cd "$(dirname "$0")/../vscode-fork"

# Instalar dependencias
echo "Installing dependencies..."
yarn install --frozen-lockfile

# Compilar
echo "Compiling..."
yarn compile

# Crear VSIX
echo "Creating VSIX package..."
npx vsce package --out "../dist/backendkit-console.vsix"

echo "=== Build complete ==="
echo "Output: dist/backendkit-console.vsix"
