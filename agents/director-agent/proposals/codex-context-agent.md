
---
# Mejoras codex-context-agent

## 🔴 1. Sin notificación cuando termina
Hoy `curate_path` devuelve un `status: "processing"` y el resto corre en background. No hay forma de que el Director (yo) se entere **automáticamente** de que terminó.
> **Ideal:** un callback, un evento WebSocket, o que la herramienta fuera **bloqueante** con timeout (como hace `reindex_vault`).

## 🔴 2. Sin duración ni timestamps
El proceso arranca y termina sin dejar registro de cuándo empezó ni cuánto duró. Solo sé que `curating: false` y el `noteCount` aumentó.
> **Ideal:** que `vault_status` devuelva campos como `lastCuratedAt`, `lastDurationMs`, o que se guarde un manifiesto de la ejecución.

## 🟡 3. Sin progreso en tiempo real
Cuando curás un directorio grande, no sabés cuántos archivos lleva procesados de cuántos totales.
> **Ideal:** `vault_status` con `curatedProgress: { processed: 45, total: 84, skipped: 39 }` mientras `curating: true`.

## 🟡 4. Sin desglose por resultado
No hay forma de saber después cuántos archivos fueron:
- ✅ Nuevos (nunca vistos)
- 🔄 Actualizados (hash cambiado)
- ⏭️ Saltados (sin cambios)
- ❌ Fallidos (error al procesar)

> **Ideal:** un log persistente o un campo en `vault_status` con el resumen de la última ejecución.


### En resumen, lo que más aportaría de forma inmediata:

| Mejora | Esfuerzo | Impacto |
|---|---|---|
| **Timestamps + duración** en `vault_status` | Bajo | 🔥 Alto |
| **Progreso en tiempo real** (`X/Y procesados`) | Medio | 🔥 Alto |
| **Desglose por resultado** (nuevos/actualizados/saltados/fallidos) | Medio | Medio |
| **Notificación de finalización** | Alto (cambia la arquitectura) | Medio |

**Mi recomendación:** arrancar por lo más simple y de alto impacto: que `vault_status` reporte `lastCuratedAt` y `lastDurationMs`, y que durante el curado muestre progreso. Sin cambiar la arquitectura asincrónica, solo agregando estado visible.

**especificación técnica precisa** para que la implementes cuando quieras.

---

## Especificación: Seguimiento de procesos de curado

### Archivos a modificar (en el servidor Codex MCP)

---

### 1. `vault_status` — agregar campos de metadatos de última ejecución

**Dónde:** donde se construye la respuesta de `vault_status` (ej. `VaultStatusResponse`)

Agregar estos campos:

```typescript
// Nuevos campos en el response
lastCuratedAt: string | null       // ISO timestamp de cuando terminó la última curación
lastDurationMs: number | null      // duración en ms de la última curación
lastCuratedSummary: {              // resumen de la última ejecución
  total: number
  new: number
  updated: number
  skipped: number
  failed: number
} | null
```

**Persistencia:** guardar en un archivo JSON dentro del vault, ej: `.codex-last-run.json`

```json
{
  "startedAt": "2026-06-17T15:30:00.000Z",
  "finishedAt": "2026-06-17T15:30:45.200Z",
  "durationMs": 45200,
  "summary": {
    "new": 25,
    "updated": 3,
    "skipped": 56,
    "failed": 0,
    "total": 84
  }
}
```

---

### 2. `curate_path` — tracking de progreso en memoria

**Dónde:** función `curateDirectory` o equivalente que procesa archivos en background.

Agregar un **estado global mutable** (o singleton en memoria):

```typescript
// En memoria, no persistente
const curationProgress = new Map<string, CurationProgress>();

interface CurationProgress {
  startedAt: string
  status: 'running' | 'completed' | 'failed'
  totalFiles: number
  processedFiles: number
  skippedFiles: number
  newFiles: number
  updatedFiles: number
  failedFiles: number
}
```

**En `vault_status`**, cuando `curating: true`, incluir:

```typescript
curationProgress: {
  processed: number      // processedFiles
  total: number          // totalFiles
  skipped: number        // skippedFiles
  percent: number        // Math.round((processed / total) * 100)
} | null
```

**Al finalizar**, escribir el archivo `.codex-last-run.json` y limpiar el progreso en memoria.

---

### 3. Flujo completo de cambios

| Paso | Archivo | Cambio |
|---|---|---|
| 1 | Definición de tipos/response | Agregar `lastCuratedAt`, `lastDurationMs`, `lastCuratedSummary`, `curationProgress` |
| 2 | Estado global / singleton | Agregar `Map<string, CurationProgress>` |
| 3 | `curateDirectory()` | Al iniciar: registrar `startedAt`. Por cada archivo: incrementar `processedFiles`, clasificar como new/updated/skipped/failed. Al terminar: guardar `.codex-last-run.json` |
| 4 | `vault_status` handler | Leer `.codex-last-run.json` + estado en memoria → devolver campos nuevos |
| 5 | Llamar `vault_status` desde el Director después de curar | Ya se hace, el usuario recibe la info actualizada |

---

### Ejemplo de salida esperada

