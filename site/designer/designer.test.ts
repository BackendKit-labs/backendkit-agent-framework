/**
 * The designer, with no model (SPEC-0040 F0): hand-written designs go through the schema and the validation, and come out as a
 * document and a skeleton. Run with `node --test site/designer/` (Node 24 strips the types itself).
 */
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { validateDesign, type Issue } from './validate.ts';
import { DOCS, decisionsForAPerson, renderMarkdown, renderSkeleton } from './render.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const docsDir = join(here, '..', 'src', 'content', 'docs');

export const FIXTURES = ['refunds', 'support-triage', 'report-readonly', 'invoice-reconciliation', 'injection'] as const;
type Fixture = (typeof FIXTURES)[number];

const load = (name: Fixture): any => JSON.parse(readFileSync(join(here, 'fixtures', `${name}.json`), 'utf8'));
const mutate = (name: Fixture, fn: (d: any) => void): any => { const d = structuredClone(load(name)); fn(d); return d; };
const codes = (issues: Issue[]): string[] => issues.map(i => i.code);

function errorsOf(design: unknown): Issue[] {
    const v = validateDesign(design);
    assert.equal(v.ok, false, 'the design should have been refused');
    return v.ok ? [] : v.errors;
}
function warningsOf(design: unknown): Issue[] {
    const v = validateDesign(design);
    assert.equal(v.ok, true, v.ok ? '' : JSON.stringify(v.errors));
    return v.ok ? v.warnings : [];
}

describe('the hand-written designs', () => {
    const expectedWarnings: Record<Fixture, string[]> = {
        refunds: ['ANCHOR_LOCATION'],
        'support-triage': [],
        'report-readonly': ['NO_BUDGET'],
        'invoice-reconciliation': ['SIGNED_WITHOUT_ANCHOR'],
        injection: [],
    };
    for (const name of FIXTURES) {
        test(`${name} is valid, with exactly the warnings a person should read`, () => {
            assert.deepEqual(codes(warningsOf(load(name))), expectedWarnings[name]);
        });
    }
});

describe('the schema refuses what the framework cannot say', () => {
    test('an unknown key anywhere', () => {
        assert.ok(codes(errorsOf(mutate('refunds', d => { d.surprise = true; }))).includes('SCHEMA'));
        assert.ok(codes(errorsOf(mutate('refunds', d => { d.tools[0].readOnly = true; }))).includes('SCHEMA'));
    });

    test('names that could carry code: a tool, an agent, an argument', () => {
        for (const bad of ['a"; process.exit(1); //', 'Has Space', 'UPPER', '1leading', '', 'x'.repeat(60)]) {
            assert.ok(errorsOf(mutate('refunds', d => { d.tools[0].name = bad; })).length > 0, `tool name ${JSON.stringify(bad)}`);
            assert.ok(errorsOf(mutate('refunds', d => { d.agents[0].id = bad; })).length > 0, `agent id ${JSON.stringify(bad)}`);
            assert.ok(errorsOf(mutate('refunds', d => { d.tools[0].input[0].name = bad; })).length > 0, `argument ${JSON.stringify(bad)}`);
        }
    });

    test('an effect, a comparison, a kind or a version outside the vocabulary', () => {
        assert.ok(errorsOf(mutate('refunds', d => { d.tools[0].effect = 'delete'; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.governance.rules[0].when.op = 'matches'; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.governance.rules[1].accepts = ['robot']; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.version = 2; })).length > 0);
    });

    test('numbers that make no sense, and empty lists that must not be empty', () => {
        assert.ok(errorsOf(mutate('refunds', d => { d.governance.rules[1].ttlSeconds = 0; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.governance.rules[1].ttlSeconds = 1.5; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.budget.perRunUsd = -1; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.agents = []; })).length > 0);
        assert.ok(errorsOf(mutate('refunds', d => { d.governance.rules[1].approverRoles = []; })).length > 0);
    });

    test('not an object at all', () => {
        for (const bad of [null, undefined, 'a design', 42, [], {}]) assert.ok(errorsOf(bad).length > 0);
    });
});

