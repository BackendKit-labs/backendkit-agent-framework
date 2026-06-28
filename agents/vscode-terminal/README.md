# BackendKit Director Console

Consola tipo chat para el Director-agent, construida sobre un fork minimalista de VS Code.

## Requisitos

- Node.js 20+
- Yarn
- Git

## Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd vscode-terminal

# Ir al fork de VS Code
cd vscode-fork

# Instalar dependencias
yarn install

# Compilar
yarn compile
```

## Uso

```bash
# Iniciar la consola
cd vscode-fork
yarn electron
```

## Atajos de teclado

| Atajo | Acción |
|-------|--------|
| Ctrl+Enter | Enviar mensaje |
| Ctrl+L | Limpiar conversación |
| Ctrl+1 | Abrir panel Vault |
| Ctrl+2 | Abrir panel Fleet |
| Ctrl+3 | Abrir panel Runs |
| Ctrl+4 | Abrir panel Config |
| Ctrl+Shift+P | Paleta de comandos |
| Escape | Cancelar tool call |

## Conexión con el Director

La consola se conecta al Director-agent vía MCP. Por defecto usa:

```bash
node dist/index.js
```

Puedes configurar la conexión desde el panel Config (Ctrl+4).

## Estructura del proyecto

```
vscode-terminal/
├── vscode-fork/          ← Fork de VS Code
│   └── src/vs/workbench/
│       ├── chat/         ← Vista de conversación
│       ├── vault-panel/  ← Panel Vault
│       ├── fleet-panel/  ← Panel Fleet
│       ├── runs-panel/   ← Panel Runs
│       ├── config-panel/ ← Panel Config
│       └── services/     ← Servicios compartidos
├── specification.md      ← Especificación técnica
├── design.md             ← Diseño de arquitectura
└── README.md             ← Este archivo
```

## Licencia

MIT
