# SPEC-0031: consola de desarrollo local

**Fecha:** 2026-11-17
**Estado:** Borrador. Decisiones D1-D6 con propuesta; sin implementar.
**Origen:** [SPEC-0025](SPEC-0025-mejoras-tras-comparar-con-otros-frameworks.md). Mastra incluye un `playground` (con `playground-ui` y un `cli` que lo arranca) y LangGraph tiene Studio; sirven para probar un agente, ver sus llamadas y revisar sus ejecuciones sin escribir código.
**Depende de:** `agent-web` y `agent-web-ui` (existen). Algunas fases dependen de [SPEC-0027](SPEC-0027-reiniciar-un-flow-desde-un-paso.md) y de [SPEC-0026](SPEC-0026-control-de-flujo-en-flows.md).
**Tipo de cambio:** aditivo; un paquete o una orden nueva, sin tocar core.
**Objetivo:** que quien desarrolla un agente con el framework pueda, con una sola orden local, **conversar con él, ver cada llamada de tool y su decisión de política, resolver aprobaciones pendientes, seguir un flow en su journal y revisar lecciones propuestas**, sin construir una interfaz propia.

## 1. De dónde se parte

Verificado el 2026-11-17:

- `agent-web` (`packages/web/src`): servidor Fastify con sesiones por WebSocket (`SessionManager`), autenticación JWT, métricas Prometheus, `MonitorBus` (eventos en tiempo real), `TriggerBus` (cron, webhooks) y un almacén de metadatos de sesión.
- `agent-web-ui` (`packages/web-ui/src`): React con un chat (`components/chat`), un tablero kanban (`templates/kanban`, `useKanbanMonitor`) y el hook `useAgentSession`.
- El inventario de uso del 2026-11-14 (nota del vault) da a `agent-web` como sin consumidor real fuera de los ejemplos, y a `agent-web-ui` sin ninguno. La consola le daría un uso propio.
- Lo que una consola leería ya existe como API pública: `ApprovalStore.list`/`resolve` (aprobaciones), `RunJournal.list`/`get` (flows), `createLearning(...).proposals()`/`approve` (lecciones), `RunResult.toolCalls` y los eventos del transporte (llamadas de tools).
- No hay una orden única para arrancarlo: cada proyecto monta `AgentServer` a mano. `create-bk-agent` tiene un solo binario, el scaffolder.

## 2. Evidencia en la competencia

Mastra (commit `35745537`): `packages/playground` y `packages/playground-ui`, `packages/cli` (la orden `mastra dev`) y `agent-controller`. LangGraph.js (commit `7257a24`): `libs/langgraph-cli`, `libs/langgraph-ui` y los SDK de cliente para React, Vue, Svelte y Angular. En ambos, la consola lee el mismo almacén que usa la aplicación; no es otro sistema.

## 3. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Dónde vive? | **Un paquete nuevo, `@backendkit-labs/agent-devtools`**, con una orden `bk-dev` y la interfaz ya construida, que reutiliza `agent-web` y componentes de `agent-web-ui`. Core no cambia. |
| D2 | ¿Cómo se conecta a un proyecto? | Un archivo `bk-dev.config.ts` que exporta lo que la consola necesita: la fábrica del engine, la carpeta de aprobaciones, el journal, la carpeta de aprendizaje. Sin él, solo el chat. |
| D3 | ¿Quién es "la persona" que aprueba? | **El usuario local, como `human`**, y se dice en pantalla. La consola **solo escucha en loopback** y exige un token, porque puede aprobar acciones. Una consola abierta a la red sería un hueco: se rechaza el arranque. |
| D4 | ¿Es solo lectura al principio? | **Sí.** Las fases F1 y F2 solo observan; aprobar y reanudar llegan después, con la misma identidad y las mismas comprobaciones que cualquier aprobador (no se aprueba lo propio). |
| D5 | ¿De dónde salen las llamadas de tools? | Del flujo de eventos del transporte y de `RunResult`, no de logs. La consola muestra por llamada: tool, argumentos (con su `redact`), decisión de política y razón, aprobador, resultado y tiempo. |
| D6 | ¿Reemplaza a la observabilidad de producción? | **No.** Es para desarrollo; la producción sigue con OpenTelemetry (`agent-otel`) y el audit. La consola no guarda nada que el proyecto no guardara ya. |

## 4. Paneles

| Panel | Contenido | Fuente |
|---|---|---|
| Chat | Conversar con cualquier agente del engine; cambiar de agente; ver el streaming | `agent-web` (WebSocket) |
| Llamadas | Línea de tiempo de tools y delegaciones, con la decisión de la política | Eventos del transporte |
| Aprobaciones | Cola de pendientes; aprobar o rechazar (F2) | `ApprovalStore` |
| Flows | Corridas, pasos, salidas y transiciones; reanudar y bifurcar (F3) | `RunJournal` |
| Lecciones | Propuestas con su razón; aprobar, retirar (F4) | `createLearning` |
| Coste | Tokens y coste por ejecución y acumulado | Eventos de coste y `costTracker` |

## 5. Fases

- **F0. Inventario.** Arrancar `agent-web` y `agent-web-ui` en un ejemplo, anotar qué paneles ya funcionan y cuáles no, y fijar el criterio de salida de las demás fases. Comprobar si `agent-web-ui` compila hoy y quién lo mantiene.
- **F1. Orden `bk-dev`, chat y línea de tiempo de llamadas (solo lectura).** Prueba de aceptación: un proyecto de `create-bk-agent` arranca con `npm run dev` y muestra una conversación con su `tool_calls` y la decisión de política de cada una.
- **F2. Aprobaciones.** Prueba: una tool `destructive` queda pendiente, se aprueba desde la consola y corre una sola vez; un agente no puede aprobar lo propio.
- **F3. Flows.** Listar y abrir corridas (journal); reanudar. Con SPEC-0027: bifurcar desde un paso. Prueba: una corrida con una aprobación pendiente se ve, se aprueba y termina.
- **F4. Lecciones.** Aprobar o retirar propuestas, con la identidad humana de D3.
- **F5. Integración.** Plantilla de `create-bk-agent` con `dev` y una página en la web ("la consola de desarrollo").

## 6. Criterios de aceptación

- La consola no puede arrancar abierta a la red sin token.
- Todo lo que muestra o hace pasa por las mismas funciones públicas que usaría un programa (`ApprovalStore`, `RunJournal`, `createLearning`); no hay una vía lateral.
- Quitar el paquete no cambia el comportamiento de ningún agente.

## 7. Riesgos y fuera de alcance

- Mantener una interfaz es un coste continuo. F0 existe para decidir si merece la pena antes de construir; si `agent-web-ui` no se sostiene, la alternativa es una interfaz mínima de solo lectura servida por el propio paquete.
- Fuera de alcance: editar prompts o perfiles desde la interfaz, evaluaciones desde la consola (es [SPEC-0021](SPEC-0021-evaluaciones-de-agentes.md)) y despliegue.