describe('the validation refuses a design that contradicts itself', () => {
    const cases: Array<[string, Fixture, (d: any) => void]> = [
        ['DUPLICATE_TOOL', 'refunds', d => { d.tools.push(structuredClone(d.tools[0])); }],
        ['DUPLICATE_AGENT', 'refunds', d => { d.agents.push(structuredClone(d.agents[0])); }],
        ['DUPLICATE_RULE', 'refunds', d => { d.governance.rules.push(structuredClone(d.governance.rules[0])); }],
        ['DUPLICATE_FIELD', 'refunds', d => { d.tools[0].input.push(structuredClone(d.tools[0].input[0])); }],
        ['DUPLICATE_CREDENTIAL', 'invoice-reconciliation', d => { d.tools[3].credentials = ['treasury', 'treasury']; }],
        ['DUPLICATE_STEP', 'invoice-reconciliation', d => { d.flow.steps.push(structuredClone(d.flow.steps[0])); }],
        ['DUPLICATE_CASE', 'refunds', d => { d.testing.cases.push(structuredClone(d.testing.cases[0])); }],
        ['AGENT_UNKNOWN_TOOL', 'refunds', d => { d.agents[0].tools.push('ghost_tool'); }],
        ['AGENT_UNKNOWN_DELEGATE', 'refunds', d => { d.agents[0].delegatesTo = ['nobody']; }],
        ['SELF_DELEGATION', 'refunds', d => { d.agents[0].delegatesTo = ['support']; }],
        ['RULE_UNKNOWN_TOOL', 'refunds', d => { d.governance.rules[0].tool = 'ghost_tool'; }],
        ['RULE_UNKNOWN_FIELD', 'refunds', d => { d.governance.rules[0].when.field = 'nonsense'; }],
        ['RULE_BAD_COMPARISON', 'refunds', d => { d.governance.rules[0].when.field = 'orderId'; }],         // ordering a string
        ['RULE_BAD_COMPARISON', 'refunds', d => { d.governance.rules[0].when.value = 'fifty'; }],           // a string against a number
        ['ASK_ONLY_OPTION', 'refunds', d => { d.governance.rules[0].approverRoles = ['finance']; }],        // on an allow
        ['ROLES_NEED_DIRECTORY', 'refunds', d => { d.governance.approverDirectory = false; }],
        ['TTL_NEEDS_DURABLE', 'refunds', d => { d.governance.durableApprovals = false; }],
        ['DESTRUCTIVE_NEEDS_HUMAN', 'refunds', d => { d.governance.rules[1].accepts = ['agent']; }],
        ['FOUR_EYES_NEEDS_USER', 'refunds', d => { d.governance.actsForUser = false; }],
        ['CREDENTIALS_NEED_BROKER', 'refunds', d => { d.governance.credentialBroker = false; }],
        ['FLOW_HUMAN_NEEDS_DURABLE', 'invoice-reconciliation', d => { d.flow.durable = false; }],
        ['FLOW_UNKNOWN_REF', 'invoice-reconciliation', d => { d.flow.steps[0].ref = 'ghost'; }],
        ['TEST_UNKNOWN_TOOL', 'refunds', d => { d.testing.cases[0].modelAsks[0].tool = 'ghost_tool'; }],
        ['TEST_UNKNOWN_TOOL', 'refunds', d => { d.testing.cases[0].expect[0].tool = 'ghost_tool'; }],
        ['TEST_UNKNOWN_ARGUMENT', 'refunds', d => { d.testing.cases[0].modelAsks[0].args.nonsense = 1; }],
        ['TEST_UNKNOWN_AGENT', 'refunds', d => { d.testing.cases[1].agent = 'ghost-agent'; }],
        // The first agent may not refund: a case that does not say which agent runs it would be refused for that reason, and a test that expects a
        // refusal would pass without proving anything about the rules.
        ['TEST_TOOL_NOT_ALLOWED', 'refunds', d => { delete d.testing.cases[1].agent; }],
    ];
    for (const [code, fixture, change] of cases) {
        test(`${code}: ${JSON.stringify(change.toString().slice(0, 70))}`, () => {
            assert.ok(codes(errorsOf(mutate(fixture, change))).includes(code));
        });
    }
});

