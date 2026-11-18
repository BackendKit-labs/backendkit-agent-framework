# SPEC-0032: memoria de trabajo (evaluar antes de construir)

**Fecha:** 2026-11-17
**Estado:** Borrador. **Es una evaluación**: la fase F0 es un experimento y decide si hay algo que construir. Sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). Mastra tiene una "memoria de trabajo" (un bloque estructurado que el agente edita y que viaja en el prompt) y una "memoria observacional" (observaciones y reflexiones que sustituyen al historial). La primera versión de la comparación listó la compactación del contexto como un hueco: **era un error**, ya existe (ver §1).
**Depende de:** nada.
**Tipo de cambio:** a decidir en F0; si se construye, aditivo.
**Objetivo:** decidir con una prueba, no con una opinión, si el framework necesita un estado estructurado y editable por el agente además de lo que ya tiene.

## 1. De dónde se parte

Verificado el 2026-11-17 en `packages/core/src`:

- **Compactación del contexto: existe.** `ContextManager` (`engine/ContextManager.ts`) trabaja por tokens (`maxTokens`), resume o descarta los turnos viejos (`strategy: 'summarize' | 'drop'`), protege los últimos turnos (`keepRecentTurns`), recorta resultados de tools largos, y ante un desbordamiento del proveedor fuerza una compactación y reintenta (`overflowRetry`). Emite `CompactionReport`. Esa parte **no** se toca.
- **Memoria de largo plazo: existe, en tres capas** (`agent-memory/`): episódica (experiencias, con resumen opcional `summarizeFn` y retención), semántica (conocimiento, con embeddings si se da `embedFn`, y puntuación por palabras si no) y procedural (patrones aprendidos). Tools para el modelo: `memory_remember`, `memory_recall`, `memory_save_knowledge`, `memory_search_knowledge` y `memory_learn_pattern`. `MemorySystem.buildContextBlock(query)` arma un bloque con lo relevante para el prompt del sistema.
- **Aprendizaje:** `createLearning` (fallos repetidos → lecciones y reglas con aprobación humana) es otro módulo, ya implementado.
- **Lo que no vi:** un estado estructurado que el agente **actualice por sí mismo** (por ejemplo, el perfil de un cliente que va completando durante una conversación) y que **siempre** esté en el prompt, con un esquema. Lo más parecido es `memory_save_knowledge` + `buildContextBlock`, que es recuperación por consulta, no un bloque fijo.

## 2. Evidencia en la competencia

Mastra, commit `35745537` (`packages/core/src/memory`, `packages/memory/src`): `working-memory-utils.ts` define las etiquetas `<working_memory>` y las tools `updateWorkingMemory` y `setWorkingMemory`; `memory-config` y `types.ts` documentan `workingMemory: { enabled, ... }` con un esquema opcional y el alcance (por hilo o por recurso); hay `merge-working-memory.test.ts`. La memoria observacional (`observational-memory-options`) usa un modelo para **observar** y otro para **reflexionar** sobre el historial. Es el equivalente de nuestro `ContextManager` más una capa de reflexión.

## 3. Preguntas que F0 debe responder

| # | Pregunta | Cómo se responde |
|---|---|---|
| Q1 | ¿Un agente con `memory_save_knowledge` y `buildContextBlock` mantiene bien un estado de varios campos (por ejemplo, 8 datos de un cliente) a lo largo de 20 turnos? | Banco con `scriptedProvider` y con un modelo real: ¿qué fracción de los datos sigue correcta al final, y cuántos tokens cuesta? |
| Q2 | ¿Un bloque fijo con esquema lo haría mejor o más barato? | La misma prueba con un prototipo mínimo (una tool `update_working_memory` y un bloque en el prompt) fuera del framework, en el banco. |
| Q3 | ¿La reflexión sobre el historial (memoria observacional) aporta algo sobre el resumen de `ContextManager`? | Comparar, sobre conversaciones largas, la información que sobrevive a la compactación con `summarize` y con una reflexión por pasos. |
| Q4 | ¿Cómo encaja con el gobierno? | Un estado que el agente edita es una **escritura**: ¿requiere política, auditoría, `redact`? Debe responderse antes de cualquier diseño. |

## 4. Decisión que sale de F0

| Resultado | Qué se hace |
|---|---|
| Q1 satisface el caso | **No se construye.** Se documenta el patrón "estado de trabajo con `memory_*`" en la página de memoria de la web, con el ejemplo del banco. |
| Q2 gana de forma clara | Se redacta el diseño: `workingMemory: { schema, scope: 'thread' \| 'user' }` en `createMemorySystem`, una tool `update_working_memory` con la declaración de hechos de siempre, el bloque en el prompt con etiquetas estables (para la caché), y auditoría de cada edición. Se vuelve a esta spec para fijar D1-Dn. |
| Q3 gana de forma clara | Se evalúa como una estrategia más de `ContextOptions.strategy` (`'reflect'`), no como un módulo aparte. |

## 5. Fases

- **F0. Experimento (Q1-Q4).** En `agent-framework-examples`, un banco `memory-bench` con tres escenarios (perfil de cliente, tarea larga con decisiones, conversación de 60 turnos) y un informe con tasa de acierto y tokens por variante. Se ejecuta con `scriptedProvider` para la plomería y una vez en vivo (DeepSeek, bajo demanda del usuario).
- **F1 en adelante.** Solo si F0 lo decide, según el cuadro de §4.

## 6. Criterio de aceptación de F0

Un informe con números por variante y una recomendación escrita en esta spec: construir, documentar un patrón o descartar. No se escribe código del framework antes.

## 7. Fuera de alcance

La compactación del contexto (ya existe), la memoria semántica y el aprendizaje (existen) y cualquier almacén vectorial (es [SPEC-0033](SPEC-0033-rag-generico.md)).
