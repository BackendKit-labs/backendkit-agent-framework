# SPEC-0017: un contrato por concepto

**Fecha:** 2026-11-14
**Estado:** Borrador (inventario y decisiones; el diseño detallado de cada fase se escribe al empezarla)
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md); [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md) y [SPEC-0016](SPEC-0016-desamarrar-modulos-mixtos.md) para las fases que tocan módulos movidos.
**Tipo de cambio:** por fases. Cada una es aditiva: introduce el contrato, adapta las implementaciones y marca las viejas como obsoletas. La retirada va en el minor siguiente.
**Objetivo:** que cada concepto tenga una sola interfaz, en la capa más baja que lo necesita, y que las implementaciones existentes sean adaptadores de ella (ADR-0008 §3).

Este SPEC no fija diseños. Para cada concepto deja las implementaciones que existen, la pregunta que hay que responder y el criterio para cerrarla. Diseñar cinco contratos de golpe produce diseños que envejecen antes de usarse.

## F1. Workflow (primero: es lo que más necesitan los agentes de negocio)

| Implementación | Qué tiene | Qué le falta |
|---|---|---|
| `core/workflow` (`WorkflowRunner`, 304 líneas) | pasos con `dependsOn`, oleadas paralelas con `maxConcurrency`, `requireApproval` con callback en proceso | definición como datos, compensación, gates con criterios, interpolación de payload |
| `enterprise/flow` (`FlowRunner`, `FlowLoader`, `ComplianceGate`, 858) | definición YAML validada con zod, triggers, gates con criterios y evaluador, compensación, registro de transiciones | concurrencia acotada; se apoya en su propio runner de agentes |
| `coding/workflows/InitWorkflow` (453) | un flujo concreto (inicializar proyecto) | no es un motor: es un consumidor |
| planner y executor de `orchestrator-agent` | plan generado por LLM, subtareas con plazos y cola entre procesos | es una app; consumirá el contrato |

**Pregunta:** ¿el contrato es `FlowDefinition` (datos) con un runner de core, y `WorkflowBuilder` pasa a ser un constructor de `FlowDefinition`?
**Criterio de cierre:** un solo runner en core que ejecute los tests de `core/workflow` y de `enterprise/flow`; la aprobación usa `Approver`/`ApprovalStore` de SPEC-0014; `enterprise` conserva solo `ComplianceGate` como evaluador enchufable.

## F2. Política

| Implementación | Qué es |
|---|---|
| `ToolPolicy` (SPEC-0014) | la decisión por cada llamada a tool |
| `orchestration/policy-engine` | enrutado de tareas del pipeline de coding (sale de core en SPEC-0015) |
| `enterprise/policies/PolicySeeder` | siembra políticas de negocio como notas del vault: es contenido, no decisión |
| `steward/packages/policy-engine` y `governance` | PDP de producto |

**Pregunta:** ¿hace falta algo más que `ToolPolicy` en core? Por ejemplo, una política sobre pasos de workflow.
**Criterio de cierre:** si un paso de workflow necesita decisión, se resuelve con la misma `ToolPolicy` aplicada a una tool sintética del paso, o con un contrato nuevo validado por dos consumidores.

## F3. Auditoría

`AuditSink` queda fijado en SPEC-0014. Esta fase retira lo duplicado:
- `ToolCallRecord` del servidor de tools;
- `AuditRecord` y `AuditLogger` del engine;
- y decide qué pasa con `orchestration/audit`. Ya estará en el vertical: ¿es un consumidor de `AuditSink` o un generador de informes aparte?

**Criterio de cierre:** core tiene un solo tipo de evento de auditoría.

## F4. Memoria

| Implementación | Qué es |
|---|---|
| `SessionMemory` (`memory`, 22 líneas) | clave-valor por sesión, en proceso |
| `agent-memory` (`MemorySystem`: episódica, semántica y procedimental; `MemoryStoreBackend`) | memoria a largo plazo con stores enchufables |
| `ProjectStoreData` | notas de proyecto de coding (sale en SPEC-0015 F4) |
| `coding/store` (`ProjectStore`, `PersistentMemory`, `LearningRouter`) | implementación de coding |

**Pregunta:** ¿`SessionMemoryData` y `MemoryStoreBackend` son el mismo contrato a distinta escala, o dos conceptos (estado de trabajo frente a recuerdo)?
**Criterio de cierre:** como mucho dos contratos con nombre y propósito distintos, documentados, y `coding/store` como adaptador.

## F5. RAG e indexado

| Implementación | Qué es |
|---|---|
| `enterprise/rag` (`ObsidianRAGProvider`, `VaultIndexer`, `VectorStore`, `Embedder`, 1.024 líneas) | RAG sobre un vault con aislamiento por carpeta |
| lance-rag de `orchestrator-agent` | RAG con LanceDB |
| indexer de `mcp-server` (956) | indexado de código con tree-sitter (grafo, no vectores) |

**Pregunta:** ¿un paquete `agent-rag` con `Embedder`, `VectorStore` y `Retriever` como contratos, donde Obsidian y LanceDB son adaptadores?
**Criterio de cierre:** `enterprise` y `orchestrator-agent` comparten contrato. El indexer de código queda fuera (es otro concepto: búsqueda estructural).

## F6. Núcleo genérico de `reflection` (decisión abierta)

Tras SPEC-0015, `reflection` vive en el vertical de coding. La idea genérica, que es catálogo de fallos, detección de patrones y promoción a regla, puede servir a otros verticales.

**Pregunta:** ¿sube a core un núcleo (`FailureCatalog`, `PatternDetector`, `DomainRegistry` sin dominios fijos) con los dominios de coding como plugin?
**Criterio de cierre:** solo si un segundo vertical (por ejemplo Steward, con excepciones de conciliación) lo va a usar. Mientras no sea así, se queda en coding (ADR-0008, riesgo de abstraer de más). **La decisión es del usuario.**