describe('what is allowed but a person should read', () => {
    const cases: Array<[string, Fixture, (d: any) => void]> = [
        ['ORPHAN_TOOL', 'refunds', d => { d.agents[0].tools = ['lookup_order']; d.agents[1].tools = ['lookup_order']; d.testing.cases = d.testing.cases.filter((c: any) => c.modelAsks.every((a: any) => a.tool === 'lookup_order')); }],
        ['DESTRUCTIVE_NO_RULE', 'refunds', d => { d.governance.rules = d.governance.rules.filter((r: any) => r.tool !== 'refund_order'); delete d.governance.approverDirectory; delete d.governance.durableApprovals; }],
        ['DESTRUCTIVE_UNCONDITIONAL_ALLOW', 'refunds', d => { delete d.governance.rules[0].when; }],
        ['DESTRUCTIVE_NOT_TESTED', 'refunds', d => { d.testing.cases = d.testing.cases.filter((c: any) => c.expect.every((e: any) => e.success)); }],
        ['SIGNED_WITHOUT_ANCHOR', 'refunds', d => { d.governance.audit.anchor = 'none'; }],
        ['NO_BUDGET', 'refunds', d => { delete d.budget; }],
        ['ROLES_WITHOUT_FOUR_EYES', 'refunds', d => { d.governance.fourEyes = false; }],
    ];
    for (const [code, fixture, change] of cases) {
        test(code, () => assert.ok(codes(warningsOf(mutate(fixture, change))).includes(code)));
    }

    test('an unsigned audit does not claim to be anchored, and a signed one that is not says it is weaker', () => {
        const w = warningsOf(load('invoice-reconciliation')).find(x => x.code === 'SIGNED_WITHOUT_ANCHOR')!;
        assert.match(w.message, /tamper-evident, not proof/);
    });
});

