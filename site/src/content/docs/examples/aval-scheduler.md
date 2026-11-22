---
title: aval-scheduler
description: An autonomous agent that pays scheduled bills through AVAL. How the framework and AVAL fit together, what each one decides, and how to test that it never pays twice.
---

*Tests need nothing. Running it for real needs a model key and an AVAL instance.*

:::note[AVAL is a sister application, not part of the framework]
**AVAL** is a separate project that works alongside the framework. It is **spend control for autonomous agents**: what a payment processor is to a shop, AVAL is to an agent that spends money. It gives each agent **its own revocable credential**, checks a **budget and a policy before** any money leaves (per call, per day, in total, which counterparties and rails are allowed), asks a **person** to approve what exceeds a threshold, and writes every decision, denied, held or authorised, to a **hash-chained record** that cannot be rewritten without it showing.

The agent never holds a payment credential: AVAL holds it, decides first and pays itself. That is why an agent can be given real spending power without trusting its prompt.

The framework does not depend on AVAL. The bridge is one small package, [`@backendkit-labs/aval-tools`](../../packages/aval-tools/), which gives an agent three tools (`pay`, `check_payment`, `list_own_history`) that talk to an AVAL instance over HTTP. This page shows the two working together.
:::

A payment on a schedule is easy to automate badly. Either the script pays without asking, and a bug pays twice. Or a person approves every month by hand, and nothing was automated. **aval-scheduler** is the middle path: an [autonomous agent](../../agents/autonomous/) that pays what is due, but only **through [AVAL](../../packages/aval-tools/)**, which checks the budget and the policy *before* money leaves and keeps a hash-chained record of every decision.

