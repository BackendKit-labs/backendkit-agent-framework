# SPEC-0017: un contrato por concepto

**Fecha:** 2026-11-14
**Estado:** Borrador (inventario y decisiones; el diseño detallado de cada fase se escribe al empezarla)
**Depende de:** [SPEC-0014](SPEC-0014-puntos-de-extension-del-engine.md); [SPEC-0015](SPEC-0015-extraer-coding-de-los-contratos-de-core.md) y [SPEC-0016](SPEC-0016-desamarrar-modulos-mixtos.md) para las fases que tocan módulos movidos.
**Tipo de cambio:** por fases. Cada una es aditiva: introduce el contrato, adapta las implementaciones y marca las viejas como obsoletas. La retirada va en el minor siguiente.
**Fases:** F1 workflow, F2 política, F3 auditoría, F4 memoria, F5 RAG, F6 autoaprendizaje (la única con diseño ya decidido).
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

## F6. Autoaprendizaje como capacidad de core (decidido el 2026-11-14)

**Decisión del usuario:** el autoaprendizaje es una capacidad que debe servir a cualquier agente, no solo a coding. Se diseña un único módulo en core. Sustituye al núcleo de `reflection` y a `ProceduralMemory`, que hoy implementan la misma idea por separado (duplicado D7 de SPEC-0013).

**Qué hay hoy (verificado):**
- **`reflection`:** el ciclo (fallo, catálogo, patrón y regla, más un memo de lecciones) es genérico, pero los datos están atados a la auditoría de código.
  - `FailureRecord` tiene `gate`, `archivos` y `resolvedByCommit` (`reflection/types.ts`).
  - Las reglas se escriben en `.appName/manifest.yaml` del orquestador (`reflection-engine.ts:77`, `policy-promoter.ts`).
  - Las lecciones se leen de `~/.appName/.../audits/lecciones-aprendidas.md` (`context/stages/stage-lessons.ts`).
  - La promoción a regla puede ser automática (`autoPromote`).
- **`agent-memory/ProceduralMemory`:** aprende patrones `trigger → action → outcome` (`learnPattern`) y los inyecta como bloque de contexto (`buildContextBlock`).

**Diseño objetivo:**

```
señales ──► catálogo de experiencias ──► detector de patrones ──┬─► lecciones (hook systemPrompt)
                                                               └─► reglas propuestas ──► aprobación humana ──► ToolPolicy / Guardrail
```

1. **Señales genéricas.** Las produce el engine con los hooks y la auditoría de SPEC-0014:
   - error, timeout o salida demasiado grande de una tool;
   - denegación de la política;
   - bloqueo de un guardrail;
   - aprobación rechazada;
   - veredicto de un hook `afterTurn` (QA);
   - feedback explícito del usuario.

   Un vertical puede añadir señales propias mediante una API `learning.record(...)`.
2. **Experiencia genérica:**

   ```ts
   interface Experience {
     id: string; at: string;
     agentId: string; domain: string;      // domain libre: 'tool', 'policy', 'commit'...
     situation: string;                    // qué se intentaba
     action: string;                       // qué se hizo (tool + argsHash, o paso)
     outcome: 'success' | 'failure';
     kind: string;                         // tipo de fallo, abierto
     severity: 'low' | 'medium' | 'high' | 'critical';
     detail?: string;
     meta?: Record<string, unknown>;       // lo específico del vertical (archivos, commit...)
   }
   ```

   Se guarda sobre `MemoryStoreBackend`, que es enchufable (archivo, memoria u otros).
3. **Detector de patrones:** se reutiliza `PatternDetector`, quitándole los dominios fijos.
4. **Primera salida, lecciones:** texto breve inyectado en el prompt del agente afectado mediante el hook `systemPrompt`, con tope de tamaño y saneo (SPEC-0009).
5. **Segunda salida, reglas propuestas:**
   - se guardan como propuestas en un `ApprovalStore` (SPEC-0014);
   - **nunca se promueven solas**;
   - una vez aprobadas, se convierten en una `ToolPolicy` o un `Guardrail` declarativo.

   Desaparece la escritura en `manifest.yaml`.
6. **Coding como plugin:** los dominios `audit`, `test`, `commit`, `bootstrap` y `agent`, sus hooks y el informe de lecciones en Markdown pasan al vertical de coding, como productores de señales y tipos de fallo.

**Criterio de cierre:**
- Un agente de negocio sin código de coding aprende de una tool que falla de forma repetida: recibe la lección en su prompt y genera una regla propuesta pendiente de aprobación.
- El pipeline de coding conserva su comportamiento con su plugin.
- `ProceduralMemory` queda como adaptador obsoleto del módulo nuevo.

**Dependencias:**
- SPEC-0014 F1-F3: hooks, `AuditSink` y `ApprovalStore`.
- SPEC-0015 F2: el resto de `reflection` sale a coding en el mismo movimiento.
