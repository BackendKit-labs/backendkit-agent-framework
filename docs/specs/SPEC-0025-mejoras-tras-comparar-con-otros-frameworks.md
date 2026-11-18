# SPEC-0025: mejoras tras comparar con otros frameworks (índice y orden de ejecución)

**Fecha:** 2026-11-17
**Estado:** Índice vigente. Ola A: 0029, 0028 y 0030 hechas y publicadas; 0037 en pausa. Ola B: 0021 en curso; 0026, 0027 y 0031 sin empezar. *(Revisado el 2026-11-18; antes decía: Borrador. Índice de SPEC-0026 a SPEC-0037, sin implementar.)*
**Origen:** análisis comparativo del código de Mastra, LangGraph.js, OpenAI Agents JS y Vercel AI SDK, pedido por el usuario el 2026-11-17 ("analizar código de otros framework para ver qué tienen que nosotros no").
**Relacionado:** [SPEC-0013](SPEC-0013-framework-como-libreria-hoja-de-ruta.md) (hoja de ruta del framework como librería), [SPEC-0021](SPEC-0021-evaluaciones-de-agentes.md) (evals, ya en borrador), [SPEC-0017](SPEC-0017-un-contrato-por-concepto.md) F5 (contrato de RAG).
**Tipo de cambio:** ninguno. Este documento solo ordena.
**Objetivo:** que cada mejora se implemente paso a paso, en sesiones separadas, partiendo de una spec que ya trae el código de origen, las decisiones y las fases con su prueba.

## 1. Qué se revisó y con qué límites

| Repo | Commit | Cómo se revisó |
|---|---|---|
| Mastra (`mastra-ai/mastra`) | `35745537` | Estructura de `packages/core/src` (workflows, memory, evals, datasets, background-tasks, schedules, signals, knowledge) y firmas de `workflow.ts` |
| LangGraph.js (`langchain-ai/langgraphjs`) | `7257a24` | Estructura de `libs/` (checkpointers por base de datos, prebuilt supervisor y swarm, sdk-react) y `pregel/index.ts` |
| OpenAI Agents JS (`openai/openai-agents-js`) | `90a6b52` | Estructura de `agents-core/src` (handoff, guardrail, memory/sessions, tracing, runState, sandbox) |
| Vercel AI SDK (`vercel/ai`) | `486e08f` | **Solo documentación.** El clon salió sin `packages/`; se leyeron `AGENTS.md` y `content/` (agentes, tool approvals, tool search, code mode, middleware, providers) |

**Límites.** Se leyeron firmas, nombres de archivos y pruebas, no la calidad de la implementación. Un hueco de esta lista significa "no lo vi en nuestro código tras buscarlo", y cada spec lo vuelve a comprobar en su fase F0 antes de construir.

## 2. Correcciones al análisis inicial

Dos supuestos del primer informe resultaron falsos al leer nuestro código. Se dejan escritos para que nadie los repita:

- **Compactación del contexto: ya existe.** `ContextManager` (`packages/core/src/engine/ContextManager.ts`) controla el contexto por tokens: resume o descarta los turnos viejos, protege los recientes, corta resultados de tools largos y reintenta ante un desbordamiento. No es un hueco. La parte que queda es la memoria de trabajo (SPEC-0032).
- **RAG: ya hay un diseño.** SPEC-0017 F5 plantea el contrato `Embedder` / `VectorStore` / `Retriever`. SPEC-0033 lo amplía; no lo reemplaza.

## 3. Las mejoras

