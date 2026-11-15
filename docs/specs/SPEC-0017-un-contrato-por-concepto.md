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

### Diseño detallado de F6 (2026-11-15)

**Decisiones del usuario (2026-11-15):**
1. **Aditivo.** El módulo nuevo se añade a core; `ReflectionEngine` y `ProceduralMemory` quedan `@deprecated`. Las excepciones del test de grep (`reflection/`, `project-key.ts`) se quitan en el minor siguiente: `project-key` no se mueve con reflection, porque `ProjectStore`, `AgentLoader` y apps externas lo importan.
2. **Las reglas aprendidas nunca se aplican solas, tampoco en coding.** Cambia el comportamiento actual de coding (`autoPromote`): sus reglas quedan pendientes hasta que una persona las aprueba. El resto de agentes ya funcionaba así en `enterprise`.
3. **Almacén de reglas enchufable.** `enterprise` aporta un adaptador que sigue escribiendo el YAML del vault; las propuestas pendientes usan el `ApprovalStore` con `subject.kind = 'rule_proposal'`, que ya existe (SPEC-0014).

**Módulo `core/src/learning`.** Un único punto de entrada:

```ts
const learning = createLearning({
  store?,        // MemoryStoreBackend de las experiencias; por defecto en memoria (un engine sin configurar no toca disco)
  approvals?,    // ApprovalStore de las propuestas; por defecto en memoria
  rules?,        // RuleStore de las reglas aprobadas; por defecto en memoria
  threshold?,    // repeticiones para aprender (3)
  lessons?: { maxChars?, maxLessons? },
  ruleFor?,      // (pattern) => unknown | undefined: qué regla propone un patrón. Por defecto, solo para fallos de tool
});
createBaseEngine({ ..., audit: learning.sink, hooks: [learning.hooks], policy: learning.policy });
```

- **Señales.** `learning.sink` es un `AuditSink`: de cada llamada que falla, agota el tiempo, devuelve demasiado, es denegada por la política o bloqueada por guardrail o sandbox deriva una `Experience`. No guarda éxitos. `learning.record(...)` admite las señales de un vertical (veredicto de QA, feedback del usuario, fallos de commit...).
- **`Experience`.** La de la SPEC más un campo `subject?: string` (de qué trata: el nombre de la tool, el paso...). Un patrón agrupa por `domain + kind + subject`.
- **Patrones.** `PatternDetector` generalizado: cuenta por clave, devuelve `LearnedPattern` (clave, conteo, primera y última vez, severidad máxima, agentes afectados, ids). Escanea todo el almacén (`MemoryStoreBackend` no consulta por campo) y filtra en memoria; el almacén está acotado (`maxExperiences`, por defecto 1000, descarta lo más antiguo).
- **Lecciones.** `learning.hooks` añade, por `systemPrompt`, las lecciones de los patrones del agente que supera el umbral. Salen por `composeInstructionLayers` (saneo de SPEC-0009, `maxChars`): lo que viene de una tool es no confiable.
- **Reglas.** Al superar el umbral por primera vez, `ruleFor(pattern)` devuelve una regla y se guarda una propuesta pendiente en el `ApprovalStore`, con id estable por patrón (no se duplica). `learning.approve(id, by)` y `learning.reject(id, by)` resuelven la propuesta; si se aprueba, la regla pasa al `RuleStore`. `learning.retire(ruleId)` la retira (desaprobar). La regla por defecto de una tool que falla es `{ tool, effect: 'ask' }`. `learning.policy` es una `ToolPolicy` que aplica las reglas aprobadas con `tool`.
- **Reglas de un vertical.** `rule` es opaco para core. Coding devuelve desde `ruleFor` una `PolicyRule` de su orquestador y lee las aprobadas del `RuleStore`.
- **Almacenes.** `MemoryRuleStore` y `FileRuleStore` (JSON) en core.

**Fases (aditivas):**
- **F6a. Módulo de core.** `learning/` con la prueba de aceptación (un agente de negocio sin código de coding: una tool falla N veces, recibe la lección y hay una propuesta pendiente sin aplicar).
- **F6b. Coding.** Los dominios y hooks pasan a ser productores de señales; `manifest.yaml` deja de escribirse y el orquestador lee las reglas aprobadas del `RuleStore`. Se fija antes el comportamiento actual con la suite del pipeline (`reflection-cycle`).
- **F6c. Enterprise.** `EnterpriseReflection` sobre el módulo nuevo, con un `RuleStore` que escribe el YAML del vault (`approvePromotion`, `demotionCandidates`, `activeRules`).
- **F6d. Obsolescencia y documentación.** `@deprecated` en `ReflectionEngine`, `ProceduralMemory` y `DomainRegistry`; README; CHANGELOG. La retirada va en el minor siguiente.

**Estado de F6 (2026-11-15).** F6a (core), F6b (coding), F6c (enterprise) y F6d (obsolescencia y documentación) están hechas. Lo que se hizo distinto de lo escrito arriba:

| Punto | Diseño | Hecho | Por qué |
|---|---|---|---|
| Umbral | `threshold` único | `threshold` y `thresholdFor(experience)` | `enterprise` ya usaba un umbral por severidad. |
| Reglas de tool en coding | — | **coding no propone reglas de tool**; solo lecciones | Aplicarlas exigiría pasar `policy` al engine, y eso cambia coding a la ruta gobernada de aprobación. Las reglas de coding son `PolicyRule` del orquestador. |
| Ámbito de las reglas de coding | `manifest.yaml` global de la app | por proyecto, en `~/.{appName}/projects/<proyecto>/learning/` | El catálogo ya era por proyecto. El `manifest.yaml` global anterior se sigue leyendo. |
| `ProceduralMemory` | adaptador obsoleto del módulo | solo `@deprecated` | No hay consumidor que migrar. |
| `LessonsMemoGenerator` y `HistoricalLoader` | pasan a señales | **siguen sobre `ReflectionEngine`** (obsoleto) | El informe de lecciones en Markdown de coding queda para la retirada. |
| Excepciones del test de grep | se quitan | **siguen**: `reflection/` y `project-key.ts` | Cada fase es aditiva; salen en el minor que retire `reflection`. |
