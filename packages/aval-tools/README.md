# @backendkit-labs/aval-tools

Herramientas de pago para agentes de `@backendkit-labs/agent-core` que gastan a través de una
instancia de [AVAL](../../../../workspace-ideas/internet) — credencial por agente, presupuesto
previo y bitácora encadenada.

> **AVAL es una aplicación hermana, no parte del framework.** Es el control de gasto para agentes
> autónomos: lo que un procesador de pagos es para una tienda, AVAL lo es para un agente que gasta
> dinero. Da a cada agente su propia credencial revocable, comprueba presupuesto y política **antes**
> de que salga el dinero, pide a una persona que apruebe lo que pasa de un umbral, y escribe cada
> decisión en un registro encadenado por hash. El agente nunca tiene la credencial del proveedor: la
> tiene AVAL, que decide primero y paga él mismo. Este paquete es solo el puente: tres herramientas
> que hablan con una instancia de AVAL por HTTP. Un agente real que lo usa:
> [aval-scheduler](../../examples/aval-scheduler/).

## Qué trae

- **`pay`** — la vía amarrada: el agente pide un techo de gasto, AVAL decide y paga. Devuelve
  el resultado como texto: pagado (con el coste real y la referencia del carril), retenido
  (con el `authorizationId` para consultar después) o denegado (con el motivo) — y en los tres
  casos, el presupuesto que le queda al agente (`remainingToday`/`remainingTotal`), que AVAL ya
  manda en cada respuesta. Sin verlo, un agente que pide varios gastos en el mismo turno no
  tiene forma de saber si le va a alcanzar antes de pedir el siguiente.
- **`check_payment`** — consulta el estado de una autorización propia por `authorizationId`.
  Es la pieza que le faltaba al framework para la vía "retenido": nada bloquea una sesión
  esperando a un humano, así que un gasto retenido se resuelve volviendo a preguntar más
  tarde — en otra invocación, disparada por un trigger o por el propio usuario.
- **`list_own_history`** — el historial propio del agente en AVAL (`GET /api/v1/history`), en
  texto legible. `pay`/`check_payment` sólo muestran UN gasto puntual; esto le da al agente
  contexto de patrones (qué se pagó, a quién, con qué frecuencia) para priorizar cuando el
  presupuesto no va a alcanzar para todo. De sólo lectura, y pensado para usarse cuando hace
  falta, no en cada turno.

Ninguna herramienta guarda dinero ni credenciales del proveedor: eso lo tiene AVAL.

## Instalación

```bash
npm install @backendkit-labs/aval-tools @backendkit-labs/agent-core   # agent-core es peerDependency: lo pone tu app
```

## Uso

```ts
import { AgentEngine, ToolRegistry } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';

const tools = new ToolRegistry();
for (const tool of createAvalTools({ baseUrl: 'https://aval.internal' })) {
    tools.register(tool);
}

const profile = {
    id: 'expedientes-bot',
    // ...
    allowedTools: ['pay', 'check_payment', 'list_own_history' /* ... */],
    // La clave vive en el perfil de ESTE agente, no en una variable de entorno
    // compartida por todos. Cárgala desde donde guardes secretos (vault,
    // gestor de secretos del proveedor de nube, etc.), nunca en texto plano
    // en un fichero que se vaya a commitear.
    secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
};
```

## Un ejemplo completo: un agente que paga, con un AVAL simulado

Un solo archivo. Levanta un **AVAL de mentira** dentro del propio programa (imita lo mínimo del API real: autoriza lo pequeño, retiene lo grande para una persona, deniega lo que no cabe en el presupuesto y trata una clave de idempotencia repetida como una repetición), y un agente que gasta a través de él con las tres herramientas. Funciona sin servidor, sin clave y sin red. Guárdalo como `aval.ts` y ejecútalo con `npx tsx aval.ts`.

```bash
npm install @backendkit-labs/agent-core @backendkit-labs/aval-tools
npm install -D @backendkit-labs/agent-testkit typescript tsx
```

