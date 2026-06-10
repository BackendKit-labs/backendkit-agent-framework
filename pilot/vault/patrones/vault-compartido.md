---
title: "Patrón: Vault compartido como memoria colectiva"
date: 2026-06-01
tags: ["área/arquitectura", "tipo/patrón", "stack/rag", "stack/vault"]
description: "Cómo usar un vault Markdown como fuente única de verdad entre múltiples agentes enterprise"
---

## Descripción

Todos los agentes de un proyecto comparten un único vault Markdown. Los humanos
documentan el negocio ahí. Los agentes buscan contexto antes de responder y escriben
de vuelta lo que aprenden. El LLM local consulta el vault vía RAG.

## Ciclo de conocimiento

```
1. Humano documenta  →  vault/docs/política-vacaciones.md
2. Agente consulta   →  search_knowledge("política vacaciones")  →  LLM recibe el chunk
3. Agente responde   →  respuesta contextualizada con política real de la empresa
4. Agente aprende    →  write_knowledge("edge case encontrado: ...")
5. Próximo agente    →  encuentra ese edge case en la búsqueda → no lo repite
```

## Implementación con BackendKit

```typescript
// Una sola instancia de RAG + Writer compartida entre todos los agentes
const rag = new ObsidianRAGProvider({
  vaultPath: process.env.VAULT_PATH,
  folders: ['docs', 'decisiones', 'patrones', 'agentes'],  // compartido
  embedder: new SimpleEmbedder(),  // o OllamaEmbedder para producción
  topK: 5,
  minScore: 0.15,
});

const writer = new VaultWriter({ vaultPath: process.env.VAULT_PATH });

await rag.index({ verbose: true });

const tools = new ToolRegistry();
tools.register(rag.createTool());          // search_knowledge — todos pueden buscar
tools.register(writer.createTool('agente'));  // write_knowledge — escribe a agentes/
```

## Estructura de carpetas recomendada

```
vault/
  docs/         ← humanos documentan: políticas, procesos, manuales
  decisiones/   ← ADRs: qué se decidió y por qué
  patrones/     ← patrones reutilizables del proyecto
  lecciones/    ← errores cometidos y aprendizajes
  clientes/     ← contexto por cliente/proyecto (RBAC si hay datos sensibles)
  agentes/      ← notas escritas por agentes (auto-generadas)
```

## RBAC por carpeta

Para proyectos con datos sensibles, montar solo las carpetas permitidas por agente:

```typescript
// HR Agent solo ve carpetas de RRHH y compartidas
const hrRag = new ObsidianRAGProvider({
  vaultPath,
  folders: ['docs/rrhh', 'agentes', 'decisiones'],  // NO ve finanzas/ventas
});

// Finance Agent solo ve finanzas
const financeRag = new ObsidianRAGProvider({
  vaultPath,
  folders: ['docs/finanzas', 'agentes', 'decisiones'],
});
```

## Cuándo RE-indexar

- Después de que un agente escribe una nota nueva → `await rag.index()`
- Al inicio de cada sesión si el vault puede haber cambiado → `await rag.index()`
- El indexado es incremental (por mtime) — solo re-embeds archivos nuevos o modificados
