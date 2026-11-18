# SPEC-0039: observabilidad de operaciones (coste atribuido, autoridad y replay de un incidente)

**Fecha:** 2026-11-18
**Estado:** Borrador. **F0 y F1 hechas (2026-11-18)**, ver §7. F2 a F5 sin hacer y con criterio de entrada (§3).
**Origen:** la identidad del framework como producto para agentes de empresa (2026-11-18). Cuando algo sale mal, una empresa pregunta tres cosas: **quién gastó qué**, **con qué autoridad se hizo esa acción** y **qué pasó exactamente**. Hoy el framework registra mucho, pero no deja contestarlas de punta a punta.
**Depende de:** `ObservabilityManager` y `CostTracker` (`packages/core/src/observability`), `AuditEvent` (`governance/types.ts`), los journals de flujos y `agent-testkit` (`RecordingProvider`, `ReplayProvider`).
**Tipo de cambio:** aditivo (campos opcionales y consultas de solo lectura). Sin paquete nuevo.
**Objetivo:** ir de un incidente (una acción mala, un gasto anómalo, una aprobación denegada) a su ejecución completa, con su coste y su autoridad, sin efectos secundarios.

## 1. De dónde se parte

Verificado en `packages/core/src` el 2026-11-18:

- **Coste:** `MetricsSnapshot` agrega tokens y `estimatedCostUsd` **totales**; el mapa por agente solo cuenta invocaciones y duración, **no coste**. Los presupuestos son `perRun` y `perDay` (`BudgetUsage`), globales al engine. Un flujo sí informa su coste (`FlowResult.costUsd`, en el journal). No hay "coste por agente, por tenant ni por tool".
- **Autoridad:** cada `AuditEvent` lleva el `principal` (agente, sesión, cadena de delegación, tenant, usuario), la decisión y **quién aprobó** (`approval.by`). La cadena de hashes (`HashChainAuditSink`) lo hace evidente ante manipulación.
- **Correlación:** `AuditEvent` **no lleva** `runId` ni `traceId`, y los `Span` tienen su `traceId` propio. Dado un evento de auditoría, no se llega a la corrida de flujo ni a los spans de esa ejecución (salvo por la hora y la sesión).
- **Replay:** `agent-testkit` graba y reproduce las **llamadas al modelo** (`RecordingProvider`, `ReplayProvider`), pero es una herramienta de pruebas: no está pensada para grabar en producción (contiene el contenido de los mensajes). Un flujo reanudado se salta los pasos ya hechos gracias al journal.
- No hay una consulta que junte, para una corrida, **su journal, su auditoría, sus spans y su coste**.

## 2. Decisiones

| # | Pregunta | Propuesta |
|---|---|---|
| D1 | ¿Cómo se unen las piezas? | Un **identificador de corrida** (`runId`, y el `traceId` del span) en `AuditEvent`, en las etiquetas de los `Span` y en las métricas de coste. Es la base de todo lo demás. |
| D2 | ¿Qué granularidad de coste? | Coste **atribuido** por agente, por tenant, por flujo y por paso (donde hay `costUsd`), no solo el total. Los límites ejecutables por agente o flujo se estudian aparte. |
| D3 | ¿Qué se entrega para investigar? | Un **paquete de incidente de solo lectura**: para un `runId`, los eventos del journal, los de auditoría, los spans y el coste, con redacción de contenido sensible. No contiene los mensajes del modelo salvo que se pida. |
| D4 | ¿Cómo se "repite" sin efectos? | Un **replay en seco** de un flujo: los pasos con salida registrada se sirven del journal y los que no la tienen **se marcan, no se ejecutan**. No se repiten llamadas al modelo ni tools. |
| D5 | ¿Se graba el modelo en producción? | **No por defecto.** Es opt-in y con redacción: el contenido de los mensajes es dato del cliente. |

## 3. Criterio de entrada

- **F1 (correlación) no tiene condición:** es un campo opcional, barato, y sin él nada de lo demás es posible.
- **F2 a F4 se empiezan cuando** una persona que opera agentes reales pida contestar esas preguntas (un incidente que costó más de lo debido investigarlo, o una auditoría que pidió esa trazabilidad). Sin un caso, el paquete de incidente y el replay serían infraestructura sin usuario.

## 4. Fases