It is also the best worked example of the framework and AVAL together, because it uses almost every piece: triggers, an MCP data source, per-agent credentials, payment tools, a small tool list, and a test that proves the one property that matters. The source is in [`examples/aval-scheduler`](https://github.com/BackendKit-labs/backendkit-agent-framework/tree/master/examples/aval-scheduler).

## Who decides what

The design is a division of labour. Each decision lives in the one place that can make it reliably.

| Decision | Made by | Why there |
|---|---|---|
| **What is due today** | Code: `PaymentsSourceStore.listDue()` | It is arithmetic (day of month, last outcome). A model should not guess it. |
| **Whether a payment is allowed** | **AVAL**: budget, per-call and daily limits, allowed counterparties, rails | The agent never holds a payment credential, so it cannot skip the answer. |
| **Whether a held payment is approved** | **A person**, in AVAL's console | The agent has no way to approve its own spend. |
| **Whether a retry is a repeat** | The idempotency key, handed out by the source | The same key is the same payment, so a timeout and a retry cannot pay twice. |
| **In what order to pay, and what to report** | The model | Judgement: prioritise when the budget will not cover everything, then summarise. |

The model *executes and reports*. Its prompt says so: AVAL already decided, so a denied or held payment is reported, not retried.

## The pieces

```
cron · POST /run-now · panel button  →  engine.run(prompt)
  1. list_pending_confirmations  → check_payment each      → record_payment_outcome
  2. list_due_payments           → (list_own_history if the budget will not cover all)
                                 → pay each (idempotencyKey as given) → record_payment_outcome
  3. summary in plain text
```

| Piece | What it is | Framework feature |
|---|---|---|
| The agent | One profile with seven tools | [`createAutonomousAgent`](../../agents/autonomous/) |
| Triggers | Daily cron; a signed webhook; an event from the admin panel | `triggers`: `schedule`, `webhook`, `event`. They share one gate: a trigger that arrives while a run is in progress is dropped, never queued. |
| The schedule | An **MCP server** that is a child process (`list_due_payments`, `list_pending_confirmations`, `list_stuck_payments`, `record_payment_outcome`) | [`mcpServers`](../../concepts/mcp/). Its tools appear to the model as `mcp__payments-source__<tool>`. |
| Payments | `pay`, `check_payment`, `list_own_history` | [`aval-tools`](../../packages/aval-tools/) |
| The credential | The agent's own AVAL key, in its profile | `secrets` on the `AgentProfile`: it is per agent, not an environment variable shared by all |
| Memory of what was paid | **None** in the agent. AVAL is the truth about money and the source is the truth about the schedule. | `maxContextMessages: 40` keeps a process that lives for weeks from growing its history |

## The agent in code

`src/agent.ts` builds the whole agent. It is split from `index.ts` (which only reads the environment, starts the process and handles signals) so that production and the tests build **exactly the same agent**; only the model, the AVAL address and the triggers change.

```ts
import { createAutonomousAgent } from '@backendkit-labs/agent-core';
import type { AutonomousAgent, AutonomousAgentOptions } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';
import { buildProfile } from './profile';

export interface SchedulerAgentOptions {
    /** Modelos disponibles y cuál usar. En producción un `DeepSeekProvider`; en las pruebas, uno guionizado. */
    providers: AutonomousAgentOptions['providers'];
    defaultProvider: string;
    /** Dónde vive AVAL y la clave de ESTE agente (nunca la de consola). */
    avalUrl: string;
    avalKey: string;
    /** Qué dispara una corrida: cron, webhook, evento. Sin triggers, solo se corre a mano con `agent.engine.run`. */
    triggers?: AutonomousAgentOptions['triggers'];
    transport?: AutonomousAgentOptions['transport'];
    /**
     * Dónde está el JSON del origen de pagos. Ausente: el servidor MCP usa su valor por defecto
     * (`~/.aval-scheduler/schedule.json`). Un valor "" no es lo mismo que ausente, así que solo se
     * pasa a ese proceso si de verdad hay algo que pasar.
     */
    paymentsSourcePath?: string;
    /**
     * Script del servidor MCP del origen de pagos. Por defecto el compilado de este proyecto; las pruebas lo
     * apuntan a `dist/` porque un hijo de Node no ejecuta TypeScript.
     */
    paymentsServerEntry?: string;
    /** Puerto del webhook, si hay un trigger `webhook`. */
    webhookPort?: number;
}

/**
 * El agente de pagos programados, sin la parte de proceso (variables de entorno, señales, panel).
 * Está separado de `index.ts` para poder construirlo igual en producción y en las pruebas: lo único que
 * cambia entre una y otra es el modelo, la URL de AVAL y los triggers.
 */
export function buildSchedulerAgent(opts: SchedulerAgentOptions): AutonomousAgent {
    // pay, check_payment y list_own_history, del paquete de npm.
    const avalTools = createAvalTools({ baseUrl: opts.avalUrl });

    return createAutonomousAgent({
        providers: opts.providers,
        defaultProvider: opts.defaultProvider,
        agents: [buildProfile(opts.avalKey)],
        tools: [...avalTools],
        ...(opts.transport ? { transport: opts.transport } : {}),
        goal: 'Ejecutar pagos programados a través de AVAL, reconciliando lo pendiente antes de procesar lo nuevo.',

        // El proceso vive días o semanas; sin esto el historial de mensajes
        // crece sin límite en el mismo AgentEngine entre corridas del cron.
        // 40 es el valor que el propio framework recomienda para agentes
        // autónomos de larga duración.
        maxContextMessages: 40,

        mcpServers: [
            {
                name: 'payments-source',
                command: 'node',
                args: [opts.paymentsServerEntry ?? require.resolve('./mcp-payments-source/server')],
                ...(opts.paymentsSourcePath ? { env: { PAYMENTS_SOURCE_PATH: opts.paymentsSourcePath } } : {}),
            },
        ],

        triggers: opts.triggers ?? [],
        ...(opts.webhookPort ? { webhookPort: opts.webhookPort } : {}),
    });
}

/**
 * Apaga el agente por completo: los triggers (cron, webhook, eventos) y también el servidor MCP del
 * calendario, que es un proceso hijo. `agent.stop()` solo para los triggers; sin esto el hijo queda vivo
 * mientras el proceso padre siga corriendo (en las pruebas, o si el agente se embebe en otro programa).
 */
export async function stopSchedulerAgent(agent: AutonomousAgent): Promise<void> {
    await agent.stop();
    await agent.engine.getMCPManager()?.disconnect();
}
```

Three things to notice:

- **`createAvalTools({ baseUrl })`** returns the three tools. They hold no key: each call reads `AVAL_KEY` from the calling agent's own `secrets`, so two agents with different keys can share one set of tools and each spends its own budget.
- **`mcpServers`** starts the schedule as a child process over stdio. The framework connects, lists its tools and namespaces them. Putting the schedule behind MCP means replacing the JSON file with Postgres or your ERP is rewriting one process, not the agent.
- **`stopSchedulerAgent`** exists because `agent.stop()` stops the triggers but does **not** close the MCP child. Use it (or `engine.getMCPManager()?.disconnect()`) when the program keeps running after the agent stops, such as in tests or when the agent is embedded in a larger program.

The profile (`src/profile.ts`) is short on purpose. One agent, seven tools, no delegation:

```ts
allowedTools: [
  'mcp__payments-source__list_due_payments',
  'mcp__payments-source__list_pending_confirmations',
  'mcp__payments-source__list_stuck_payments',
  'mcp__payments-source__record_payment_outcome',
  'pay', 'check_payment', 'list_own_history',
],
secrets: { AVAL_KEY: avalKey },     // this agent's own key, never the console token
```

An agent with few, concrete tools makes far fewer tool-use mistakes than one with a large catalogue. `list_own_history` and `list_stuck_payments` are read-only and the prompt reserves each for one case: history only when the budget will not cover the whole list, stuck payments only to be mentioned in the summary.

## The idempotency design: the part to copy

This is the idea that makes the agent safe to run unattended.

1. **The source hands out the key.** `list_due_payments` returns each payment with an `idempotencyKey` of the form `<payment>:<year-month>:<attempt>`, for example `renta:2026-11:1`. The prompt tells the model to pass it to `pay` **unmodified** and never to build its own.
2. **A repeat is not a second payment.** If a run is interrupted after `pay` and repeated, the key is the same, so AVAL answers with the first decision instead of spending again.
3. **A new month is a new payment.** The year and month are in the key. Without them, "rent, 500, August" and "rent, 500, September" would collide and the second would never be paid.
4. **A denial is not the end.** AVAL's policy may change between runs (more budget, a counterparty just registered), so a denied payment is offered again with the **next attempt number**, which is a new key that AVAL evaluates afresh.
5. **But not for ever.** After three denials in a row a payment is **stuck**: it leaves the due list, and the agent only *mentions* it in its summary, because someone has to look at AVAL or the calendar. A person puts it back with `reactivate()`.
6. **Held and authorised are reconciled, not repeated.** They go to `list_pending_confirmations`, and the next run asks `check_payment` for the outcome instead of asking `pay` again.

## Test that it pays once

Testing "never pays twice" with a real model and a real AVAL would cost money and prove little. The test in `src/__tests__/e2e.test.ts` builds the **real agent** with a scripted model, a **simulated AVAL** (`aval-sim.ts`, in the same folder) and the **real MCP server** as a child process. The model follows a script; the property under test is not the model's:

```ts
const aval = await startAvalSim(KEY);                       // counts the spends it really accepted
// ... write a schedule with one payment due ...
const agent = buildSchedulerAgent({
  providers: { mock: provider }, defaultProvider: 'mock',
  avalUrl: aval.url, avalKey: KEY, transport: t.transport,
  paymentsSourcePath: sourcePath, paymentsServerEntry: SERVER,
});

const first = await agent.engine.run('Run the scheduled payments for today.');
expect(aval.spends).toHaveLength(1);                         // paid ONCE...
expect(aval.spends[0].idempotencyKey).toBe(`${occurrenceId}:1`);   // ...with the key the source handed out
aval.settle('auth_1');                                       // time passes: the rail settles it

const second = await agent.engine.run('Run the scheduled payments for today.');
expect(second.toolCalls.map(c => c.name)).toContain('check_payment');
expect(aval.spends).toHaveLength(1);                         // the second run did NOT pay again
```

What the test proves, and what it does not:

- **Proves** the wiring: the MCP child connects, the tools are namespaced as the profile expects, the key travels untouched from the source to AVAL, the outcome is recorded, and the next run reconciles.
- **Does not prove** the model's judgement. A scripted model always calls the right tools. For that, run it for real a few times and read the summaries.
- **The simulator is minimal.** It imitates `spend`, the status call and the history. For holds and denials by policy, use the [real AVAL](../../packages/aval-tools/#contra-el-aval-real) (the aval-tools page shows a script that registers an agent, lets it spend, approves a held payment with the console token, and has the agent check again).

`npm test` builds first (`pretest`), because the MCP child is a Node process and cannot run TypeScript.

## Run it for real

```bash
cd examples/aval-scheduler
cp .env.example .env     # AVAL_URL, AVAL_KEY, DEEPSEEK_API_KEY
npm install && npm run build && npm start
```

Register the agent in AVAL first (console, or `POST /api/v1/agents` with the console token) and put the key it returns in `AVAL_KEY`. It is the **agent's** key (`aval_sk_…`), never the console token: the console token is how a person approves, and the agent must not hold it. The agent checks at start-up that AVAL is reachable and its chain is intact, and refuses to start on a placeholder key.

Optional extras are off unless configured: `SCHEDULER_WEBHOOK_SECRET` opens `POST /run-now` (HMAC-signed), and `ADMIN_TOKEN` starts the admin panel with a "run now" button.

## Take this to your own agent

1. **Give the decision to the system that can make it.** Money, permissions and limits belong to the service that holds the credential, not to the prompt.
2. **Hand out the idempotency key from code.** Never ask the model to invent or remember one.
3. **Reconcile on the next run** rather than waiting inside a turn for a human. A held payment ends the turn; a later run asks for the outcome.
4. **Keep no state in the agent.** The agent only joins two sources of truth on each run, so a restart loses nothing.
5. **Split the agent from the process.** One function builds the agent; another file reads the environment. Then the test and production share the code.
6. **Test the property, not the model.** Script the model and count what the money system accepted.

Known limits (no locking between processes on the schedule file, a trigger dropped while a run is in progress, no automatic approval of a held payment) are listed in the example's own documentation, `docs/05-limitaciones.md`.
