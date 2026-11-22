/**
 * Panel admin: API + una página HTML sin build step, en el mismo proceso
 * que el agente — necesita estar acá, no en un servidor aparte, por dos
 * razones:
 *
 *   1. `PaymentsSourceStore` lee/escribe el JSON en cada llamada (ver la
 *      nota en `store.ts`), así que cualquier proceso que apunte al mismo
 *      archivo ve los cambios de los demás sin coordinación extra.
 *   2. "Correr ahora" necesita `agent.emit(...)` — sólo existe en el
 *      `AutonomousAgent` de este proceso, no se puede invocar desde otro.
 *
 * Apagado por defecto: sin `ADMIN_TOKEN` no se levanta ningún servidor, en
 * vez de dejar un panel que programa gastos escuchando sin autenticación.
 */

import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response, type NextFunction } from 'express';
import { PaymentsSourceStore, PaymentValidationError, STUCK_THRESHOLD, type PaymentInput } from './mcp-payments-source/store';

export interface AdminServerOptions {
    port: number;
    token: string;
    store: PaymentsSourceStore;
    /** `AutonomousAgent.emit` — dispara el trigger `event` que arma index.ts. */
    emitRunNow: () => void;
}

function constantTimeEquals(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

function asPaymentInput(body: unknown): PaymentInput {
    if (typeof body !== 'object' || body === null) throw new PaymentValidationError('Cuerpo inválido.');
    const b = body as Record<string, unknown>;
    return {
        counterparty: String(b.counterparty ?? ''),
        ceilingUsd: Number(b.ceilingUsd),
        purpose: String(b.purpose ?? ''),
        dayOfMonth: Number(b.dayOfMonth),
        ...(typeof b.active === 'boolean' ? { active: b.active } : {}),
    };
}

export function startAdminServer(opts: AdminServerOptions): Server {
    const app = express();
    app.use(express.json());

    app.use((req: Request, res: Response, next: NextFunction) => {
        const header = req.header('authorization') ?? '';
        const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
        if (!constantTimeEquals(token, opts.token)) {
            res.status(401).json({ error: 'Falta o no coincide el token de administración (Authorization: Bearer <token>).' });
            return;
        }
        next();
    });

    app.get('/api/schedule', (_req: Request, res: Response) => {
        res.json({ schedule: opts.store.listSchedule() });
    });

    app.post('/api/schedule', (req: Request, res: Response) => {
        const id = String((req.body as Record<string, unknown>)?.id ?? '');
        try {
            const payment = opts.store.addPayment(id, asPaymentInput(req.body));
            res.status(201).json({ payment });
        } catch (err) {
            if (err instanceof PaymentValidationError) return void res.status(400).json({ error: err.message });
            throw err;
        }
    });

    app.put('/api/schedule/:id', (req: Request, res: Response) => {
        try {
            const payment = opts.store.updatePayment(String(req.params.id), req.body as Partial<PaymentInput>);
            res.json({ payment });
        } catch (err) {
            if (err instanceof PaymentValidationError) {
                const status = err.message.includes('No existe') ? 404 : 400;
                return void res.status(status).json({ error: err.message });
            }
            throw err;
        }
    });

    app.delete('/api/schedule/:id', (req: Request, res: Response) => {
        try {
            opts.store.removePayment(String(req.params.id));
            res.status(204).end();
        } catch (err) {
            if (err instanceof PaymentValidationError) return void res.status(404).json({ error: err.message });
            throw err;
        }
    });

    app.get('/api/history', (_req: Request, res: Response) => {
        // `stuck` es una comodidad para el panel — el mismo criterio que usa
        // listDue() para dejar de ofrecerlo, calculado acá una sola vez en
        // vez de duplicarlo en el JS del cliente.
        const outcomes = opts.store.listOutcomes().map((o) => ({
            ...o,
            stuck: o.state === 'denied' && o.consecutiveDenials >= STUCK_THRESHOLD,
        }));
        res.json({ outcomes, stuckThreshold: STUCK_THRESHOLD });
    });

    app.post('/api/schedule/:id/reactivate', (req: Request, res: Response) => {
        try {
            opts.store.reactivate(String(req.params.id));
            res.json({ ok: true });
        } catch (err) {
            if (err instanceof PaymentValidationError) return void res.status(404).json({ error: err.message });
            throw err;
        }
    });

    app.post('/api/run-now', (_req: Request, res: Response) => {
        opts.emitRunNow();
        res.status(202).json({ ok: true, note: 'Disparado — si el agente está ocupado con otra corrida, se descarta con un aviso en el log.' });
    });

    app.get('/', (_req: Request, res: Response) => {
        res.type('html').send(PANEL_HTML);
    });

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
        res.status(500).json({ error: err.message });
    });

    const server = createServer(app);
    server.listen(opts.port);
    return server;
}

