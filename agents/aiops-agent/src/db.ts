import * as fs from 'node:fs';
import * as path from 'node:path';
import Database from 'better-sqlite3';
import type { Action, Severity } from './types';

export type Db = Database.Database;

export interface PolicyRow {
    id: string;
    description: string;
    applies_env: string;          // csv or '*'
    applies_category: string;     // csv or '*'
    max_severity_autonomous: Severity;
    allowed_actions: Action[];
}

export interface IncidentRow {
    id: string;
    title: string;
    category: string;
    server: string;
    resolution_action: Action;
    outcome: string;
    text: string;
    embedding: Buffer | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS servers (
  name TEXT PRIMARY KEY, env TEXT NOT NULL, criticality TEXT NOT NULL,
  cpu_pct REAL NOT NULL, mem_pct REAL NOT NULL, status TEXT NOT NULL,
  services TEXT NOT NULL, autoscale INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY, description TEXT NOT NULL,
  applies_env TEXT NOT NULL, applies_category TEXT NOT NULL,
  max_severity_autonomous TEXT NOT NULL, allowed_actions TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, category TEXT NOT NULL, server TEXT NOT NULL,
  resolution_action TEXT NOT NULL, outcome TEXT NOT NULL, text TEXT NOT NULL,
  embedding BLOB
);
CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY, alert_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL,
  body TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
`;

const NOW = '2026-10-19T00:00:00.000Z';

const SERVERS = [
    ['prod-01', 'prod', 'high', 99, 71, 'degraded', ['api', 'worker'], 1],
    ['prod-02', 'prod', 'medium', 35, 48, 'ok', ['api'], 0],
    ['stg-01', 'stg', 'low', 12, 30, 'down', ['web'], 1],
    ['dev-01', 'dev', 'low', 20, 25, 'ok', ['web'], 0],
] as const;

const ALL_WRITE: Action[] = ['restart_service', 'scale_cpu', 'open_ticket', 'update_ticket', 'escalate', 'no_action'];

const POLICIES: PolicyRow[] = [
    {
        id: 'P-01', description: 'dev/stg: acciones de remediación permitidas de forma autónoma',
        applies_env: 'dev,stg', applies_category: '*', max_severity_autonomous: 'critical',
        allowed_actions: ALL_WRITE,
    },
    {
        id: 'P-02', description: 'prod + CPU: sin reinicio autónomo; escalar capacidad o escalar a humano',
        applies_env: 'prod', applies_category: 'cpu', max_severity_autonomous: 'medium',
        allowed_actions: ['scale_cpu', 'escalate', 'open_ticket', 'update_ticket', 'no_action'],
    },
    {
        id: 'P-03', description: 'prod (otras categorías): reinicio solo con severidad <= medium sin aprobación',
        applies_env: 'prod', applies_category: 'memory,disk,network,service_down,other', max_severity_autonomous: 'medium',
        allowed_actions: ['restart_service', 'escalate', 'open_ticket', 'update_ticket', 'no_action'],
    },
];

const INCIDENTS: Array<Omit<IncidentRow, 'embedding'>> = [
    { id: 'INC-014', title: 'CPU saturada en nodo API de producción', category: 'cpu', server: 'prod-09',
      resolution_action: 'scale_cpu', outcome: 'resuelto: +2 vCPU, CPU bajó a 55%',
      text: 'CPU al 98% sostenida en servidor de producción api, autoscale habilitado, picos por tráfico' },
    { id: 'INC-021', title: 'CPU alta por proceso worker descontrolado', category: 'cpu', server: 'prod-03',
      resolution_action: 'escalate', outcome: 'escalado a SRE; fuga en worker corregida con hotfix',
      text: 'CPU 99% por worker fuera de control en producción, reinicio no resolvió, requirió hotfix' },
    { id: 'INC-033', title: 'Alerta de CPU transitoria', category: 'cpu', server: 'prod-05',
      resolution_action: 'no_action', outcome: 'falsa alarma, CPU normalizó sola en 3 minutos',
      text: 'Pico de CPU breve durante backup nocturno, autorrecuperado' },
    { id: 'INC-040', title: 'Servicio web caído en staging', category: 'service_down', server: 'stg-02',
      resolution_action: 'restart_service', outcome: 'resuelto: reinicio del servicio web',
      text: 'Servicio web detenido en staging tras despliegue, reinicio lo restauró' },
    { id: 'INC-052', title: 'Disco lleno en base de datos', category: 'disk', server: 'prod-07',
      resolution_action: 'escalate', outcome: 'escalado a DBA; limpieza de logs',
      text: 'Disco al 97% en servidor de base de datos de producción por logs de transacciones' },
    { id: 'INC-058', title: 'Memoria agotada en servicio de colas', category: 'memory', server: 'prod-04',
      resolution_action: 'restart_service', outcome: 'resuelto: reinicio con ventana aprobada',
      text: 'Fuga de memoria en servicio de colas, uso de RAM al 96%, reinicio liberó memoria' },
    { id: 'INC-063', title: 'Ticket recurrente por latencia de red', category: 'network', server: 'prod-02',
      resolution_action: 'update_ticket', outcome: 'ticket existente actualizado con nuevas métricas',
      text: 'Latencia de red intermitente, mismo síntoma ya registrado en ticket abierto' },
];

/** Open (or create) the SQLite DB, apply schema and idempotent seed. */
export function openDb(dbPath: string): Db {
    if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.exec(SCHEMA);
    seed(db);
    return db;
}

function seed(db: Db): void {
    const insServer = db.prepare(
        'INSERT OR IGNORE INTO servers VALUES (?,?,?,?,?,?,?,?,?)',
    );
    const insPolicy = db.prepare('INSERT OR IGNORE INTO policies VALUES (?,?,?,?,?,?)');
    const insInc = db.prepare(
        'INSERT OR IGNORE INTO incidents (id,title,category,server,resolution_action,outcome,text) VALUES (?,?,?,?,?,?,?)',
    );
    db.transaction(() => {
        for (const s of SERVERS) {
            insServer.run(s[0], s[1], s[2], s[3], s[4], s[5], JSON.stringify(s[6]), s[7], NOW);
        }
        for (const p of POLICIES) {
            insPolicy.run(p.id, p.description, p.applies_env, p.applies_category,
                p.max_severity_autonomous, JSON.stringify(p.allowed_actions));
        }
        for (const i of INCIDENTS) {
            insInc.run(i.id, i.title, i.category, i.server, i.resolution_action, i.outcome, i.text);
        }
    })();
}

export function getPolicies(db: Db): PolicyRow[] {
    const rows = db.prepare('SELECT * FROM policies ORDER BY id').all() as Array<
        Omit<PolicyRow, 'allowed_actions'> & { allowed_actions: string }
    >;
    return rows.map(r => ({ ...r, allowed_actions: JSON.parse(r.allowed_actions) as Action[] }));
}

export function getIncidents(db: Db): IncidentRow[] {
    return db.prepare('SELECT * FROM incidents ORDER BY id').all() as IncidentRow[];
}