```
📊 Última curación:
   • Inició:    2026-06-17 12:30:00
   • Finalizó:  2026-06-17 12:30:45
   • Duración:  45.2 segundos
   • Archivos:  25 nuevos, 3 actualizados, 56 saltados, 0 fallos



# 📁 Feature: Multi-Vault / Multi-Project

## 1. Concepto

Cada **proyecto** tiene su propio vault. El vault contiene:
- Notas curadas (`.md`)
- Índice RAG (`rag/{project}.json`)
- Manifiestos SHA256 (`.codex-manifest.json`)
- Metadatos de ejecuciones (`.codex-last-run.json`)

Estructura de archivos:

```bash
~/.backendkit/
├── vaults/
│   ├── agent-framework/        ← vault del proyecto A
│   │   ├── backend/
│   │   ├── frontend/
│   │   └── .rag-index.json
│   ├── otro-proyecto/          ← vault del proyecto B
│   │   ├── src/
│   │   └── .rag-index.json
│   └── docs-generales/         ← vault compartido (wiki, teoría, etc.)
│       ├── ia/
│       └── patrones/
├── rag/                        ← índices independientes
│   ├── agent-framework.json
│   └── otro-proyecto.json
└── config.json                 ← proyecto activo y lista de proyectos
```

---

## 2. Nuevas herramientas MCP

### `codex__list_projects`
Lista todos los proyectos conocidos y su vault asociado.

```json
// Response
{
  "projects": [
    { "id": "agent-framework", "vaultPath": "~/.backendkit/vaults/agent-framework", "noteCount": 311, "active": true },
    { "id": "otro-proyecto",   "vaultPath": "~/.backendkit/vaults/otro-proyecto",   "noteCount": 0,   "active": false }
  ]
}
```

### `codex__use_project`
Cambia el proyecto activo. Todas las operaciones posteriores (`curate_path`, `search_vault`, `read_note`) operan sobre el vault del proyecto activo.

```json
// Input
{ "project": "otro-proyecto" }

// Response
{
  "previousProject": "agent-framework",
  "activeProject": "otro-proyecto",
  "vaultPath": "~/.backendkit/vaults/otro-proyecto",
  "noteCount": 0,
  "indexed": false
}
```

### `codex__create_project`
Crea un nuevo proyecto con su vault vacío.

```json
// Input
{
  "project": "otro-proyecto",
  "rootDir": "/home/user/development/otro-proyecto",
  "cloneFrom": "~/.backendkit/vaults/agent-framework"  // opcional: semilla
}

// Response
{
  "project": "otro-proyecto",
  "vaultPath": "~/.backendkit/vaults/otro-proyecto",
  "status": "created",
  "clonedFrom": "agent-framework",
  "notesCopied": 15
}
```

### `codex__delete_project`
Borra un proyecto y su vault (con confirmación).

```json
// Input
{ "project": "otro-proyecto", "confirm": true }

// Response
{
  "project": "otro-proyecto",
  "status": "deleted",
  "notesRemoved": 42
}
```

---

## 3. Modificaciones a herramientas existentes

### `vault_status` — ahora incluye contexto del proyecto activo

```json
{
  "project": "agent-framework",
  "projectRoot": "C:/.../agent-framework",
  "activeProject": "agent-framework",
  "knownProjects": ["agent-framework", "otro-proyecto"],
  "vaultPath": "...",
  "noteCount": 311,
  "curating": false,
  ...
}
```

### `clone_vault` — se refuerza con semántica multi-proyecto

Ya existe. Podría aceptar `targetProject` para clonar directamente al vault de otro proyecto:

```json
// Input actualizado
{
  "sourcePath": "~/.backendkit/vaults/agent-framework",
  "targetProject": "otro-proyecto",    // nuevo, opcional
  "overwrite": false
}
```

---

## 4. Persistencia: archivo de configuración

`~/.backendkit/config.json`

```json
{
  "activeProject": "agent-framework",
  "projects": {
    "agent-framework": {
      "rootDir": "C:/Users/mairon.cuello/development/workspace-ia/agent-framework",
      "vaultPath": "~/.backendkit/vaults/agent-framework",
      "createdAt": "2026-06-17T12:00:00Z"
    },
    "otro-proyecto": {
      "rootDir": "/home/user/development/otro-proyecto",
      "vaultPath": "~/.backendkit/vaults/otro-proyecto",
      "createdAt": "2026-06-17T15:30:00Z"
    }
  }
}
```

---

## 5. Impacto en el Director (yo)

Cuando se implemente, mi flujo con el usuario sería algo así:

> **Usuario:** "Quiero trabajar con el proyecto API Gateway"
>
> **Yo:** `list_projects` → veo que no existe → `create_project("api-gateway", "/ruta/al/proyecto")`
>
> **Yo:** "Listo, proyecto creado. Ahora estoy en **api-gateway**. ¿Curamos el código?"
>
> **Usuario:** "Sí, cura `src/`"
>
> **Yo:** `curate_path("/ruta/al/proyecto/src")` → opere sobre el vault nuevo

Y para cambiar:

> **Usuario:** "Volvamos a agent-framework"
>
> **Yo:** `use_project("agent-framework")` → cambio de vault al instante
>
> **Yo:** "De vuelta en **agent-framework**. Tenés 311 notas disponibles."

---

## 6. Resumen de herramientas a implementar

| Herramienta | Tipo | Prioridad |
|---|---|---|
| `list_projects` | Nueva | 🔥 Alta |
| `use_project` | Nueva | 🔥 Alta |
| `create_project` | Nueva | 🔥 Alta |
| `vault_status` | Modificar | Alta |
| `clone_vault` | Modificar | Media |
| `delete_project` | Nueva | Baja |