```ts
import { createServer } from 'node:http';
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

// ── 1. Un AVAL de mentira ────────────────────────────────────────────────────────────────────
// Imita lo mínimo del API real: autoriza lo pequeño, retiene lo grande para una persona, deniega lo que
// no cabe en el presupuesto, y trata una clave de idempotencia repetida como una repetición.
const MICRO = 1_000_000;                                     // AVAL cuenta en millonésimas de dólar
const KEY = 'aval_sk_demo';
const budget = { today: 5 * MICRO };                         // 5 USD al día
const auths = new Map<string, any>();
const byKey = new Map<string, any>();
const log: any[] = [];
let charges = 0;                                             // cuántas veces se pagó DE VERDAD

const send = (res: any, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const aval = createServer((req, res) => {
  let raw = '';
  req.on('data', c => (raw += c));
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(res, 401, { error: 'credencial inválida o caducada' });
    const url = new URL(req.url!, 'http://x');
    const snapshot = () => ({ remainingToday: budget.today, remainingTotal: 100 * MICRO });

    if (req.method === 'POST' && url.pathname === '/api/v1/spend') {
      const { counterparty, ceiling, purpose, idempotencyKey } = JSON.parse(raw);
      if (byKey.has(idempotencyKey)) return send(res, 200, { ...byKey.get(idempotencyKey), budget: snapshot() });   // repetición: no paga otra vez
      const id = `auth_${auths.size + 1}`;
      let decision: 'authorized' | 'held' | 'denied';
      let reasons: string[] = [];
      if (ceiling > budget.today) { decision = 'denied'; reasons = ['Supera el presupuesto restante de hoy.']; }
      else if (ceiling > 1 * MICRO) { decision = 'held'; reasons = ['Más de 1 USD: necesita aprobación humana.']; }
      else { decision = 'authorized'; budget.today -= ceiling; charges++; }
      const record = { authorizationId: id, decision, amount: ceiling, reasons, vendor: counterparty, purpose, state: decision === 'authorized' ? 'settled' : decision === 'held' ? 'held' : 'released', rail: decision === 'authorized' ? 'lightning' : null };
      auths.set(id, record);
      log.push({ seq: log.length + 1, ts: new Date().toISOString(), type: decision, amount: ceiling, asset: 'USD', vendor: counterparty, purpose, reasons });
      const capability = decision === 'authorized' ? { rail: 'lightning', kind: 'spend', actual: Math.round(ceiling * 0.9), payment: { rail: 'lightning', asset: 'sat', nativeAmount: 410, rate: 1, ref: `ref-${id}` } } : undefined;
      if (capability) (record as any).capability = capability;
      byKey.set(idempotencyKey, record);
      return send(res, 200, { ...record, budget: snapshot() });
    }
    const m = url.pathname.match(/^\/api\/v1\/spend\/(.+)$/);
    if (req.method === 'GET' && m) {
      const a = auths.get(decodeURIComponent(m[1]));
      return a ? send(res, 200, { ...a, createdAt: new Date().toISOString() }) : send(res, 404, { error: 'no existe' });
    }
    if (req.method === 'GET' && url.pathname === '/api/v1/history') return send(res, 200, { entries: log });
    send(res, 404, { error: 'ruta desconocida' });
  });
});
await new Promise<void>(r => aval.listen(0, '127.0.0.1', r));
const baseUrl = `http://127.0.0.1:${(aval.address() as { port: number }).port}`;

// ── 2. El agente ─────────────────────────────────────────────────────────────────────────────
const buyer = {
  id: 'expedientes-bot', name: 'Expedientes', icon: '📁', description: 'Paga trámites', systemPrompt: 'Paga lo que haga falta, solo a través de pay.',
  allowedTools: ['pay', 'check_payment', 'list_own_history'],
  secrets: { AVAL_KEY: KEY },                                 // la credencial de ESTE agente (en producción, de tu gestor de secretos)
};
const pay = (counterparty: string, ceilingUsd: number, purpose: string) =>
  ({ tool_calls: [{ id: `c-${counterparty}-${ceilingUsd}`, name: 'pay', args: { counterparty, ceilingUsd, purpose } }] });