describe('the document', () => {
    const rendered = (name: Fixture) => {
        const v = validateDesign(load(name));
        assert.ok(v.ok);
        return { md: renderMarkdown(v.spec, v.warnings), spec: v.spec, warnings: v.warnings };
    };

    test('is deterministic: the same design gives the same text, byte for byte', () => {
        for (const name of FIXTURES) assert.equal(rendered(name).md, rendered(name).md);
    });

    test('says it is a proposal to review, and never that it is ready for production', () => {
        for (const name of FIXTURES) {
            const { md } = rendered(name);
            assert.match(md, /A design proposal to review/);
            assert.doesNotMatch(md, /production[- ]ready|ready for production|guaranteed|fully secure/i);
        }
    });

    test('puts every irreversible tool, every rule and every risk that is a person\'s under "Decisions for a person"', () => {
        for (const name of FIXTURES) {
            const { md, spec, warnings } = rendered(name);
            const section = md.slice(md.indexOf('## Decisions for a person'), md.indexOf('## How to build it'));
            for (const t of spec.tools.filter(x => x.effect === 'destructive')) assert.ok(section.includes(`"${t.name}" cannot be undone`), `${name}: ${t.name}`);
            for (const r of spec.governance.rules) assert.ok(section.includes(`The rule "${r.id}"`), `${name}: ${r.id}`);
            assert.equal(decisionsForAPerson(spec, warnings).length, section.split('\n').filter(l => l.startsWith('- ')).length);
        }
    });

    test('carries the warnings into the decisions', () => {
        assert.match(rendered('invoice-reconciliation').md, /Warning SIGNED_WITHOUT_ANCHOR/);
    });

    test('shows the new governance: roles, four eyes, expiry, credentials, signed and anchored audit', () => {
        const { md } = rendered('refunds');
        assert.match(md, /approver role: finance/);
        assert.match(md, /Four eyes .*\*\*on\*\*/);
        assert.match(md, /request expires after 3600 s/);
        assert.match(md, /leased per call from a broker/);
        assert.match(md, /signed checkpoints \(Ed25519\), anchored in a file/);
        assert.match(md, /Budget: \$0.5 per run, \$25 per day/);
    });

    test('says what a read-only design leaves out', () => {
        const { md } = rendered('report-readonly');
        assert.match(md, /No rules of its own/);
        assert.match(md, /No budget\. A run that loops will not be stopped by cost/);
        assert.match(md, /Credentials: \*\*none needed\*\*/);
    });

    test('every link points to a page and an anchor that exist in these docs', () => {
        const slug = (h: string) => h.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
        const links = new Set<string>();
        for (const name of FIXTURES) for (const m of rendered(name).md.matchAll(/\]\((https:\/\/[^)]+)\)/g)) links.add(m[1]!);
        assert.ok(links.size >= 5);
        for (const link of links) {
            assert.ok(link.startsWith(DOCS), link);
            const [pagePath, anchor] = link.slice(DOCS.length).split('#');
            const base = join(docsDir, pagePath!.replace(/\/$/, ''));
            const file = ['.md', '.mdx'].map(e => base + e).find(existsSync);
            assert.ok(file, `no page for ${link}`);
            if (anchor) {
                const headings = readFileSync(file!, 'utf8').split('\n').filter(l => /^#{2,4} /.test(l)).map(l => slug(l.replace(/^#+ /, '')));
                assert.ok(headings.includes(anchor), `no heading "${anchor}" in ${file}`);
            }
        }
    });

    test('text the model wrote cannot break a table or leave its line', () => {
        const { md } = rendered('injection');
        const unescapedPipes = (l: string) => (l.match(/(?<!\\)\|/g) ?? []).length;
        const lines = md.split('\n');
        for (let i = 0; i < lines.length; i++) {
            if (!lines[i]!.startsWith('|')) continue;
            let start = i;
            while (start > 0 && lines[start - 1]!.startsWith('|')) start -= 1;
            assert.equal(unescapedPipes(lines[i]!), unescapedPipes(lines[start]!), `row ${i + 1} has another number of cells than its header`);
        }
        assert.ok(md.split('\n').some(l => l.includes('Ignore previous instructions.') && l.includes('A heading the model slipped in')), 'the goal stays on one line');
        assert.ok(!md.split('\n').some(l => l.startsWith('# A heading the model slipped in')), 'the model cannot add a heading');
    });
});