- **F0. Verificar.** Qué datos de `AuditEvent`, `Span` y journal comparten hoy (sesión, hora) y si un `runId` es alcanzable desde el engine en cada punto de escritura. Qué contiene el journal de un flujo con humano en medio.
- **F1. Correlación (D1).** `runId` y `traceId` opcionales en `AuditEvent` y en las etiquetas de los spans. Pruebas: de un evento de auditoría se llega a su corrida y de una corrida a sus eventos.
- **F2. Coste atribuido (D2).** `MetricsSnapshot` (o una vista nueva) con coste por agente, tenant y flujo. Pruebas con dos agentes y dos tenants en un engine.
- **F3. Paquete de incidente (D3).** Una función de solo lectura que junta journal, auditoría, spans y coste de un `runId`, con redacción.
- **F4. Replay en seco de un flujo (D4).** Sobre el journal, sin ejecutar nada. Pruebas: un flujo con un paso cuya salida falta queda marcado, no ejecutado.
- **F5. Documentación** en la web (observabilidad y coste) y una guía "investigar un incidente".

## 5. Criterios de aceptación

- Los campos nuevos son **opcionales**: nada que ya funcione cambia.
- El paquete de incidente y el replay **no escriben** en journals ni almacenes y **no llaman** al modelo ni a las tools.
- Lo que sale del sistema pasa por la redacción: el paquete no contiene el contenido de los mensajes si no se pide.
- Un flujo con un paso sin salida registrada nunca se "completa" en el replay: queda marcado.

## 6. Riesgos y fuera de alcance

- **Datos del cliente.** Un paquete de incidente completo puede contener datos sensibles. Por eso D5 y la redacción por defecto.
- **El replay no es exacto** si el flujo dependía del tiempo o de un servicio externo: sirve para diagnosticar, no para reproducir el efecto.
- **Fuera de alcance:** presupuestos ejecutables por equipo, enrutamiento de modelo por criticidad y caché semántica (son otra decisión); versionado y canary de agentes (es de la plataforma de flota, no del SDK); un panel visual.

## 7. F0 y F1 hechas (2026-11-18)

**F0, lo verificado.** `engine.run()` no tenía identificador; `AuditEvent` no llevaba `runId` ni `traceId`; el `traceId` solo existe si hay tracing, y lo crea el `Tracer` al abrir el span raíz en el evento `ready` (que el motor emite en cada corrida). Los spans se crean a partir de eventos en el `ObservabilityManager`, que no sabía de qué corrida eran. Un flujo tiene su propio `runId` (de `runFlow`), sin relación con las corridas del motor.

**F1, lo hecho.**
- `engine.run(input, { runId? })`: cada corrida tiene un `runId` (el que se pase, o un UUID). Sale en `RunResult.runId`.
- `AuditEvent.runId` opcional, el de la corrida en curso. Una tool llamada fuera de una corrida no lo lleva. Entra en la cadena de hashes como cualquier otro campo (se prueba que la cadena verifica y que cambiarlo la rompe).
- El evento `ready` lleva `run_id`, y el `ObservabilityManager` pone la etiqueta `run_id` en el span raíz, en los de agente, en los de tool y en los de llamada al modelo.
- Un delegado pertenece a la corrida del agente que preguntó: un id para todo el turno.
- Para unir con un flujo, quien ejecuta un paso con un agente pasa el `runId` del flujo: `engine.run(input, { runId: flowRunId })`.
- 6 pruebas (`AgentEngine.runId.test`); 585 pruebas de motor, observabilidad, gobierno y flujos pasan.

**Diferencias con §2 D1:** (a) **no se añadió `traceId` al `AuditEvent`**: el motor no conoce el `Tracer` (vive en el `ObservabilityManager`, detrás del transporte), y el `runId` ya une las dos cosas: de un evento de auditoría se llega a los spans filtrando por la etiqueta `run_id`, que llevan su `traceId`. (b) El id de una corrida de flujo y el de las corridas del motor **siguen siendo dos cosas**; se unen si el integrador pasa el del flujo. El motor de flujos no lo hace solo.

**Sin comprobar:** el flujo completo con un `AgentStepExecutor` real que pase el `runId` del flujo; las métricas de coste (F2) aún no llevan el `runId`. Sin publicar.
