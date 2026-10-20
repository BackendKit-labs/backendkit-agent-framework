# Architecture Decision Records — AIOps Agent

> **Last Updated**: 2026-10-19  
> Log de decisiones. Una entrada por decisión; no se editan, se reemplazan (nuevo ADR + `Superseded by`).

**Status values**: Proposed · Accepted · Superseded · Deprecated

**Template**

```
## ADR-NNN: Título
- Status:
- Date:
- Context:
- Decision:
- Consequences:
- Alternatives:
```

## Index

| ADR | Title | Status |
|-----|-------|--------|
| 001 | TypeScript sobre agent-core (no Python) | Accepted |
| 002 | Orquestador liviano propio | Accepted |
| 003 | LLM emite solo JSON; ejecución en código | Accepted |
| 004 | Policy guard determinista post-LLM | Accepted |
| 005 | Justificación en viñetas, sin chain-of-thought | Accepted |
| 006 | Similares: SQLite + coseno en memoria | Accepted |
| 007 | Audit JSONL uniforme, un evento por paso | Accepted |
| 008 | Resiliencia con @backendkit-labs/retry | Accepted |
| 009 | Providers inyectables para tests | Accepted |
| 010 | Runbooks vía vault codex-context (opcional, advisory, sin LLM externo) | Accepted |
| 011 | Correcciones deterministas sobre la salida del modelo | Accepted |

---

## ADR-001: TypeScript sobre agent-core (no Python)
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: El prompt original pide Python; el usuario pidió usar nuestro framework (@backendkit-labs), que es TypeScript.
- **Decision**: Implementar en TS como workspace `agents/aiops-agent`, reutilizando `defineTool`, `OllamaProvider` y `OllamaEmbedder`.
- **Consequences**: Se reutiliza código del monorepo; la estructura Python pedida se mapea a `.ts` (`logging_utils` → `audit.ts`). Tests con jest.
- **Alternatives**: Python puro independiente (descartado: ignora el framework).

## ADR-002: Orquestador liviano propio
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: El `Orchestrator` de core (FSM, customGates) está orientado a flujos de coding. Aquí el flujo es lineal de 9 pasos con 2 agentes.
- **Decision**: Orquestador propio en `orchestrator.ts` sobre las piezas de agent-core.
- **Consequences**: Menos ceremonia y dependencias. Si surgen más verticales, reevaluar migrar a customGates.
- **Alternatives**: `Orchestrator` de core con `includeDefaultRules:false` y gate `policy_check`; LangGraph/CrewAI (otro ecosistema, Python).

## ADR-003: LLM emite solo JSON; ejecución en código
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: El modelo no debe inventar herramientas ni comandos.
- **Decision**: El modelo devuelve JSON validado con zod (`action` ∈ enum cerrado). El orquestador ejecuta la tool. Fuera de enum → `needs_human`.
- **Consequences**: Superficie de ejecución controlada por código; sin tool-calling libre del modelo (modelos 3B lo hacen mal igualmente).
- **Alternatives**: Tool-calling nativo del modelo (menos control, más fallos en modelos chicos).

## ADR-004: Policy guard determinista post-LLM
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Las políticas no pueden depender de que el modelo las obedezca.
- **Decision**: `policy.ts` valida/degrada la decisión tras el LLM, ignora la confianza del modelo y decide `requires_approval` por severidad/criticidad.
- **Consequences**: Prompt injection no salta políticas; el paso `policy_guard` queda auditado.
- **Alternatives**: Políticas solo en el prompt (bypasseable).

## ADR-005: Justificación en viñetas, sin chain-of-thought
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Caja blanca sin exponer razonamiento privado.
- **Decision**: Campo `justification` de 3–5 viñetas técnicas ligadas a evidencia (`evidenceRefs`).
- **Consequences**: Auditable y breve; no se guardan transcripts crudos del modelo.
- **Alternatives**: Guardar CoT completo (descartado por spec y por ruido).

## ADR-006: Similares con SQLite + coseno en memoria
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Se busca incidentes similares sin servicios pesados; objetivo <30 ms.
- **Decision**: Embeddings `nomic-embed-text` (Ollama) guardados como BLOB en SQLite; coseno en memoria; fallback por keywords si no hay embedder. Latencia de embed y búsqueda medidas por separado.
- **Consequences**: Cero dependencias nuevas; válido a cientos/miles de incidentes.
- **Alternatives**: FAISS/ChromaDB (reservado si la base supera ~10k); solo FTS (menos semántico).

