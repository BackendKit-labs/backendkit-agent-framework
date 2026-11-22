# aval-scheduler-agent

**Un agente autónomo que lee pagos programados y los ejecuta a través de [AVAL](../internet) —
presupuesto previo, decisión antes del gasto, registro encadenado.**

Vive en `examples/aval-scheduler` del monorepo de `@backendkit-labs/agent-framework`, pero se
comporta como cualquier consumidor externo: instala el framework y `aval-tools` **desde npm** (no hay
referencias de workspace), con `npm install` dentro de esta carpeta. Se escribió contra `agent-core`
0.24 y se adaptó a las versiones actuales (`agent-core` 0.48, `agent-providers` 0.3, `aval-tools` 0.1.25,
zod 4).

## El problema

Un pago programado es fácil de automatizar mal: o el script paga sin preguntar (y un bug lo
ejecuta de más), o alguien tiene que aprobar cada mes a mano (y entonces no automatizó nada). Este
proyecto delega la decisión donde corresponde — AVAL evalúa presupuesto y política **antes** de
que salga el dinero — y le da al agente lo que le faltaba para ser más que un cron mudo:
contexto para priorizar cuando el presupuesto no alcanza, reintento correcto cuando algo se
resuelve entre corridas (sin insistir para siempre con algo que nunca se va a resolver solo),
y una forma de dispararlo sin esperar al reloj.

> **Documentación técnica:** [`docs/`](./docs/README.md) — arquitectura, referencia de
> herramientas, el panel admin, variables de entorno y limitaciones conocidas.

## Cómo funciona

```
cron (diario, 9:00), POST /run-now, o el botón "Correr ahora" del panel → engine.run(prompt)
  1. list_pending_confirmations → check_payment por cada uno → record_payment_outcome
  2. list_due_payments → si el presupuesto no va a alcanzar, list_own_history para priorizar
                        → pay por cada uno (idempotencyKey = el que trae el resultado)
                        → record_payment_outcome
  3. resume en texto lo que pasó esta corrida
```

El agente no guarda su propia memoria de qué pagó: AVAL es la única fuente de verdad sobre el
dinero, y el origen de pagos programados (`src/mcp-payments-source/`, un JSON local sustituible —
Postgres, Airtable, el ERP de la empresa es reescribir un archivo) es la única fuente de verdad
sobre qué está programado. El agente sólo conecta ambos, en cada corrida, sin estado propio entre
una corrida y la siguiente.

Detalle completo del recorrido, los tres procesos involucrados, y las siete herramientas que ve
el LLM: [01 · Arquitectura](./docs/01-arquitectura.md) y [02 · Herramientas](./docs/02-herramientas.md).

## Instalación

```bash
npm install
cp .env.example .env   # completar AVAL_URL, AVAL_KEY, DEEPSEEK_API_KEY
npm run build
npm start
```

`AVAL_KEY` es la credencial del **agente** en AVAL (la que devuelve `POST /api/v1/agents` o
`/agents/{id}/keys`) — nunca el token de consola. Referencia completa de variables:
[04 · Variables de entorno](./docs/04-variables-de-entorno.md).

## Pruebas

```bash
npm test
```

`npm test` compila primero (`pretest`) y corre dos suites:

- **35 casos sobre `store.ts`**: vencimiento por día del mes, reintento correcto tras una denegación
  (`idempotencyKey` nuevo, terminales que no vuelven a ofrecerse), el freno por denegaciones
  seguidas (pasa a "atascado" y sale de la cola, `reactivate()` lo vuelve a ofrecer), y el CRUD del
  calendario que usa el panel admin.
- **El agente de punta a punta, sin red ni dinero** (`src/__tests__/e2e.test.ts`): el servidor MCP del
  calendario es el de verdad (un proceso hijo), AVAL es un simulador local (`aval-sim.ts`) y el modelo
  sigue un guion. Comprueba lo que importa de un agente que paga: que paga **una** sola vez con la clave de
  idempotencia que entrega el origen, que lo registra, y que la corrida siguiente **reconcilia con
  `check_payment` en vez de volver a pagar**. Otro caso arranca el trigger de cron y lo apaga sin dejar el
  servidor MCP vivo.

Lo que sigue sin probarse en automático es el modelo real (cuesta dinero cada corrida) y los triggers de
webhook y evento. Para ver el agente contra un AVAL de verdad, ver [04 · Variables de entorno](./docs/04-variables-de-entorno.md).

## Limitaciones conocidas

Ver [05 · Limitaciones](./docs/05-limitaciones.md) — entre otras: el origen de pagos no tiene
locking entre procesos, un disparo se descarta (no se encola) si el agente está ocupado, y el
agente nunca puede autoaprobar un `held` — eso siempre es un acto humano, en la consola de AVAL.