describe('the skeleton', () => {
    const files = (name: Fixture, stubs?: 'throw' | 'echo') => {
        const v = validateDesign(load(name));
        assert.ok(v.ok);
        return renderSkeleton(v.spec, stubs ? { stubs } : {});
    };
    const file = (name: Fixture, path: string) => files(name).find(f => f.path === path)?.content ?? '';

    test('is deterministic', () => {
        for (const name of FIXTURES) assert.deepEqual(files(name), files(name));
    });

    test('has the same files for the same shape of design', () => {
        assert.deepEqual(files('refunds').map(f => f.path), ['src/tools.ts', 'src/agents.ts', 'src/policy.ts', 'src/engine.ts', 'src/evidence.ts', 'src/agent.test.ts']);
        assert.deepEqual(files('report-readonly').map(f => f.path), ['src/tools.ts', 'src/agents.ts', 'src/policy.ts', 'src/engine.ts', 'src/agent.test.ts']);
    });

    test('the policy brings back what the default policy did, so a custom one never leaves a destructive tool open', () => {
        for (const name of FIXTURES) {
            const policy = file(name, 'src/policy.ts');
            assert.match(policy, /if \(call\.tool\.readOnly\) return \{ effect: 'allow' \};/);
            assert.match(policy, /if \(call\.tool\.destructive\) return \{ effect: 'ask'[^}]*accepts: \['human'\]/);
        }
    });

    test('a destructive rule that asks always accepts a person, even if the design did not say so', () => {
        const v = validateDesign(mutate('invoice-reconciliation', d => { delete d.governance.rules[1].accepts; }));
        assert.ok(v.ok);
        const policy = renderSkeleton(v.spec).find(f => f.path === 'src/policy.ts')!.content;
        assert.match(policy, /effect: "ask"[^}]*accepts: \["human"\][^}]*approverRoles: \["treasury-lead"\]/);
    });

    test('the engine wires what the design asked for, and only that', () => {
        const refunds = file('refunds', 'src/engine.ts');
        for (const piece of ['forbidSelfApproval: true', 'approverDirectory: deps.approverDirectory', 'credentialBroker: deps.credentialBroker', 'new FileApprovalStore', 'ed25519Signer(deps.auditSigningKeyPem', 'abortOnBudget: true', 'perRun: 0.5, perDay: 25']) {
            assert.ok(refunds.includes(piece), `refunds should have ${piece}`);
        }
        const report = file('report-readonly', 'src/engine.ts');
        for (const piece of ['forbidSelfApproval', 'approverDirectory', 'credentialBroker', 'FileApprovalStore', 'ed25519Signer', 'abortOnBudget']) {
            assert.ok(!report.includes(piece), `the read-only design should not have ${piece}`);
        }
        // every agent says who it is and for whom it acts (SPEC-0044), whatever the design asked
        for (const piece of ['identity: { userId: deps.userId }', 'agentIdentity: deps.agentIdentity ?? selfAssertedIdentities()']) assert.ok(report.includes(piece), `every engine should have ${piece}`);
        assert.match(report, /approver\?: Approver;/);                         // nobody to ask, so no approver is required
        assert.match(file('support-triage', 'src/engine.ts'), /\n {2}approver: Approver;/);   // a write tool asks, so one is required
    });

    test('a budget needs the real price of the model: a zero price would never trip it', () => {
        assert.match(file('refunds', 'src/engine.ts'), /pricing: \{ inputPerMToken: number; outputPerMToken: number \}/);
        assert.doesNotMatch(file('refunds', 'src/engine.ts'), /PricePerMToken: 0\b/);
    });

    test('the keys are never in the code: they are parameters', () => {
        for (const name of FIXTURES) for (const f of files(name)) assert.doesNotMatch(f.content, /BEGIN (PRIVATE|EC PRIVATE|RSA PRIVATE)|sk-[A-Za-z0-9]{10}|api[_-]?key\s*[:=]\s*['"][^'"]/i);
    });

    test('the evidence file exports for the auditor with the public key and the witness they hold', () => {
        const evidence = file('refunds', 'src/evidence.ts');
        assert.match(evidence, /anchorAuditLog/);
        assert.match(evidence, /verifyAuditBundleAnchored\(dir, \{ trustedKeys: \{ k1: trusted\.publicKeyPem \}, anchors: \[fileAnchor\(trusted\.witnessFile\)\] \}\)/);
        assert.match(file('invoice-reconciliation', 'src/evidence.ts'), /verifyAuditBundle\(dir, \{ trustedKeys/);
        assert.doesNotMatch(file('invoice-reconciliation', 'src/evidence.ts'), /anchorAuditLog\(/);
    });

    test('stubs throw by default: an unfinished tool does not look like a working one', () => {
        for (const name of FIXTURES) assert.match(file(name, 'src/tools.ts'), /throw new Error\(".* is not implemented yet"\);/);
        const echo = files('refunds', 'echo').find(f => f.path === 'src/tools.ts')!.content;
        assert.doesNotMatch(echo, /throw new Error/);
    });

    test('nothing the model wrote can leave its string or its comment', () => {
        for (const f of files('injection')) {
            assert.ok(!f.content.includes(String.fromCharCode(0x2028)) && !f.content.includes(String.fromCharCode(0x2029)), `${f.path} has a line separator`);
            for (const line of f.content.split('\n')) {
                const comment = line.trimStart().startsWith('//') ? line : '';
                assert.ok(!/\*\//.test(comment), `${f.path}: a comment carries what the model wrote: ${comment}`);
            }
        }
        // The hostile strings appear, but only as JSON string literals.
        const tools = file('injection', 'src/tools.ts');
        assert.ok(tools.includes(JSON.stringify('x"); process.exit(1); //')));
        assert.ok(!/^\s*process\.exit/m.test(tools));
    });
});
