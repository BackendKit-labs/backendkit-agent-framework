import { connect, mockFetch } from './helpers.js';

const ENV_KEYS = [
    'JIRA_HOST', 'JIRA_EMAIL', 'JIRA_TOKEN', 'HUBSPOT_TOKEN',
    'ODOO_URL', 'ODOO_DB', 'ODOO_USER', 'ODOO_PASSWORD',
    'GCAL_ACCESS_TOKEN', 'GCAL_SERVICE_ACCOUNT_KEY',
];
const savedEnv: Record<string, string | undefined> = {};
let restoreFetch: (() => void) | undefined;

beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k]; }
    jest.resetModules(); // connectors cache env/session at module level
});
afterEach(() => {
    restoreFetch?.(); restoreFetch = undefined;
    for (const k of ENV_KEYS) {
        if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
    }
});

function useFetch(handlers: Parameters<typeof mockFetch>[0]) {
    const m = mockFetch(handlers);
    restoreFetch = m.restore;
    return m.calls;
}

describe('jira tools', () => {
    beforeEach(() => {
        process.env.JIRA_HOST = 'acme.atlassian.net';
        process.env.JIRA_EMAIL = 'a@acme.com';
        process.env.JIRA_TOKEN = 'tok';
    });

    it('jira_search formats issues and sends Basic auth + encoded JQL', async () => {
        const calls = useFetch([() => ({ json: { issues: [
            { key: 'P-1', fields: { summary: 'Fix', status: { name: 'Open' }, assignee: { displayName: 'Ana' }, priority: { name: 'High' } } },
            { key: 'P-2', fields: { summary: 'Other', status: { name: 'Done' }, assignee: null, priority: null } },
        ] } })]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('jira_search', { jql: 'project = P AND status = "Open"', limit: 5 });
        expect(r.text).toBe('P-1  [Open]  High  Fix  @Ana\nP-2  [Done]  -  Other  @unassigned');
        expect(calls[0].url).toContain('https://acme.atlassian.net/rest/api/3/search?jql=project%20%3D%20P');
        expect(calls[0].url).toContain('maxResults=5');
        expect(calls[0].headers.Authorization).toBe(`Basic ${Buffer.from('a@acme.com:tok').toString('base64')}`);
        await c.close();
    });

    it('jira_get_issue flattens ADF description and keeps the last 3 comments', async () => {
        const adf = (t: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] });
        const comments = [1, 2, 3, 4].map(n => ({ author: { displayName: `U${n}` }, body: adf(`c${n}`), created: `2026-01-0${n}T00:00:00Z` }));
        useFetch([() => ({ json: { key: 'P-1', fields: {
            summary: 'S', status: { name: 'Open' }, assignee: null, description: adf('hello'), comment: { comments },
        } } })]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('jira_get_issue', { key: 'P-1' });
        expect(r.text).toContain('P-1: S');
        expect(r.text).toContain('hello');
        expect(r.text).toContain('Comments (last 3)');
        expect(r.text).not.toContain('c1');
        expect(r.text).toContain('[U4 · 2026-01-04]: c4');
        await c.close();
    });

    it('jira_create_issue wraps the description as ADF and defaults the type to Task', async () => {
        const calls = useFetch([() => ({ json: { key: 'P-9', id: '99' } })]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('jira_create_issue', { project: 'P', summary: 'New', description: 'details' });
        expect(r.text).toBe('Created P-9 (ID: 99)');
        const body = JSON.parse(calls[0].body!);
        expect(body.fields.issuetype).toEqual({ name: 'Task' });
        expect(body.fields.description.content[0].content[0].text).toBe('details');
        await c.close();
    });

    it('jira_transition matches status case-insensitively and errors listing options otherwise', async () => {
        const calls = useFetch([
            () => ({ json: { transitions: [{ id: '11', name: 'In Progress' }, { id: '31', name: 'Done' }] } }),
            () => ({ status: 204 }),
            () => ({ json: { transitions: [{ id: '11', name: 'In Progress' }] } }),
        ]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        const ok = await c.call('jira_transition', { key: 'P-1', status: 'done' });
        expect(ok.text).toBe('P-1 → "Done"');
        expect(JSON.parse(calls[1].body!)).toEqual({ transition: { id: '31' } });
        const bad = await c.call('jira_transition', { key: 'P-1', status: 'Nope' });
        expect(bad.isError).toBe(true);
        expect(bad.text).toContain('Options: In Progress');
        await c.close();
    });

    it('surfaces HTTP errors from the API as tool errors', async () => {
        useFetch([() => ({ status: 403, text: 'forbidden' })]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('jira_add_comment', { key: 'P-1', body: 'x' });
        expect(r.isError).toBe(true);
        expect(r.text).toContain('403');
        await c.close();
    });
});

describe('hubspot tools', () => {
    beforeEach(() => { process.env.HUBSPOT_TOKEN = 'hs-tok'; });

    it('crm_search_contacts posts the query with Bearer auth', async () => {
        const calls = useFetch([() => ({ json: { results: [{ id: '1', properties: { firstname: 'Ana', lastname: 'P', email: 'a@x.com', company: 'X' } }] } })]);
        const { buildServer } = await import('../hubspot/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('crm_search_contacts', { query: 'ana' });
        expect(r.text).toContain('ID:1');
        expect(r.text).toContain('<a@x.com>');
        expect(calls[0].headers.Authorization).toBe('Bearer hs-tok');
        expect(JSON.parse(calls[0].body!)).toMatchObject({ query: 'ana', limit: 10 });
        await c.close();
    });

    it('crm_search_contacts reports an empty result', async () => {
        useFetch([() => ({ json: { results: [] } })]);
        const { buildServer } = await import('../hubspot/tools.js');
        const c = await connect(buildServer());
        expect((await c.call('crm_search_contacts', { query: 'zz' })).text).toBe('No contacts found.');
        await c.close();
    });

    it('crm_create_contact drops empty properties', async () => {
        const calls = useFetch([() => ({ json: { id: '42' } })]);
        const { buildServer } = await import('../hubspot/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('crm_create_contact', { email: 'a@x.com', firstname: '', company: 'X' });
        expect(r.text).toBe('Created contact ID: 42');
        expect(JSON.parse(calls[0].body!)).toEqual({ properties: { email: 'a@x.com', company: 'X' } });
        await c.close();
    });
});

describe('odoo tools', () => {
    beforeEach(() => {
        process.env.ODOO_URL = 'https://odoo.example.com/';
        process.env.ODOO_DB = 'db';
        process.env.ODOO_USER = 'u@x.com';
        process.env.ODOO_PASSWORD = 'pw';
    });
    const auth = () => ({ json: { result: { uid: 7, session_id: 'sess-1' } } });

    it('authenticates once, strips the trailing slash and sends the session cookie', async () => {
        const calls = useFetch([auth, () => ({ json: { result: 5 } }), () => ({ json: { result: 6 } })]);
        const { buildServer } = await import('../odoo/tools.js');
        const c = await connect(buildServer());
        await c.call('payroll_prepare', { employee_id: 1, date_from: '2026-01-01', date_to: '2026-01-31' });
        await c.call('payroll_prepare', { employee_id: 1, date_from: '2026-02-01', date_to: '2026-02-28' });
        expect(calls.map(x => x.url)).toEqual([
            'https://odoo.example.com/web/session/authenticate',
            'https://odoo.example.com/web/dataset/call_kw',
            'https://odoo.example.com/web/dataset/call_kw',
        ]);
        expect(calls[1].headers.Cookie).toBe('session_id=sess-1');
        await c.close();
    });

    it('re-authenticates once when the session expired server-side', async () => {
        const calls = useFetch([
            auth,
            () => ({ json: { error: { code: 100, message: 'Odoo Session Expired' } } }),
            () => ({ json: { result: { uid: 7, session_id: 'sess-2' } } }),
            () => ({ json: { result: 77 } }),
        ]);
        const { buildServer } = await import('../odoo/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('payroll_prepare', { employee_id: 1, date_from: 'a', date_to: 'b' });
        expect(r.text).toContain('Payslip created. ID: 77');
        expect(calls[3].headers.Cookie).toBe('session_id=sess-2');
        await c.close();
    });

    it('odoo_employee_create resolves the department by name', async () => {
        const calls = useFetch([auth, () => ({ json: { result: [12] } }), () => ({ json: { result: 100 } })]);
        const { buildServer } = await import('../odoo/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('odoo_employee_create', { name: 'Ana', department: 'Sales' });
        expect(r.text).toBe('Employee created. Odoo ID: 100');
        const create = JSON.parse(calls[2].body!).params;
        expect(create.model).toBe('hr.employee');
        expect(create.args[0]).toEqual({ name: 'Ana', department_id: 12 });
        await c.close();
    });

    it('odoo_employee_get formats records and the no-department case', async () => {
        useFetch([auth, () => ({ json: { result: [
            { id: 1, name: 'Ana', work_email: 'a@x.com', job_title: 'Dev', department_id: [3, 'R&D'] },
            { id: 2, name: 'Bo', department_id: false },
        ] } })]);
        const { buildServer } = await import('../odoo/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('odoo_employee_get', { name: 'a' });
        expect(r.text).toBe('ID: 1 | Name: Ana | Title: Dev | Dept: R&D | Email: a@x.com\nID: 2 | Name: Bo | Title: — | Dept: — | Email: —');
        await c.close();
    });

    it('fails with a clear message when env vars are missing', async () => {
        delete process.env.ODOO_PASSWORD;
        useFetch([]);
        const { buildServer } = await import('../odoo/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('payroll_confirm', { payslip_id: 1 });
        expect(r.isError).toBe(true);
        expect(r.text).toContain('Set ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD');
        await c.close();
    });
});

describe('gcal tools', () => {
    it('uses the static access token and formats events', async () => {
        process.env.GCAL_ACCESS_TOKEN = 'gtok';
        const calls = useFetch([() => ({ json: { items: [
            { id: 'e1', summary: 'Standup', start: { dateTime: '2026-10-21T09:00:00Z' }, end: { dateTime: '2026-10-21T09:15:00Z' }, attendees: [{ email: 'a', responseStatus: 'accepted' }] },
            { id: 'e2', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } },
        ] } })]);
        const { buildServer } = await import('../gcal/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('calendar_list_events', { calendar_id: 'a@b.com', limit: 2 });
        expect(r.text).toBe('[2026-10-21T09:00 – 09:15] Standup  (1 attendees)\n[2026-10-22 – 2026-10-23] (no title)');
        expect(calls[0].url).toContain('/calendars/a%40b.com/events?');
        expect(calls[0].headers.Authorization).toBe('Bearer gtok');
        await c.close();
    });

    it('errors when no credentials are configured', async () => {
        useFetch([]);
        const { buildServer } = await import('../gcal/tools.js');
        const c = await connect(buildServer());
        const r = await c.call('calendar_list_calendars');
        expect(r.isError).toBe(true);
        expect(r.text).toContain('GCAL_SERVICE_ACCOUNT_KEY');
        await c.close();
    });
});

describe('ids that go into the URL path are checked (audit C-13)', () => {
    it('jira refuses a key that would change the request, and sends none of it', async () => {
        process.env.JIRA_HOST = 'acme.atlassian.net'; process.env.JIRA_EMAIL = 'a@acme.com'; process.env.JIRA_TOKEN = 'tok';
        const calls = useFetch([() => ({ json: {} })]);
        const { buildServer } = await import('../jira/tools.js');
        const c = await connect(buildServer());
        for (const key of ['P-1?expand=all', '../../myself', 'P-1/comment', 'P-1#x']) {
            expect((await c.call('jira_get_issue', { key })).isError).toBe(true);
        }
        expect(calls).toHaveLength(0);
        await c.close();
    });

    it('hubspot refuses a contact id that is not numeric', async () => {
        process.env.HUBSPOT_TOKEN = 'tok';
        const calls = useFetch([() => ({ json: {} })]);
        const { buildServer } = await import('../hubspot/tools.js');
        const c = await connect(buildServer());
        expect((await c.call('crm_get_contact', { id: '1?properties=x&archived=true' })).isError).toBe(true);
        expect(calls).toHaveLength(0);
        await c.close();
    });
});
