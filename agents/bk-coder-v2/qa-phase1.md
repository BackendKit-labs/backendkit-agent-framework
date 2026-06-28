# QA Report — Fase 1: Workspace Manager PROJECT

**Proyecto:** BackendKit Coder v2  
**Fecha:** 2026-06-18  
**Agente:** QA (evaluación)  
**Componente evaluado:** `workspace-manager-project/`

---

## Paso 1 — Criterios Funcionales

### Criterio 1: project_create crea proyecto con agentes default y lo persiste en projects.json

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 80-120: `create()` valida name, root, duplicados, y llama a `buildProject()`.
- `src/WorkspaceManager.ts` línea 30-75: `buildProject()` asigna los 5 agentes default (backend, qa, security, design, infra) con sus configuraciones predeterminadas.
- `src/types.ts` línea 40-90: `DEFAULT_AGENTS` define los 5 agentes con model, temperature, maxTokens, tools.
- `src/storage/projectStore.ts` línea 30-40: `saveProject()` escribe en `~/.backendkit/projects.json`.
- Test 3: 11/11 assertions pasan (create exitoso, nombre, root, 5 agentes, memoryNamespace, policies, gates).

### Criterio 2: project_switch cambia el proyecto activo y project_current lo refleja

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 140-155: `switch()` valida existencia, cambia current via `setCurrent()`.
- `src/WorkspaceManager.ts` línea 125-135: `current()` lee el proyecto activo desde `getCurrentProject()`.
- `src/storage/projectStore.ts` línea 75-80: `setCurrent()` persiste el cambio en projects.json.
- Test 8: switch exitoso con previous/current correctos.
- Test 9: project_current refleja el proyecto activo correcto.
- Test 24: switch al mismo proyecto es idempotente.

### Criterio 3: project_get_agent_config('backend') devuelve model, tools, memoryNamespace, root, srcPath

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 160-180: `getAgentConfig()` busca el agente en el proyecto y devuelve su config + root.
- Test 10: 6/6 assertions pasan (model, temperature, memoryNamespace, root, srcPath, tools).
- Test 11: funciona con projectId explícito.
- Test 12: error claro para agente inexistente.

### Criterio 4: project_get_root() devuelve el root del proyecto activo

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 185-200: `getRoot()` devuelve `{ root, name }`.
- Test 13: root y name correctos.
- Test 14: funciona con projectId explícito.

### Criterio 5: project_delete del proyecto activo da error; de uno inactivo funciona

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 125-135: `delete()` verifica si el proyecto es el activo y lanza error.
- `src/storage/projectStore.ts` línea 65-75: `deleteProject()` elimina del JSON y limpia current si era el activo.
- Test 15: error al eliminar proyecto activo.
- Test 16: delete exitoso de proyecto inactivo.

### Criterio 6: project_duplicate clona un proyecto correctamente

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 205-230: `duplicate()` clona el proyecto, actualiza memoryNamespace, permite nuevo root.
- Test 17: 4/4 assertions (success, nombre, root, memoryNamespace actualizado).

### Criterio 7: project_update mergea cambios parciales

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 235-260: `update()` usa `getNestedValue`/`setNestedValue` para merge parcial con notación de path.
- Test 18: 4/4 assertions (success, 2 cambios, cambio de model registrado, model persistido).

### Criterio 8: project_agent_exists devuelve true/false según el agente esté configurado

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 265-280: `agentExists()` verifica existencia del agente en el proyecto.
- Test 19: backend existe con config, frontend no existe.

### Criterio 9: Sin proyecto activo, project_current y project_get_agent_config devuelven error claro

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/WorkspaceManager.ts` línea 125-135: `current()` lanza "No hay proyecto activo. Usá project_switch o project_create." con lista de proyectos disponibles.
- `src/WorkspaceManager.ts` línea 160-180: `getAgentConfig()` lanza "No hay proyecto activo." con hint.
- Test 2: error correcto con mensaje claro.

### Criterio 10: Persistencia: crear proyecto, reiniciar servidor, debe seguir existiendo

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/storage/projectStore.ts`: toda la persistencia es en `~/.backendkit/projects.json`.
- `readProjects()` crea el archivo si no existe.
- `writeProjects()` escribe atómicamente.
- Test 25: crear nueva instancia de WorkspaceManager (simula reinicio) y los proyectos persisten.

---

## Paso 2 — Cumplimiento de ADRs

### ADR-001: Comunicación entre agentes via MCP stdio

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `src/server.ts` usa `StdioServerTransport` de `@modelcontextprotocol/sdk`.
- Tools registradas via `server.tool()` con schemas Zod.

### ADR-004: Dos Workspace Managers separados (PROJECT + VAULT)

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- Workspace Manager PROJECT es un servidor MCP independiente.
- No tiene conocimiento de vaults — solo proyectos, rutas, config, policies, gates.
- Workspace Manager VAULT (externo) maneja vaults por separado.

### ADR-007: Agentes MCP sobre plantillas del framework

**Resultado:** ✅ **CUMPLE**

**Evidencia:**
- `package.json` usa `@modelcontextprotocol/sdk`, `zod`, `dotenv`.
- `src/server.ts` sigue el patrón `McpServer` + `StdioServerTransport`.
- Estructura de directorios consistente con `packages/templates/mcp-server/`.

---

## Resumen de Cumplimiento

| # | Criterio | Resultado | Evidencia |
|---|----------|-----------|-----------|
| 1 | project_create con defaults + persistencia | ✅ | Test 3: 11/11 assertions |
| 2 | project_switch + project_current | ✅ | Tests 8, 9, 24 |
| 3 | project_get_agent_config completo | ✅ | Tests 10, 11, 12 |
| 4 | project_get_root | ✅ | Tests 13, 14 |
| 5 | project_delete (activo error, inactivo ok) | ✅ | Tests 15, 16 |
| 6 | project_duplicate | ✅ | Test 17 |
| 7 | project_update merge parcial | ✅ | Test 18 |
| 8 | project_agent_exists | ✅ | Test 19 |
| 9 | Error sin proyecto activo | ✅ | Test 2 |
| 10 | Persistencia entre reinicios | ✅ | Test 25 |

**Tests ejecutados:** 61 assertions, 0 fallos.

---

## Veredicto

**VEREDICTO: GO** — Los 10 criterios de la Fase 1 se cumplen. El Workspace Manager PROJECT está correctamente implementado con:

- 13 tools MCP funcionales
- Persistencia en `~/.backendkit/projects.json`
- Defaults completos para 5 agentes
- Manejo de errores con mensajes claros
- Operaciones atómicas (write + rename)
- Protección del proyecto activo contra eliminación
- Merge parcial con notación de path
- Idempotencia en switch
- Persistencia entre reinicios del servidor
