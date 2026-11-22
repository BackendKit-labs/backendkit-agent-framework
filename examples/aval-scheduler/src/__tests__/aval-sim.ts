import { createServer, type Server } from 'node:http';

const MICRO = 1_000_000; // AVAL cuenta en millonésimas de dólar

export interface Spend {
    counterparty: string;
    ceiling: number;
    purpose: string;
    idempotencyKey: string;
}

/**
 * Un AVAL de mentira para probar el agente sin el servicio real: imita lo mínimo del API (`/spend`,
 * `/spend/:id`, `/history`). Autoriza lo pequeño y trata una clave de idempotencia repetida como una
 * repetición. `spends` cuenta los gastos que AVAL aceptó DE VERDAD: es lo que una prueba compara para
 * demostrar que no se pagó dos veces.
 */
export async function startAvalSim(key: string): Promise<{ url: string; spends: Spend[]; settle(id: string): void; close(): Promise<void> }> {
    const spends: Spend[] = [];
    const byKey = new Map<string, Record<string, unknown>>();
    const byId = new Map<string, Record<string, unknown>>();
    const budget = { today: 5 * MICRO };

    const send = (res: import('node:http').ServerResponse, status: number, body: unknown) =>
        res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));

    const server: Server = createServer((req, res) => {
        let raw = '';
        req.on('data', (c) => (raw += c));
        req.on('end', () => {
            if (req.headers.authorization !== `Bearer ${key}`) return send(res, 401, { error: 'credencial inválida' });
            const url = new URL(req.url ?? '/', 'http://sim');
            const snapshot = () => ({ remainingToday: budget.today, remainingTotal: 100 * MICRO });

            if (req.method === 'POST' && url.pathname === '/api/v1/spend') {
                const body = JSON.parse(raw) as Spend;
                const known = byKey.get(body.idempotencyKey);
                if (known) return send(res, 200, { ...known, budget: snapshot() }); // repetición: no paga otra vez
                const authorizationId = `auth_${spends.length + 1}`;
                spends.push(body);
                budget.today -= body.ceiling;
                const record = {
                    authorizationId, decision: 'authorized', amount: body.ceiling, reasons: [], vendor: body.counterparty,
                    purpose: body.purpose, state: 'authorized', rail: 'proxy',
                };
                byKey.set(body.idempotencyKey, record);
                byId.set(authorizationId, record);
                return send(res, 200, { ...record, budget: snapshot() });
            }
            const m = /^\/api\/v1\/spend\/(.+)$/.exec(url.pathname);
            if (req.method === 'GET' && m) {
                const record = byId.get(decodeURIComponent(m[1]));
                return record ? send(res, 200, { ...record, createdAt: new Date().toISOString() }) : send(res, 404, { error: 'no existe' });
            }
            if (req.method === 'GET' && url.pathname === '/api/v1/history') return send(res, 200, { entries: [] });
            send(res, 404, { error: 'ruta desconocida' });
        });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    return {
        url: `http://127.0.0.1:${port}`,
        spends,
        /** Lo que hace una persona (o el carril) más tarde: el gasto pasa a liquidado. */
        settle(id) { const r = byId.get(id); if (r) r.state = 'settled'; },
        close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
}
