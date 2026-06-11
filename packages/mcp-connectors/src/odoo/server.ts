#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runMcpServer, parseCliArgs } from '../shared/server-runner.js';

// ── Auth / session ────────────────────────────────────────────────────────────
//
// Required env vars:
//   ODOO_URL      — e.g. https://mycompany.odoo.com
//   ODOO_DB       — database name
//   ODOO_USER     — login email
//   ODOO_PASSWORD — password (or an API key when Odoo API keys are enabled)

interface OdooSession {
    uid: number;
    sessionId: string;
}

let _session: OdooSession | null = null;

function cfg() {
    const url  = process.env.ODOO_URL?.replace(/\/$/, '');
    const db   = process.env.ODOO_DB;
    const user = process.env.ODOO_USER;
    const pass = process.env.ODOO_PASSWORD;
    if (!url || !db || !user || !pass) {
        throw new Error('Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD');
    }
    return { url, db, user, pass };
}

async function authenticate(): Promise<OdooSession> {
    if (_session) return _session;
    const { url, db, user, pass } = cfg();
    const res = await fetch(`${url}/web/session/authenticate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'call', id: 1,
            params: { db, login: user, password: pass },
        }),
    });
    if (!res.ok) throw new Error(`Odoo auth HTTP ${res.status}`);
    const data = await res.json() as {
        result?: { uid: number; session_id: string };
        error?:  { message: string };
    };
    if (data.error)        throw new Error(`Odoo auth error: ${data.error.message}`);
    if (!data.result?.uid) throw new Error('Odoo auth failed — no uid returned (wrong credentials?)');
    _session = { uid: data.result.uid, sessionId: data.result.session_id };
    return _session;
}

async function odooCall<T>(
    model:  string,
    method: string,
    args:   unknown[],
    kwargs: Record<string, unknown> = {},
): Promise<T> {
    const sess = await authenticate();
    const { url } = cfg();
    const res = await fetch(`${url}/web/dataset/call_kw`, {
        method:  'POST',
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `session_id=${sess.sessionId}`,
        },
        body: JSON.stringify({
            jsonrpc: '2.0', method: 'call', id: Date.now(),
            params: { model, method, args, kwargs },
        }),
    });
    if (!res.ok) throw new Error(`Odoo ${model}.${method} HTTP ${res.status}`);
    const data = await res.json() as {
        result?: T;
        error?:  { message: string; data?: { message?: string } };
    };
    if (data.error) {
        throw new Error(`Odoo ${model}.${method}: ${data.error.data?.message ?? data.error.message}`);
    }
    return data.result as T;
}

// ── Tools ─────────────────────────────────────────────────────────────────────

function buildServer(): McpServer {
    const srv = new McpServer({ name: 'bk-mcp-odoo', version: '0.1.0' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const t = srv.tool.bind(srv) as any;

    t(
        'odoo_employee_create',
        'Create a new employee record in Odoo HR.',
        {
            name:       z.string().describe('Full name'),
            work_email: z.string().email().optional().describe('Work email address'),
            job_title:  z.string().optional().describe('Job title'),
            department: z.string().optional().describe('Department name (partial match)'),
        },
        async ({ name, work_email, job_title, department }: {
            name: string; work_email?: string; job_title?: string; department?: string;
        }) => {
            const vals: Record<string, unknown> = { name };
            if (work_email) vals.work_email = work_email;
            if (job_title)  vals.job_title  = job_title;
            if (department) {
                const ids = await odooCall<number[]>('hr.department', 'search', [[['name', 'ilike', department]]]);
                if (ids.length) vals.department_id = ids[0];
            }
            const id = await odooCall<number>('hr.employee', 'create', [vals]);
            return { content: [{ type: 'text' as const, text: `Employee created. Odoo ID: ${id}` }] };
        },
    );

    t(
        'odoo_employee_get',
        'Retrieve employee records from Odoo by ID or name search.',
        {
            employee_id: z.number().optional().describe('Exact employee ID'),
            name:        z.string().optional().describe('Name filter (partial match)'),
            limit:       z.number().optional().describe('Maximum records to return (default 5)'),
        },
        async ({ employee_id, name, limit }: {
            employee_id?: number; name?: string; limit?: number;
        }) => {
            let domain: unknown[];
            if (employee_id !== undefined) {
                domain = [['id', '=', employee_id]];
            } else if (name) {
                domain = [['name', 'ilike', name]];
            } else {
                domain = [['active', '=', true]];
            }
            const records = await odooCall<Array<Record<string, unknown>>>(
                'hr.employee', 'search_read', [],
                {
                    domain,
                    fields: ['id', 'name', 'work_email', 'job_title', 'department_id', 'active'],
                    limit:  limit ?? 5,
                },
            );
            if (!records.length) {
                return { content: [{ type: 'text' as const, text: 'No employees found.' }] };
            }
            const lines = records.map(r => {
                const dept = (r.department_id as [number, string] | false);
                return [
                    `ID: ${r.id}`,
                    `Name: ${r.name}`,
                    `Title: ${r.job_title ?? '—'}`,
                    `Dept: ${dept ? dept[1] : '—'}`,
                    `Email: ${r.work_email ?? '—'}`,
                ].join(' | ');
            });
            return { content: [{ type: 'text' as const, text: lines.join('\n') }] };
        },
    );

    t(
        'payroll_prepare',
        'Create a draft payroll slip (hr.payslip) for an employee and period.',
        {
            employee_id: z.number().describe('Odoo employee ID'),
            date_from:   z.string().describe('Period start date (YYYY-MM-DD)'),
            date_to:     z.string().describe('Period end date (YYYY-MM-DD)'),
        },
        async ({ employee_id, date_from, date_to }: {
            employee_id: number; date_from: string; date_to: string;
        }) => {
            const payslipId = await odooCall<number>('hr.payslip', 'create', [{
                employee_id,
                date_from,
                date_to,
            }]);
            return {
                content: [{ type: 'text' as const, text: `Payslip created. ID: ${payslipId}  State: draft` }],
            };
        },
    );

    t(
        'payroll_confirm',
        'Compute salary lines and confirm (validate) a payroll slip.',
        {
            payslip_id: z.number().describe('Payslip ID returned by payroll_prepare'),
        },
        async ({ payslip_id }: { payslip_id: number }) => {
            await odooCall<unknown>('hr.payslip', 'compute_sheet',        [[payslip_id]]);
            await odooCall<unknown>('hr.payslip', 'action_payslip_done',  [[payslip_id]]);
            return {
                content: [{ type: 'text' as const, text: `Payslip ${payslip_id} confirmed. State: done` }],
            };
        },
    );

    return srv;
}

// ── Start ─────────────────────────────────────────────────────────────────────

const { httpMode, port } = parseCliArgs();
runMcpServer(buildServer, { httpMode, port, label: 'bk-mcp-odoo' }).catch(err => {
    process.stderr.write(`[bk-mcp-odoo] Fatal: ${(err as Error).message}\n`);
    process.exit(1);
});