const PANEL_HTML = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>aval-scheduler-agent</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.3rem; }
  h2 { font-size: 1.05rem; margin-top: 2rem; }
  table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
  th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; font-size: 0.9rem; }
  th { background: #f4f4f4; }
  form { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.75rem; align-items: end; }
  label { display: flex; flex-direction: column; font-size: 0.8rem; gap: 0.2rem; }
  input { padding: 0.3rem; }
  button { padding: 0.4rem 0.8rem; cursor: pointer; }
  .danger { color: #b00020; background: none; border: 1px solid #b00020; border-radius: 3px; }
  .msg { font-size: 0.85rem; margin-top: 0.5rem; }
  .msg.error { color: #b00020; }
  .msg.ok { color: #146c2e; }
  #runNow { background: #146c2e; color: white; border: none; border-radius: 3px; }
  tr.stuck { background: #fff4f4; }
  .badge-stuck { color: #b00020; font-weight: 600; }
</style>
</head>
<body>
<h1>aval-scheduler-agent — panel</h1>
<p><button id="runNow">Correr ahora</button> <span id="runMsg" class="msg"></span></p>

<h2>Calendario de pagos</h2>
<table id="scheduleTable"><thead>
  <tr><th>id</th><th>contraparte</th><th>techo USD</th><th>motivo</th><th>día</th><th>activo</th><th></th></tr>
</thead><tbody></tbody></table>

<form id="addForm">
  <label>id <input name="id" required></label>
  <label>contraparte <input name="counterparty" required></label>
  <label>techo USD <input name="ceilingUsd" type="number" step="0.01" min="0.01" required></label>
  <label>motivo <input name="purpose" required></label>
  <label>día del mes <input name="dayOfMonth" type="number" min="1" max="28" required></label>
  <button type="submit">Agregar</button>
</form>
<p id="addMsg" class="msg"></p>

<h2>Historial de resultados</h2>
<table id="historyTable"><thead>
  <tr><th>occurrenceId</th><th>estado</th><th>intento</th><th>denegaciones seguidas</th><th>actualizado</th><th></th></tr>
</thead><tbody></tbody></table>

<script>
let token = localStorage.getItem('adminToken');
if (!token) {
  token = prompt('Token de administración (ADMIN_TOKEN):') || '';
  if (token) localStorage.setItem('adminToken', token);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, ...(opts.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem('adminToken');
    alert('Token inválido. Recargá la página para ingresarlo de nuevo.');
    throw new Error('unauthorized');
  }
  const body = res.status === 204 ? null : await res.json();
  if (!res.ok) throw new Error(body?.error || ('HTTP ' + res.status));
  return body;
}

function fmtUsd(n) { return '$' + n.toFixed(2); }

async function loadSchedule() {
  const { schedule } = await api('/api/schedule');
  const tbody = document.querySelector('#scheduleTable tbody');
  tbody.innerHTML = '';
  for (const p of schedule) {
    const tr = document.createElement('tr');
    tr.innerHTML = \`<td>\${p.id}</td><td>\${p.counterparty}</td><td>\${fmtUsd(p.ceilingUsd)}</td>
      <td>\${p.purpose}</td><td>\${p.dayOfMonth}</td><td>\${p.active ? 'sí' : 'no'}</td>
      <td><button data-id="\${p.id}" class="danger removeBtn">quitar</button></td>\`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.removeBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Quitar "' + btn.dataset.id + '" del calendario?')) return;
      await api('/api/schedule/' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
      loadSchedule();
    });
  });
}

async function loadHistory() {
  const { outcomes } = await api('/api/history');
  const tbody = document.querySelector('#historyTable tbody');
  tbody.innerHTML = '';
  for (const o of outcomes) {
    const tr = document.createElement('tr');
    if (o.stuck) tr.className = 'stuck';
    const denials = o.stuck
      ? \`<span class="badge-stuck">\${o.consecutiveDenials} — atascado</span>\`
      : String(o.consecutiveDenials);
    const paymentId = o.occurrenceId.split(':')[0];
    const reactivateBtn = o.stuck
      ? \`<button data-payment-id="\${paymentId}" class="reactivateBtn">reactivar</button>\`
      : '';
    tr.innerHTML = \`<td>\${o.occurrenceId}</td><td>\${o.state}</td><td>\${o.attempt}</td>
      <td>\${denials}</td><td>\${o.updatedAt}</td><td>\${reactivateBtn}</td>\`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('.reactivateBtn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api('/api/schedule/' + encodeURIComponent(btn.dataset.paymentId) + '/reactivate', { method: 'POST' });
      loadHistory();
    });
  });
}

document.getElementById('addForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = new FormData(ev.target);
  const id = form.get('id');
  const msg = document.getElementById('addMsg');
  try {
    await api('/api/schedule', {
      method: 'POST',
      body: JSON.stringify({
        id,
        counterparty: form.get('counterparty'),
        ceilingUsd: Number(form.get('ceilingUsd')),
        purpose: form.get('purpose'),
        dayOfMonth: Number(form.get('dayOfMonth')),
      }),
    });
    msg.textContent = 'Agregado.';
    msg.className = 'msg ok';
    ev.target.reset();
    loadSchedule();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg error';
  }
});

document.getElementById('runNow').addEventListener('click', async () => {
  const msg = document.getElementById('runMsg');
  try {
    await api('/api/run-now', { method: 'POST' });
    msg.textContent = 'Disparado.';
    msg.className = 'msg ok';
  } catch (err) {
    msg.textContent = err.message;
    msg.className = 'msg error';
  }
});

loadSchedule();
loadHistory();
</script>
</body>
</html>`;