const provider = scriptedProvider([
  pay('ocr.docs', 0.42, 'OCR del expediente 118'),            // pequeño: se autoriza y se paga
  pay('ocr.docs', 0.42, 'OCR del expediente 118'),            // el MISMO gasto repetido (p. ej. tras un timeout): no se paga dos veces
  pay('tarifas.aduana', 3, 'Actualización trimestral'),       // grande: queda retenido
  pay('notaria.digital', 4.7, 'Firma de poderes'),            // no cabe en lo que queda de hoy: denegado
  { tool_calls: [{ id: 'q1', name: 'check_payment', args: { authorizationId: 'auth_2' } }] },
  { content: 'Resumen listo.' },
]);

const t = mockTransport();
const engine = createBaseEngine({
  agentIdentity: selfAssertedIdentities(),   // who the agent is (SPEC-0044)
  identity: { userId: 'me' },                // on whose behalf it acts
  providers: { mock: provider }, defaultProvider: 'mock', agents: [buyer], defaultAgent: 'expedientes-bot',
  tools: [...createAvalTools({ baseUrl, maxAttempts: 2 })],
  transport: t.transport, workingDir: process.cwd(), iterationMode: 'auto',
});
await engine.run('Paga los trámites pendientes');
for (const m of provider.calls.at(-1)!.filter(m => m.role === 'tool')) console.log(String(m.content).replaceAll('\n', ' | ') + '\n');
console.log('pagos reales hechos por AVAL:', charges);

// ── 3. Pasa el tiempo: una persona aprueba en la consola de AVAL, y el agente vuelve a preguntar ──
auths.get('auth_2').state = 'settled'; auths.get('auth_2').rail = 'lightning';
const provider2 = scriptedProvider([
  { tool_calls: [{ id: 'q2', name: 'check_payment', args: { authorizationId: 'auth_2' } }] },
  { tool_calls: [{ id: 'h1', name: 'list_own_history', args: { limit: 10 } }] },
  { content: 'Todo resuelto.' },
]);
const t2 = mockTransport();
const engine2 = createBaseEngine({
  providers: { mock: provider2 }, defaultProvider: 'mock', agents: [buyer], defaultAgent: 'expedientes-bot',
  tools: [...createAvalTools({ baseUrl })], transport: t2.transport, workingDir: process.cwd(), iterationMode: 'auto',
});
await engine2.run('¿Ya se aprobó la tarifa de aduana? Muéstrame el historial');
for (const m of provider2.calls.at(-1)!.filter(m => m.role === 'tool')) console.log(String(m.content).replaceAll('\n', ' | ') + '\n');
aval.close();
```

Imprime (las fechas del historial van recortadas):

```text
Pagado. authorizationId="auth_1", carril=lightning, coste real=$0.378 (410 sat), ref=ref-auth_1. | Presupuesto restante: $4.58 hoy, $100.00 en total.
Pagado. authorizationId="auth_1", carril=lightning, coste real=$0.378 (410 sat), ref=ref-auth_1. | Presupuesto restante: $4.58 hoy, $100.00 en total.
Retenido para aprobación humana. authorizationId="auth_2". | Motivo: Más de 1 USD: necesita aprobación humana. | Usa check_payment con este authorizationId más tarde para saber si ya se resolvió — no se ha gastado nada todavía. | Presupuesto restante: $4.58 hoy, $100.00 en total.
Denegado. | Motivo: Supera el presupuesto restante de hoy. | Presupuesto restante: $4.58 hoy, $100.00 en total.
auth_2 → retenido — esperando aprobación humana, todavía no se gastó nada. | $3.00 · tarifas.aduana · Actualización trimestral | Motivo: Más de 1 USD: necesita aprobación humana.
pagos reales hechos por AVAL: 1
auth_2 → liquidado — el pago se completó. | $3.00 · tarifas.aduana · vía lightning · Actualización trimestral | Motivo: Más de 1 USD: necesita aprobación humana.
3 entrada(s), más reciente al final: | #1 … authorized $0.42 ocr.docs · OCR del expediente 118 | #2 … held $3.00 tarifas.aduana · Actualización trimestral — Más de 1 USD: necesita aprobación humana. | #3 … denied $4.70 notaria.digital · Firma de poderes — Supera el presupuesto restante de hoy.
```

Cómo leerlo:

1. **Las tres respuestas de `pay`.** El gasto pequeño sale **pagado**, con el coste real y la referencia del carril. El grande queda **retenido** y devuelve un `authorizationId`: no se gastó nada. El que no cabe es **denegado**, con el motivo. En los tres casos el agente ve el **presupuesto que le queda**, para priorizar el siguiente gasto.
2. **Reintentar no duplica el gasto.** La segunda llamada es exactamente la misma que la primera (un reintento tras un timeout, por ejemplo). La clave de idempotencia sale de la sesión y de los argumentos, así que AVAL la trata como una repetición: devuelve el mismo `auth_1` y `pagos reales hechos por AVAL` vale **1**, no 2.
3. **Retenido no bloquea la sesión.** El turno del agente termina con el gasto retenido. Más tarde, **otra invocación** llama a `check_payment` con ese id y averigua el desenlace. En el ejemplo, entre las dos invocaciones una persona aprueba el gasto en la consola de AVAL: el agente no interviene, y no puede aprobárselo.
4. **`list_own_history`** le da al agente contexto de patrones (qué se pagó, a quién, qué se denegó) cuando necesita decidir entre varios pagos. Úsalo cuando haga falta, no en cada turno.
5. **La credencial es de este agente.** `secrets: { AVAL_KEY: … }` va en el perfil **de este agente**, no en una variable de entorno compartida. En producción lee la clave de tu gestor de secretos.

## Contra el AVAL real

El simulador sirve para aprender y para probar tu agente sin depender de nada. Para ver el recorrido con el servicio de verdad, levanta AVAL (`npm run dev` en su proyecto) y apunta `baseUrl` a él. Hacen falta dos credenciales distintas, y ese es el punto del diseño:

- el **token de consola** (humano): da de alta al agente y aprueba lo retenido;
- la **clave del agente** (máquina, `aval_sk_…`): pide gasto. Se muestra una sola vez al darlo de alta.

Este script hace el recorrido completo contra un AVAL real: da de alta al agente con su política, deja que gaste, aprueba con el token de consola lo que quedó retenido, y el agente vuelve a preguntar. Se probó contra AVAL en local (`http://127.0.0.1:3101`, con un directorio de datos desechable):

