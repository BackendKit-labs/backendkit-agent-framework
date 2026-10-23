import { FleetConfigError, parseFleet } from '../fleet/schema';

const GOOD = `
fleet: produccion
agents:
  - id: git-analyst
    connector: { kind: protocol, url: http://localhost:3300, apiKey: { env: GIT_ANALYST_KEY } }
    tags: [dev, read-only]
    limits: { maxConcurrent: 2, budgetUsdPerDay: 3, deadlineMs: 600000 }
    health: { intervalSec: 30, timeoutMs: 3000 }
    access: { roles: [dev, ops], approval: never }
  - id: ledger
    connector: { kind: in-process }
    access: { approval: always, capabilities: { post_entry: { roles: [accountant], approval: always } } }
policies:
  approval: { default: ask }
  budget: { perRunUsd: 1, perDayUsd: 20 }
`;

function issues(text: string): Array<{ path: string; message: string }> {
    try { parseFleet(text); } catch (e) { return (e as FleetConfigError).issues; }
    throw new Error('expected the file to be refused');
}

describe('fleet.yaml', () => {
    it('accepts the documented example', () => {
        const fleet = parseFleet(GOOD);
        expect(fleet.fleet).toBe('produccion');
        expect(fleet.agents.map(a => a.id)).toEqual(['git-analyst', 'ledger']);
    });

    it('names the path of every error', () => {
        const found = issues(`
fleet: x
agents:
  - id: a
    connector: { kind: protocol, url: not-a-url }
  - id: b
    connector: { kind: carrier-pigeon }
`);
        expect(found.map(i => i.path)).toEqual(expect.arrayContaining(['agents.0.connector.url', 'agents.1.connector.kind']));
    });

    it('refuses a credential written in the file: keys are references', () => {
        const found = issues(`
fleet: x
agents:
  - id: a
    connector: { kind: protocol, url: http://localhost:1, apiKey: sk-live-1234 }
`);
        expect(found[0].path).toBe('agents.0.connector.apiKey');
        expect(found[0].message).toContain('{ env: NAME }');
    });

    it('refuses duplicate ids, unknown keys (typos) and an empty fleet', () => {
        expect(issues('fleet: x\nagents:\n  - { id: a, connector: { kind: in-process } }\n  - { id: a, connector: { kind: in-process } }\n')[0])
            .toEqual({ path: 'agents.1.id', message: 'duplicate agent id "a"' });
        expect(issues('fleet: x\nagents:\n  - { id: a, connector: { kind: in-process }, acess: { roles: [x] } }\n')[0].path).toBe('agents.0');
        expect(issues('fleet: x\nagents: []\n')[0].path).toBe('agents');
    });

    it('reports YAML syntax errors with their line', () => {
        const found = issues('fleet: x\nagents:\n  - id: a\n   bad: indent\n');
        expect(found[0].path).toMatch(/^line \d+$/);
    });

    it('an id cannot start with a symbol or contain a path', () => {
        expect(issues('fleet: x\nagents:\n  - { id: "../x", connector: { kind: in-process } }\n')[0].path).toBe('agents.0.id');
    });
});
