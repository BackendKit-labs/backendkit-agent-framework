# SPEC-0007: agent-testkit y agent-autonomy

**Fecha:** 2026-10-22
**Estado:** Borrador
**Inspiración:** `test-support/llm-replay`, `llm-mock-server`, `session-snapshot`, `goal/*`, `schedule/*`, `webhook/*`, `jobs/*` de deepseek-harness (diseño, no código).

## Parte A — agent-testkit

### A.1 Problema verificado
Los helpers de prueba viven en `core/src/__tests__/helpers.ts` (transport mock, provider de texto, provider con guion) y no se publican. No hay forma de grabar una conversación real y reproducirla, ni de probar fallos de red y de proveedor sin un servidor real. Cada paquete reinventa sus dobles.

### A.2 Objetivos
1. Probar agentes **sin API key** con comportamiento realista.
2. Reproducir fallos del proveedor de forma determinista (429, 5xx, reset, corte a mitad de stream, chunks corruptos, desbordamiento de contexto).
3. Grabar una ejecución real y usarla como fixture.
4. Aserciones que verifican **el mundo** (archivos, procesos), no el autoinforme del agente.

### A.3 Contenido (`packages/testkit` → `@backendkit-labs/agent-testkit`, devDependency)
| Pieza | Descripción |
|---|---|
| `scriptedProvider(turns)` | el actual `createScriptedProvider`, publicado y con `onMetrics` opcional |
| `RecordingProvider(inner, sink)` | envuelve un provider real y guarda cada llamada (mensajes, herramientas, chunks, métricas, errores, tiempos) en JSONL |
| `ReplayProvider(file, { overrides })` | reproduce las llamadas grabadas en orden; un *sidecar* `replay.override.json` inyecta fallos antes del primer chunk, cancelaciones y cuelgues |
| `startMockLlmServer(script)` | endpoint HTTP/SSE compatible con OpenAI/Anthropic: por petición consume un comportamiento (completar, tool call, 429, 5xx, reset, stall, JSON corrupto, desbordamiento de contexto); modo aleatorio con semilla; devuelve las peticiones capturadas |
| `mockTransport()` | transport que acumula eventos con ayudas de consulta (`eventsOf('tool_result')`) |
| `world` | aserciones sobre el sistema real: `fileEquals`, `untouched(paths)`, `processGone(pid)` |
| `fakeClock` | reloj y temporizadores controlables para plazos y TTL |

### A.4 Aceptación
- Los tests de `AgentEngine` existentes migran a `agent-testkit` sin cambiar sus aserciones.
- Un test de integración graba una ejecución con el `mock server`, la reproduce con `ReplayProvider` y obtiene el mismo historial final.
- Cobertura de los fallos del §A.2 sobre `providers` (reintentos, abort) y sobre el reintento por desbordamiento (SPEC-0002 §3).
- Documentado en un README con "cómo probar un agente" y una plantilla en `create-bk-agent`.

## Parte B — agent-autonomy

### B.1 Problema verificado
`TriggerManager` (cron/webhook/evento) y `TriggerBus` (agent-web) se configuran al arrancar y viven en memoria: lo que el agente quiera programar en tiempo de ejecución se pierde, no hay objetivos que persistan entre turnos ni trabajos en segundo plano con dueño (esto último se cubre en SPEC-0002 §5).

### B.2 Objetivos
1. **Recordatorios durables** creados por el agente o el usuario: única vez, intervalo fijo, diario, semanal y cron; sobreviven al reinicio; de una recurrencia perdida cuenta solo su última ocurrencia; se entregan como mensaje de seguimiento en la **sesión original**.
2. **Goals:** un objetivo que persiste entre turnos, resume y reinicios; estados `active|paused|blocked|completed`; actualización por *compare-and-set*; un conductor de rondas continúa mientras el agente esté inactivo, con tope (256 por defecto) y bloqueo registrado al agotarse.
3. **Webhook → sesión:** una regla de confianza convierte un evento externo en una sesión nueva en un workspace; adaptadores firmados (GitHub primero); autenticación en el adaptador.
4. Herramientas del modelo: `schedule_create|list|update|delete`, `goal_get|set|update|complete|block`.

### B.3 Diseño
- `ScheduleStore` (interfaz; archivo JSON/SQLite) + `Scheduler` con un único temporizador al siguiente vencimiento; al arrancar recorre los vencidos y entrega.
- `GoalService` (estado en el log de sesión de SPEC-0004 como eventos `goal/*` y proyección `goal`) + `GoalRoundDriver` (se engancha a `agent/idle`).
- `WebhookRuntime.register(rule)` / `dispatch(delivery)`; reglas con filtro, plantilla de prompt y workspace destino.
- Entrega a una sesión inactiva: la reabre (SPEC-0004) y encola el mensaje.

### B.4 Dependencias
Recordatorios y webhooks se pueden entregar antes de SPEC-0004 creando una sesión nueva o inyectando en el engine vivo; **goals y entrega a la sesión original requieren SPEC-0004**.

### B.5 Aceptación
- Reinicio entre la creación y el vencimiento: el recordatorio se entrega una vez.
- Cinco ocurrencias perdidas de un diario → una entrega.
- Goal con tope de 3 rondas termina en `blocked` con causa; `paused` impide el conductor; CAS rechaza vistas obsoletas.
- Webhook de GitHub con firma inválida → 401 sin crear sesión; válida → sesión nueva con el prompt de la regla.
- Todo probado con `agent-testkit` y reloj falso.

## Riesgos
- Reloj de pared y zonas horarias (se guarda la zona IANA de cada tarea).
- Bucles de rondas costosos: el tope y `abortOnBudget` los acotan; el bloqueo es visible en el evento.
- Webhooks como superficie de ataque: lista de reglas explícita, límite de tamaño y de tasa, sin acciones distintas de "crear sesión".
