← [Índice](./README.md)

# 02 · Herramientas del agente

Siete herramientas en total, de dos orígenes distintos. `profile.ts` las declara todas en
`allowedTools` — el LLM sólo ve las que están ahí, nunca el catálogo completo del framework.

## De `@backendkit-labs/aval-tools` (paquete de npm, habla con AVAL por HTTP)

### `pay`

Pide un gasto a AVAL (`POST /api/v1/spend`). AVAL decide — autorizado, retenido o denegado — y
si autoriza, paga él mismo por el carril que corresponda. El agente nunca tiene una credencial
de proveedor que saltarse.

| Parámetro | Tipo | Notas |
|---|---|---|
| `counterparty` | string | Contraparte registrada en AVAL, p. ej. `"ocr.docs"` |
| `ceilingUsd` | number | Techo del gasto en dólares. El coste real puede ser menor |
| `purpose` | string | Motivo en una frase — queda escrito en el registro de AVAL |
| `idempotencyKey` | string, opcional | Ver [nota crítica](#por-qué-el-idempotencykey-nunca-lo-inventa-el-llm) |

La respuesta incluye el **presupuesto restante** (`remainingToday`/`remainingTotal`) — desde
`aval-tools@0.1.1`. Sin esto, el agente no tenía forma de saber, dentro de la misma corrida, si
le quedaba margen antes de pedir el siguiente pago.

### `check_payment`

Consulta el estado de una autorización propia por `authorizationId`. Es la mitad que le falta a
la vía "retenido": nada bloquea la sesión esperando a un humano, así que un `held` se resuelve
volviendo a preguntar en una invocación posterior.

| Parámetro | Tipo | Notas |
|---|---|---|
| `authorizationId` | string | El que devolvió `pay` |

### `list_own_history`

Consulta `GET /api/v1/history` — el historial propio del agente en AVAL, en texto legible
(seq, fecha, tipo, monto, contraparte, motivo, primer `reason`). Desde `aval-tools@0.1.1`.

| Parámetro | Tipo | Notas |
|---|---|---|
| `limit` | number, opcional | Por defecto 20, máximo 200 |

De sólo lectura, y reservado por el `systemPrompt` para un caso puntual: si a simple vista el
presupuesto no va a alcanzar para todos los pagos debidos de la corrida, el agente la usa para
ver qué se pagó recientemente y decidir un orden con criterio. No se llama en cada corrida.

## De `mcp-payments-source` (servidor MCP propio, en este repositorio)

Namespace `mcp__payments-source__*` — así los expone `MCPClientManager` del framework.

### `list_due_payments`

Pagos programados que vencen hoy o antes y conviene intentar — sin ningún intento todavía, o
cuyo último intento fue denegado (ver [por qué](#por-qué-el-idempotencykey-nunca-lo-inventa-el-llm)).
Cada resultado trae `occurrenceId` (identidad estable de la ocurrencia,
`{paymentId}:{año-mes}`) e `idempotencyKey` (lo que hay que pasarle a `pay`, ya armado).

### `list_pending_confirmations`

Ocurrencias ya intentadas que quedaron en un estado que puede cambiar — retenido o autorizado
sin liquidar. El primer paso de cada corrida: reconciliar esto antes de mirar pagos nuevos.

### `record_payment_outcome`

Registra el resultado de un intento — `occurrenceId`, `authorizationId`, y el `state` que
devolvió `pay` o `check_payment`. Idempotente: registrar el mismo resultado dos veces no
duplica nada (`store.ts` lo deduce del `authorizationId`, no de un contador que el LLM tendría
que llevar bien).

### `list_stuck_payments`

Ocurrencias que ya llevan `STUCK_THRESHOLD` (3) denegaciones seguidas y por eso `list_due_payments`
dejó de ofrecerlas. El `systemPrompt` es explícito: se mencionan en el resumen final, **nunca**
se les llama a `pay` — ver [por qué](#por-qué-un-pago-puede-quedar-atascado-y-qué-hace-el-agente-con-eso).

## Por qué el `idempotencyKey` nunca lo inventa el LLM

`occurrenceId` identifica una ocurrencia **para siempre** (el mismo pago, el mismo mes) — es lo
que se pasa a `record_payment_outcome`. Pero AVAL cachea la decisión de `pay` por
`idempotencyKey` y la repite tal cual ante la misma clave, sin volver a evaluar la política. Si
el `idempotencyKey` fuera igual al `occurrenceId` a secas, un pago denegado por presupuesto
recibiría el mismo "denegado" en cada reintento, aunque alguien haya subido el tope en AVAL un
minuto después.

Por eso `list_due_payments` entrega un campo aparte, `idempotencyKey`
(`{occurrenceId}:{intento}`), distinto en cada intento tras una denegación — `store.ts` lleva la
cuenta del número de intento por `occurrenceId`, deducido del `authorizationId` que devolvió AVAL
la vez anterior (mismo `authorizationId` → la misma decisión resolviéndose; distinto →
una decisión nueva de verdad). El `systemPrompt` en `profile.ts` exige pasar ese campo tal cual,
sin construir uno propio — es la instrucción más "CRÍTICO" marcada en todo el prompt, a
propósito: es el error más fácil de cometer y el más silencioso de no notar.

## Por qué un pago puede quedar "atascado", y qué hace el agente con eso

De los seis motivos por los que AVAL puede denegar un gasto, sólo uno —el tope diario— se
resuelve solo con el paso del tiempo. Los otros cinco (contraparte no registrada, carril no
permitido, contraparte fuera de `allowedVendors`, tope por operación, tope de por vida, agente
suspendido) son estructurales: no importa cuántas veces se reintente, AVAL va a seguir
denegando hasta que un humano cambie algo — en AVAL, o en el calendario de este agente. Sin un
freno, el agente reintentaría un pago mal configurado todos los días, para siempre, gastando una
llamada a `pay` (y los tokens del LLM que la deciden) sin ningún resultado distinto.

`store.ts` no intenta adivinar cuál de los seis motivos aplica —parsear el texto de `reasons`
para clasificarlo sería frágil, y AVAL sólo etiqueta de forma legible **uno** de los cinco casos
estructurales (`meta.failure = "routing"`, ni siquiera expuesto en la respuesta de `/spend`)—.
En cambio, cuenta denegaciones seguidas por `occurrenceId` (`Outcome.consecutiveDenials`, sube
en cada intento nuevo que vuelve a dar "denied", se resetea en cualquier otro resultado). Al
llegar a `STUCK_THRESHOLD` (3), la ocurrencia sale de `list_due_payments` y entra a
`list_stuck_payments` — el agente dejó de insistir, y el resumen final de la corrida lo dice.

Salir de ese estado es un gesto humano explícito, no algo que se resuelva solo con más tiempo:
el botón "reactivar" del [panel admin](./03-panel-admin.md) (o `PaymentsSourceStore.reactivate()`
directamente) resetea el contador. Si la causa real no se arregló, simplemente va a volver a
denegarse y a sumar de nuevo hacia el umbral — no hace falta "saber" que ya se arregló antes de
reactivar.

---
← [01 · Arquitectura](./01-arquitectura.md) · → [03 · Panel admin](./03-panel-admin.md)
