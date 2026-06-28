# QA Report — Fase 2: Codex-Context-V2 extendido

**Proyecto:** BackendKit Coder v2  
**Fecha:** 2026-06-18  
**Agente:** QA (evaluación)  
**Etapa:** VERIFY  
**Componente evaluado:** `codex-context-agent/` (a construir en `bk-coder-v2/`)

---

## Estado Actual

El directorio `codex-context-agent/` **no existe** en `agent-framework/agents/bk-coder-v2/`. La Fase 2 no se ha implementado.

El Codex-Context-V2 original existe en `agent-framework/agents/codex-context-agent-v2/` pero **no debe modificarse** — ya lo usan otros agentes.

---

## Paso 1 — Criterios Funcionales

### Criterio 1: search_vault({query}) consulta al VAULT MANAGER y busca en el vault activo

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- El directorio `codex-context-agent/` no existe.
- No hay implementación que consulte al Workspace Manager VAULT.
- El Codex original usa detección por git root, no consulta MCP al VAULT MANAGER.

### Criterio 2: search_knowledge({query}) consulta al PROJECT MANAGER y busca en memories/{namespace}/knowledge/

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe la tool `search_knowledge` en ningún lado.
- No hay implementación que consulte al Workspace Manager PROJECT.
- No hay almacenamiento en `~/.backendkit/memories/{namespace}/knowledge/`.

### Criterio 3: learn_pattern() guarda en memories/{namespace}/patterns/

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe la tool `learn_pattern`.
- No hay almacenamiento en `~/.backendkit/memories/{namespace}/patterns/`.

### Criterio 4: remember() guarda en memories/{namespace}/episodes/

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe la tool `remember`.
- No hay almacenamiento en `~/.backendkit/memories/{namespace}/episodes/`.

### Criterio 5: recall() busca en memories/{namespace}/episodes/

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe la tool `recall`.
- No hay implementación de búsqueda en memoria episódica.

### Criterio 6: promote_patterns() promueve patrones con count>=3 a reglas automáticas

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe la tool `promote_patterns`.
- No hay implementación de conteo de patrones ni promoción a reglas.

### Criterio 7: reindex() reindexa un namespace específico

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- El Codex original tiene `reindex_vault` pero no acepta `namespace`.
- No existe implementación que reindexe por namespace.

### Criterio 8: Cache de resolución de namespace funciona con TTL 30s

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- No existe resolución de namespace.
- No hay cache con TTL.

---

## Paso 2 — Cumplimiento de Decisiones de Diseño (ADRs)

### ADR-001: Comunicación entre agentes via MCP stdio

**Resultado:** ❌ **NO APLICA** (no hay implementación)

**Evidencia:**
- No existe `codex-context-agent/` para verificar.

### ADR-004: Dos Workspace Managers separados (PROJECT + VAULT)

**Resultado:** ❌ **NO CUMPLE**

**Evidencia:**
- El design.md especifica que Codex debe consultar al VAULT MANAGER para `search_vault()` y al PROJECT MANAGER para `search_knowledge()`.
- No hay implementación que consulte a ningún Workspace Manager.

### ADR-007: Agentes MCP sobre plantillas del framework

**Resultado:** ❌ **NO APLICA** (no hay implementación)

**Evidencia:**
- No existe `codex-context-agent/` para verificar.

---

## Resumen de Cumplimiento

| # | Criterio | Resultado |
|---|----------|-----------|
| 1 | search_vault consulta VAULT MANAGER | ❌ No implementado |
| 2 | search_knowledge consulta PROJECT MANAGER | ❌ No implementado |
| 3 | learn_pattern() guarda en patterns/ | ❌ No implementado |
| 4 | remember() guarda en episodes/ | ❌ No implementado |
| 5 | recall() busca en episodes/ | ❌ No implementado |
| 6 | promote_patterns() promueve a reglas | ❌ No implementado |
| 7 | reindex() con namespace | ❌ No implementado |
| 8 | Cache TTL 30s | ❌ No implementado |

**0/8 criterios cumplidos.**

---

## Plan de Implementación

Para aprobar VERIFY, hay que crear `codex-context-agent/` en `bk-coder-v2/` con:

### 1. Estructura de directorios

```
codex-context-agent/
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts                    ← Entry point MCP
    ├── memory/
    │   ├── knowledgeStore.ts        ← save_knowledge, search_knowledge
    │   ├── patternStore.ts          ← learn_pattern, search_patterns, promote_patterns
    │   └── episodeStore.ts          ← remember, recall
    ├── resolution/
    │   ├── vaultResolver.ts         ← consulta VAULT MANAGER (cache TTL 30s)
    │   └── memoryResolver.ts        ← consulta PROJECT MANAGER (cache TTL 30s)
    └── tools/
        ├── searchVault.ts           ← extendida (resuelve via VAULT MANAGER)
        ├── searchKnowledge.ts       ← nueva
        ├── saveKnowledge.ts         ← nueva
        ├── learnPattern.ts          ← nueva
        ├── searchPatterns.ts        ← nueva
        ├── promotePatterns.ts       ← nueva
        ├── remember.ts              ← nueva
        ├── recall.ts                ← nueva
        └── reindexVault.ts          ← extendida (con namespace opcional)
```

### 2. Resolución dual

- **VaultResolver**: cliente MCP que llama a `workspace_current()` del Workspace Manager VAULT para obtener el vault activo. Cache con TTL 30s.
- **MemoryResolver**: cliente MCP que llama a `project_current()` del Workspace Manager PROJECT para obtener el `memoryNamespace`. Cache con TTL 30s.

### 3. Memoria 3-tier

- **KnowledgeStore**: guarda/busca en `~/.backendkit/memories/{namespace}/knowledge/*.json`
- **PatternStore**: guarda/busca/promueve en `~/.backendkit/memories/{namespace}/patterns/*.json`
- **EpisodeStore**: guarda/busca en `~/.backendkit/memories/{namespace}/episodes/*.json`

### 4. Tools MCP (9 tools)

| Tool | Input | Output |
|---|---|---|
| `search_vault` | `{ query, namespace?, topK? }` | Notas del vault activo |
| `search_knowledge` | `{ query, namespace?, domain? }` | Items de conocimiento |
| `save_knowledge` | `{ content, tags, namespace, domain? }` | `{ success, id }` |
| `learn_pattern` | `{ trigger, action, outcome, namespace }` | `{ success, id }` |
| `search_patterns` | `{ trigger?, namespace, minCount? }` | Patrones encontrados |
| `promote_patterns` | `{ namespace, minCount? }` | `{ promoted, rules }` |
| `remember` | `{ content, tags, severity, namespace }` | `{ success, id }` |
| `recall` | `{ query, namespace, severity?, limit? }` | Episodios encontrados |
| `reindex_vault` | `{ namespace? }` | `{ indexed, updated }` |

---

## Veredicto

**VEREDICTO: NO-GO** — La Fase 2 no se ha implementado. El directorio `codex-context-agent/` no existe. 0/8 criterios funcionales cumplidos. Se requiere implementación completa antes de poder verificar.
