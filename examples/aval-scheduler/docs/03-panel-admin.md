← [Índice](./README.md)

# 03 · Panel admin

`ADMIN_TOKEN` (ver [04 · Variables de entorno](./04-variables-de-entorno.md)) levanta un
servidor Express (`src/admin-server.ts`) en el mismo proceso que el agente, puerto `ADMIN_PORT`
(3200 por defecto). Apagado por defecto: sin `ADMIN_TOKEN`, `index.ts` no lo levanta — ningún
puerto nuevo queda escuchando sin autenticación configurada.

## Por qué vive en el mismo proceso que el agente

Dos razones, no comodidad:

1. `PaymentsSourceStore` lee/escribe el JSON en cada llamada (ver
   [01 · Arquitectura](./01-arquitectura.md#por-qué-el-store-lee-y-escribe-del-disco-en-cada-llamada)) —
   así que el panel puede vivir en cualquier proceso que apunte al mismo archivo y ver siempre
   el mismo estado que el subproceso MCP, sin coordinación extra.
2. El botón "Correr ahora" necesita `agent.emit(...)`, que sólo existe en la instancia de
   `AutonomousAgent` que `index.ts` crea — no hay forma de invocarlo desde otro proceso sin
   construir un canal de comunicación aparte.

## Autenticación

Un solo token para todo el panel — sin usuarios ni roles. Cada ruta de la API exige
`Authorization: Bearer <ADMIN_TOKEN>`; la comparación es de duración constante
(`timingSafeEqual`, mismo patrón que usa AVAL para sus propias credenciales). La página (`GET /`)
pide el token una vez con `prompt()` del navegador y lo guarda en `localStorage`.

Pensado para un operador con acceso a la máquina donde corre el agente — no para exponerlo en
internet como producto multiusuario. Ver [05 · Limitaciones](./05-limitaciones.md).

## Rutas

| Ruta | Qué hace | Cuerpo | Respuesta |
|---|---|---|---|
| `GET /` | Sirve el panel (HTML + JS, sin build step) | — | `text/html` |
| `GET /api/schedule` | Calendario completo | — | `{ schedule: ScheduledPayment[] }` |
| `POST /api/schedule` | Da de alta un pago programado | `{ id, counterparty, ceilingUsd, purpose, dayOfMonth }` | `201` `{ payment }` |
| `PUT /api/schedule/:id` | Modifica campos de un pago existente (parcial) | `Partial<PaymentInput>` | `200` `{ payment }` |
| `DELETE /api/schedule/:id` | Da de baja un pago programado | — | `204` |
| `GET /api/history` | Todos los `outcomes`, más reciente primero, con `stuck` calculado | — | `{ outcomes, stuckThreshold }` |
| `POST /api/schedule/:id/reactivate` | Resetea las denegaciones seguidas de la ocurrencia del mes actual | — | `{ ok: true }` |
| `POST /api/run-now` | Dispara una corrida (vía `agent.emit`) | — | `202` `{ ok: true, note }` |

Errores: `400` con `{ error }` ante datos inválidos (`PaymentValidationError` de `store.ts`),
`404` con `{ error }` si el `id` no existe, `401` sin token o con uno que no coincide.

## `DELETE` no borra el historial

Dar de baja un pago (`removePayment`) lo saca de `schedule`, pero sus `outcomes` (lo que ya se
intentó o pagó) quedan intactos — es historia pasada, no algo que desaparezca porque el pago
dejó de programarse. `GET /api/history` los sigue mostrando después de la baja.

## Pagos atascados

`GET /api/history` marca `stuck: true` en cualquier `outcome` que ya lleve `stuckThreshold`
denegaciones seguidas — ver
[02 · Herramientas](./02-herramientas.md#por-qué-un-pago-puede-quedar-atascado-y-qué-hace-el-agente-con-eso).
El panel los resalta y ofrece "reactivar" en esa fila, que llama a
`POST /api/schedule/:id/reactivate` con el `id` del pago programado (no el `occurrenceId` —
`store.reactivate()` recalcula la ocurrencia del mes actual). Si la causa real no se resolvió,
la próxima corrida lo vuelve a denegar y a sumar hacia el umbral otra vez; reactivar no es "decir
que ya está arreglado", es sólo "dale otra oportunidad".

## "Correr ahora" no salta la cola

`POST /api/run-now` emite el mismo evento que dispararía cualquier otro trigger — pasa por el
`busy` gate de `TriggerManager` (ver
[01 · Arquitectura](./01-arquitectura.md#tres-disparadores-un-solo-camino)). Si el agente ya está
procesando una corrida, el clic se descarta con un aviso en el log del proceso, igual que pasaría
con el cron o el webhook. La respuesta `202` confirma que se emitió el evento, no que la corrida
efectivamente arrancó.

---
← [02 · Herramientas](./02-herramientas.md) · → [04 · Variables de entorno](./04-variables-de-entorno.md)