```ts
import { createBaseEngine, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';
import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';

const baseUrl = 'http://127.0.0.1:3101';
const CONSOLE = 'demo-console';
const USD = 1_000_000;
const call = async (path: string, token: string, body?: unknown) => {
  const r = await fetch(baseUrl + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: r.status, body: await r.json() as any };
};

await call('/api/v1/demo', CONSOLE, { action: 'reset' });
const alta = await call('/api/v1/agents', CONSOLE, {
  id: 'expedientes-bot', name: 'Expedientes', owner: 'Ana Duarte', purpose: 'Paga trámites',
  policy: { asset: 'USD', perCallMax: 5 * USD, dailyMax: 5 * USD, totalMax: 40 * USD, approvalAbove: 1 * USD, maxCallsPerMinute: 60,
            allowedVendors: ['ocr.docs', 'tarifas.aduana'], allowedRails: ['proxy'] },
});
const key = alta.body.token as string;
const buyer = { id: 'expedientes-bot', name: 'Expedientes', icon: '📁', description: 'Paga trámites', systemPrompt: 'Paga solo con pay.',
  allowedTools: ['pay', 'check_payment', 'list_own_history'], secrets: { AVAL_KEY: key } };
const pay = (counterparty: string, ceilingUsd: number, purpose: string) =>
  ({ tool_calls: [{ id: `c-${counterparty}-${ceilingUsd}`, name: 'pay', args: { counterparty, ceilingUsd, purpose } }] });

async function run(turns: any[], prompt: string): Promise<string[]> {
  const provider = scriptedProvider(turns);
  const engine = createBaseEngine({ agentIdentity: selfAssertedIdentities(), identity: { userId: 'me' }, providers: { mock: provider }, defaultProvider: 'mock', agents: [buyer], defaultAgent: 'expedientes-bot',
    tools: [...createAvalTools({ baseUrl })], transport: mockTransport().transport, workingDir: process.cwd(), iterationMode: 'auto' });
  await engine.run(prompt);
  return provider.calls.at(-1)!.filter(m => m.role === 'tool').map(m => String(m.content));
}

const first = await run([
  pay('ocr.docs', 0.42, 'OCR del expediente 118'),
  pay('tarifas.aduana', 3, 'Actualización trimestral'),
  { content: 'ok' },
], 'Paga los trámites');
first.forEach(t => console.log(t.replaceAll('\n', ' | ').slice(0, 200) + '\n'));

const heldId = first.map(t => /Retenido.*authorizationId="(auth_[a-f0-9]+)"/.exec(t)?.[1]).find(Boolean)!;
console.log('--- retenido:', heldId);
const approval = await call('/api/v1/approvals', CONSOLE, { authorizationId: heldId, approve: true, approver: 'Ana Duarte', note: 'ok' });
console.log('--- aprobación en consola:', approval.status, approval.body.error ?? 'ok');

const second = await run([
  { tool_calls: [{ id: 'q', name: 'check_payment', args: { authorizationId: heldId } }] },
  { tool_calls: [{ id: 'h', name: 'list_own_history', args: { limit: 10 } }] },
  { content: 'ok' },
], 'Estado y historial');
second.forEach(t => console.log(t.replaceAll('\n', ' | ').slice(0, 700) + '\n'));
```