## ADR-007: Audit JSONL uniforme, un evento por paso
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Auditoría y consulta simple con jq/grep.
- **Decision**: Un evento por paso con los 16 campos mínimos; los no aplicables van `null`, nunca omitidos. Append-only en `logs/decisions.jsonl`. Hash-chain planificado (Fase 5).
- **Consequences**: Esquema estable; fallo de escritura falla la ejecución (la auditoría es obligatoria).
- **Alternatives**: Un registro único por alerta (pierde trazabilidad por paso).

## ADR-008: Resiliencia con @backendkit-labs/retry
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Preferencia global: usar libs de backendkit.dev para resiliencia.
- **Decision**: Llamadas a Ollama con timeout + retry exponencial (máx. 2). Sin circuit breaker (una sola dependencia local).
- **Consequences**: Fallo explícito (`needs_human` / exit code 2), nunca acción adivinada.
- **Alternatives**: Retry manual (ya existe uno en `OllamaProvider`, pero se centraliza política aquí).

## ADR-009: Providers inyectables para tests
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: CI no tiene Ollama.
- **Decision**: Agentes y similar reciben `LLMProvider`/embedder por constructor; los tests usan stubs deterministas.
- **Consequences**: Tests rápidos y reproducibles; smoke test real manual.
- **Alternatives**: Mockear `fetch` global (más frágil).

## ADR-010: Runbooks vía vault codex-context (opcional, advisory, sin LLM externo)
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Runbooks y políticas narrativas de TI aportan evidencia útil, pero un RAG no es determinista y la búsqueda del vault tarda segundos (vs. objetivo <30 ms de similares). Además `curate_path`/`curate_link` usan un LLM, posiblemente externo.
- **Decision**:
  1. Paso opcional `knowledge_lookup` (`--use-vault`), de solo lectura, usando `ObsidianRAGProvider` (`@backendkit-labs/agent-enterprise`) como librería, sin servidor MCP stdio.
  2. Vault propio del agente (`VAULT_PATH`, p. ej. `agents/aiops-agent/vault/`), aislado del vault del repo.
  3. Curado sin LLM: notas `.md` escritas a mano con frontmatter (`title, area, tipo, resumen, tags, aplica_a, source_ref`) + reindex con embeddings locales vía Ollama (`nomic-embed-text`, el mismo `OllamaEmbedder` que usa la búsqueda de incidentes similares). Curado automático de docs crudos solo opcional con Ollama local (`provider: ollama`) y revisión manual.
  4. El resultado es evidencia (`doc:<nota>`) citable en `evidence`/`justification`; **nunca** alimenta el policy guard (ADR-004).
  5. Si falta vault o modelo de embeddings, se omite el paso y se registra en el log.
- **Consequences**: Más evidencia auditable, 100% local y versionable. El contenido del vault se trata como dato no confiable (T-01). Sin salidas de red del agente: todo va a Ollama en localhost. El modelo de embeddings (~274 MB) se obtiene una vez con `ollama pull nomic-embed-text`. Una sola dependencia local (Ollama) para LLM y embeddings. Se evaluó Transformers.js (usado por codex-context-agent-v2) y se descartó: su embedder vive dentro de ese agente, no en una librería, y el LLM igual requiere Ollama.
- **Alternatives**: Usar el MCP codex-context directo (dependencia de proceso, vault mezclado); curar con LLM cloud (viola "sin servicios externos"); no usar vault (menos contexto).

## ADR-011: Correcciones deterministas sobre la salida del modelo
- **Status**: Accepted
- **Date**: 2026-10-19
- **Context**: Corridas reales con llama3.2:3b mostraron: severidad `low` para un servidor al 99%, categoría `service_down` para una alerta de CPU, y `scale_cpu` sobre un servidor sano al 35%.
- **Decision**: El código solo puede **elevar** la severidad según el inventario (`severityFloor`), corregir la categoría si el texto contiene exactamente una palabra clave de recurso (`categoryHint`), y degradar acciones sin evidencia (P-06: `scale_cpu` exige cpu>=80%, si no `no_action`/`needs_human`). Cada corrección queda anotada en el evento correspondiente.
- **Consequences**: Menor dependencia de la calidad del modelo; todo auditable. Más reglas de código que mantener.
- **Alternatives**: Modelo más grande (contradice bajo consumo); confiar en el prompt (inestable en 3B).
