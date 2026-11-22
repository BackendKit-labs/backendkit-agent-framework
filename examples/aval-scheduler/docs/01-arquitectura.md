← [Índice](./README.md)

# 01 · Arquitectura

## El recorrido de una corrida

```
cron (SCHEDULE_CRON), POST /run-now, o el botón "Correr ahora" del panel
  │
  ▼
TriggerManager.emit → engine.run(prompt)      (descarta el disparo si ya hay una corrida en curso)
  │
  ├─ 1. list_pending_confirmations (MCP payments-source)
  │       → check_payment (aval-tools) por cada uno
  │       → record_payment_outcome (MCP payments-source)
  │
  ├─ 2. list_due_payments (MCP payments-source)
  │       → si el presupuesto no va a alcanzar: list_own_history (aval-tools) para priorizar
  │       → pay (aval-tools) por cada uno, idempotencyKey = el que trae el resultado
  │       → record_payment_outcome (MCP payments-source)
  │
  └─ 3. resume en texto lo que pasó esta corrida
```

El LLM (DeepSeek, vía `@backendkit-labs/agent-providers`) es quien decide el orden y llama a cada
herramienta — `index.ts` no orquesta los pasos a mano, sólo arma el prompt del sistema
(`profile.ts`) y registra las herramientas disponibles. El "orden exacto" del punto 1-2-3 es una
instrucción en el `systemPrompt`, no código.

## Tres procesos, dos de vida corta

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  proceso principal (index.ts)│        │  subproceso MCP               │
│  · AgentEngine (DeepSeek)    │  stdio │  payments-source/server.ts    │
│  · TriggerManager            │◄──────►│  · list_due_payments           │
│    (cron / webhook / event)  │        │  · list_pending_confirmations  │
│  · panel admin (Express,     │        │  · record_payment_outcome      │
│    opcional)                 │        └──────────────┬─────────────────┘
└──────────────┬────────────────┘                       │
               │ HTTP (pay / check_payment /             │ lee/escribe
               │ list_own_history)                       ▼
               ▼                              schedule.json (PaymentsSourceStore)
            AVAL (servidor aparte,                        ▲
            otro proceso, otro repo)                      │ lee/escribe
                                              panel admin (mismo proceso
                                              que index.ts, store propio)
```

- **El proceso principal** vive indefinidamente (`agent.start()` no vuelve hasta `SIGINT`/
  `SIGTERM`). Corre el motor del agente, el gestor de triggers, y — si `ADMIN_TOKEN` está
  definido — el servidor del panel admin.
- **El subproceso MCP** (`mcp-payments-source/server.ts`) lo levanta el framework por stdio
  (`mcpServers` en `createAutonomousAgent`), un proceso `node` aparte. Es el origen de pagos
  programados — hoy un JSON local, pensado para sustituirse (ver más abajo).
- **AVAL** es un tercer proceso, en otro repositorio (`../internet`), alcanzado sólo por HTTP.
  Este proyecto nunca importa código de AVAL — sólo habla su API a través de
  `@backendkit-labs/aval-tools`.

## Por qué el store lee y escribe del disco en cada llamada

`PaymentsSourceStore` (`src/mcp-payments-source/store.ts`) no cachea nada en memoria entre
llamadas — cada método hace su propio `read()` (parsear el JSON del disco) y, si escribe, su
propio `write()` atómico (`tmp` + `rename`). Es una decisión deliberada, no una omisión: el
subproceso MCP y el panel admin son **dos procesos distintos** que instancian cada uno su propio
`PaymentsSourceStore` contra el mismo archivo. Si cualquiera de los dos cacheara el contenido en
un campo de instancia, un alta hecha desde el panel no se vería desde el MCP (o viceversa) hasta
que ese proceso reiniciara. El archivo en disco es la única fuente de verdad compartida entre
ambos — sin eso, ninguna otra forma de sincronizar los dos procesos sale gratis.

El costo es un `readFileSync`/`writeFileSync` de más por llamada, irrelevante frente al volumen
real (una corrida diaria, algún clic ocasional en el panel). Lo que **no** resuelve: dos
escrituras que caigan en el mismo instante desde procesos distintos pueden pisarse — no hay
locking entre procesos, sólo escritura atómica dentro de cada una. Ver
[05 · Limitaciones](./05-limitaciones.md).

## Tres disparadores, un solo camino

`TriggerManager` (parte de `@backendkit-labs/agent-core`) serializa los tres — si el agente está
ocupado con una corrida, descarta el disparo entrante con un aviso, nunca lo encola:

| Disparador | Tipo | Activo cuando | Para qué |
|---|---|---|---|
| Cron | `schedule` | Siempre | El ritmo normal — diario a las 9:00 por defecto |
| Webhook | `webhook`, `POST /run-now` | `SCHEDULER_WEBHOOK_SECRET` definido | Disparar desde otro sistema (firma HMAC-SHA256) |
| Evento | `event`, tópico `scheduler.run-now` | `ADMIN_TOKEN` definido | El botón "Correr ahora" del panel admin |

El botón del panel no llama al motor directamente — llama a `agent.emit(topic, data, source)`,
que dispara el `EventBus` compartido; el trigger `event` registrado en `index.ts` es quien
realmente invoca `engine.run(...)`. Pasar por ahí (en vez de un atajo directo) es lo que le da
al clic del panel el mismo gate de concurrencia que ya protege al cron y al webhook.

## Qué decide el LLM y qué no

El LLM decide: en qué orden procesar los pagos debidos, cuándo consultar `list_own_history`
antes de decidir, y qué reportar en el resumen final. El LLM **no** decide: qué cuenta como
"debido" (`listDue()`, en `store.ts`, es código determinista), si un pago se autoriza
(eso lo decide AVAL, no el agente — ver el `systemPrompt` en `profile.ts`: *"AVAL ya decidió; tu
trabajo es ejecutar y reportar, no insistir"*), ni si un `held` se aprueba (eso es exclusivamente
humano, en la consola de AVAL — ningún camino de este proyecto lo permite).

---
← [Índice](./README.md) · → [02 · Herramientas](./02-herramientas.md)