Lo que se vio con el AVAL real, y que el simulador solo imita:

- **El motivo viene de la política del agente:** `$3,00 supera el umbral de $1,00: requiere aprobación de Ana Duarte`. Cada agente tiene su responsable, su tope por llamada, por día y total, y su lista de contrapartes y carriles permitidos. Una contraparte que no está en el registro se **deniega** sin llegar a evaluar el presupuesto.
- **El coste real se conoce al liquidar.** En el carril `proxy`, `pay` devuelve el coste del momento y `check_payment` el definitivo (`$2.9767` en la corrida, para un techo de `$3`). Por eso el techo es un máximo, no el precio.
- **El historial es la cadena de AVAL:** además de los gastos aparecen el alta del agente y la emisión de su clave, cada entrada encadenada con la anterior.
- **Si tu AVAL usa Postgres o Redis** (`AVAL_STORE`, `AVAL_INSTANCES` en su `.env`) y solo quieres probar, arráncalo con `AVAL_STORE=files AVAL_INSTANCES=single AVAL_DATA_DIR=<carpeta temporal>` para no tocar esos datos.

## Configuración

```ts
interface AvalToolsConfig {
    baseUrl: string;       // dónde está AVAL
    secretName?: string;   // nombre de la credencial en ctx.secrets — por defecto "AVAL_KEY"
    timeoutMs?: number;    // por defecto 15000
    maxAttempts?: number;  // por defecto 3
}
```

## El flujo de un gasto retenido

```
1. El agente llama a pay("tarifas.aduana", 0.70, "Actualización trimestral").
   → "Retenido para aprobación humana. authorizationId=auth_xyz. [...]"
   El turno del agente termina ahí. No hace falta que la sesión siga viva.

2. Horas después, alguien aprueba el gasto desde la consola de AVAL —
   aprobar es pagar: AVAL usa su propia credencial, el agente no interviene.

3. Una invocación nueva del agente (un cron, un webhook, o simplemente el
   usuario preguntando "¿ya se aprobó eso?") llama a
   check_payment("auth_xyz").
   → "auth_xyz → liquidado — el pago se completó. [...]"
```

## Por qué reintentar no duplica el gasto

`pay` deriva una clave de idempotencia a partir de la sesión y los argumentos exactos de la
llamada (`sha256(sessionId:counterparty:ceiling:purpose)`). Un reintento del propio agente
tras un timeout de red produce la misma clave y AVAL lo trata como una repetición, no como un
segundo gasto. Una llamada genuinamente distinta —otro importe, otro propósito, otra sesión—
obtiene una clave distinta por sí sola.

## Qué pasa si AVAL no responde

Las tres herramientas reintentan automáticamente ante errores de red o 5xx (backoff
exponencial con `jitter`, tres intentos por defecto). Los 4xx —denegado, credencial revocada,
límite superado— nunca se reintentan: son respuestas de negocio, no fallos de transporte, y
se devuelven al agente como texto para que decida qué hacer.