| Spec | Mejora | Fuente de la idea | Esfuerzo | Estado de partida |
|---|---|---|---|---|
| [0026](SPEC-0026-control-de-flujo-en-flows.md) | Control de flujo en flows: reintentos por paso, `foreach`, `repeat`, `sleep`, `waitFor` | Mastra, LangGraph | Medio | `FlowStepSchema` solo tiene `after`, `when`, `gate`, `timeoutMs` |
| [0027](SPEC-0027-reiniciar-un-flow-desde-un-paso.md) | Bifurcar o reiniciar una corrida desde un paso | Mastra `restart`/`timeTravel`, LangGraph | Medio | El journal es un registro de eventos; falta el uso |
| [0028](SPEC-0028-journals-en-sqlite-y-postgres.md) | `RunJournal` en SQLite y Postgres | LangGraph checkpointers | Medio | Hay Memory, File, Ndjson, Redis |
| [0021](SPEC-0021-evaluaciones-de-agentes.md) | Evals: casos, graders, repeticiones, comparación | Mastra evals/datasets | Medio | **Ya en borrador** |
| [0029](SPEC-0029-adaptador-de-providers-del-ai-sdk.md) | Adaptador de `LanguageModel` del AI SDK de Vercel a `LLMProvider` | Vercel | Bajo | Solo OpenAI-compatible y Anthropic |
| [0030](SPEC-0030-busqueda-de-tools.md) | Búsqueda de tools con carga diferida | Vercel `toolSearch` | Bajo | El engine envía todas las tools permitidas en cada llamada |
| [0031](SPEC-0031-consola-de-desarrollo-local.md) | Consola local: chat, tool calls, aprobaciones, journal, lecciones | Mastra playground, LangGraph Studio | Medio-alto | `agent-web` y `agent-web-ui` existen, sin consumidores |
| [0032](SPEC-0032-memoria-de-trabajo.md) | Memoria de trabajo (evaluar, no construir aún) | Mastra working/observational memory | Bajo (evaluar) | Memoria episódica, semántica y procedural ya existen |
| [0033](SPEC-0033-rag-generico.md) | RAG genérico: contratos, embeddings, reranking, stores | Mastra rag/vector, Vercel embeddings/reranking | Medio | Diseño en SPEC-0017 F5 |
| [0034](SPEC-0034-agente-durable.md) | Bucle del agente reanudable | Vercel `WorkflowAgent`, OpenAI `RunState` | Alto | Aprobaciones durables sí; el turno corre en memoria |
| [0035](SPEC-0035-code-mode.md) | Code mode: el modelo escribe código que llama tools en un sandbox | Vercel `code-mode` | Alto, riesgo alto | Hay `agent-sandbox` |
| [0036](SPEC-0036-handoff.md) | Traspaso de control entre agentes | OpenAI `handoff` | Bajo-medio | Hay delegación y `engine.switchAgent` |
| [0037](SPEC-0037-codemods-y-guias-de-migracion.md) | Codemods y guías de migración | Vercel y Mastra `codemod` | Bajo | El CHANGELOG avisa de las rupturas; no hay migración automática |

## 4. Orden de ejecución

**Ola A: baratas y útiles ya.** 0029 (providers), 0028 (journals SQL), 0030 (búsqueda de tools), 0037 (codemods). Son independientes entre sí; se pueden hacer en cualquier orden y en paralelo.

**Ola B: lo más visible frente a la competencia.** 0026 y 0027 (flows), 0021 (evals), 0031 (consola). 0027 depende de que los flows y el journal ya soporten lo que 0026 añada, y la fase de flows de 0031 depende de 0027.

**Ola C: ampliar.** 0033 (RAG, con SPEC-0017 F5) y 0032 (memoria de trabajo, que empieza con un experimento).

**Ola D: decidir antes de construir.** 0034, 0035 y 0036 tienen riesgo alto o poca demanda real. Cada una trae un criterio de entrada: no se empieza hasta que un caso real lo pida.

## 5. Cómo retomar en otra sesión

1. Leer esta spec y la que toca. Las specs traen "de dónde se parte" con rutas de archivo; **la fase F0 de cada una vuelve a comprobarlas contra el código**, porque pueden haber cambiado.
2. Rama nueva desde `master`. Un PR por fase, con la prueba de aceptación de esa fase.
3. Reglas del repo que se aplican siempre: guardrail `check-resilience`, barrido de rangos 0.x en cada bump, tags `<corto>@<versión>` después de que el usuario publique en npm, y `git commit -- <rutas>` explícito porque el árbol suele traer trabajo del usuario ya preparado. Los archivos `STEWARD*.md` no se commitean.
4. Una mejora que necesite una capacidad nueva del framework se pone en el framework, no como atajo en un ejemplo.
5. Al cerrar una fase: actualizar el estado en esta tabla y en `docs/specs/README.md`, y la página correspondiente de la web (`site/`), que ya describe flows, tools y MCP.

## 6. Lo que ya tenemos y la comparación no mostró

Anotado con reserva, porque no se buscó en los repos de ellos: aprendizaje con aprobación humana (`createLearning`: un agente no aprueba lo que aprendió), gobernanza con cadena de delegación y auditoría encadenada (`HashChainAuditSink`), servidor de tools directas con `authorize` y `policy`, y las suites sin clave de API (`agent-testkit`). Ellos tienen aprobaciones y guardrails; la diferencia es de rigor, no de existencia.
