/**
 * From a validated design to what a person reads and what a person builds on (SPEC-0040 F0). Deterministic: the same design
 * gives the same text, byte for byte. The model writes none of this code: it writes data, and this turns data into the real API
 * of the framework, so it cannot invent a function that does not exist.
 *
 * Everything the model wrote is untrusted text. In code it only ever appears as a JSON string literal or in a one-line comment
 * with the closing marks defused; in the document it is plain text for the reader to see, and whoever shows it as HTML must escape it.
 */
import type { AgentSpec, DesignSpec, RuleSpec, TestCaseSpec, ToolSpec } from './schema.ts';
import type { Issue } from './validate.ts';

export const DOCS = 'https://backendkit-agent-framework.vercel.app';

export interface GeneratedFile { path: string; content: string }

// ── safe text ──

/** JSON for code. Valid JS, and the two line separators that JSON leaves raw are escaped, so no line of the generated file can end where the model chose. */
const json = (v: unknown): string => JSON.stringify(v).split(String.fromCharCode(0x2028)).join('\\u2028').split(String.fromCharCode(0x2029)).join('\\u2029');
/** A string literal for code. Nothing the model wrote can leave it. */
const lit = (s: string): string => json(s);
/** Text for a `//` comment: one line, no control characters, and the closing mark of a block comment defused. */
const oneLine = (s: string, max = 160): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\*\//g, '* /').trim().slice(0, max);
/** Text for the document: one line, no control characters, and `|` defused so it cannot break a table. Whoever shows the document as HTML must still escape it. */
const plain = (s: string): string => s.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\|/g, '\\|').trim();
const camel = (snake: string): string => snake.replace(/[_-]+([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
/** An identifier derived from a validated name, with a suffix so it never collides with a reserved word. */
const toolConst = (name: string): string => `${camel(name)}Tool`;
const agentConst = (id: string): string => `${camel(id)}Agent`;
const list = (items: string[]): string => `[${items.map(lit).join(', ')}]`;

const TS_TYPE = { string: 'z.string()', number: 'z.number()', boolean: 'z.boolean()' } as const;

// ── facts about a design ──

const destructive = (t: ToolSpec): boolean => t.effect === 'destructive';

export function facts(spec: DesignSpec) {
    const g = spec.governance;
    const hasAsk = g.rules.some(r => r.effect === 'ask') || spec.tools.some(x => x.effect !== 'read');
    return {
        needsApprover: !g.durableApprovals && hasAsk,
        usesRoles: g.rules.some(r => r.approverRoles),
        roles: [...new Set(g.rules.flatMap(r => r.approverRoles ?? []))].sort(),
        usesCredentials: spec.tools.some(t => (t.credentials ?? []).length > 0),
        signed: !!g.audit.signedCheckpoints,
        anchored: g.audit.anchor === 'file',
        hasBudget: !!spec.budget && (spec.budget.perRunUsd !== undefined || spec.budget.perDayUsd !== undefined),
    };
}

/** What a person has to decide before the agent is used: every irreversible tool, every rule, and every risk marked as theirs. */
export function decisionsForAPerson(spec: DesignSpec, warnings: Issue[]): string[] {
    return [
        ...spec.tools.filter(destructive).map(t => `The tool "${t.name}" cannot be undone: who may approve it, and under what conditions.`),
        ...spec.governance.rules.map(r => `The rule "${r.id}" (${r.effect} on "${r.tool}"): ${plain(r.reason)}`),
        ...spec.risks.filter(r => r.needsPersonDecision).map(r => plain(r.text)),
        ...warnings.map(w => `Warning ${w.code}: ${w.message}`),
    ];
}

// ── the document ──

export function renderMarkdown(spec: DesignSpec, warnings: Issue[] = []): string {
    const f = facts(spec);
    const g = spec.governance;
    const out: string[] = [];
    const push = (...lines: string[]) => out.push(...lines);

    push(`# ${plain(spec.title)}`, '', `> A design proposal to review. It is not a finished agent, and a person has to decide what is marked below.`, '');
    push('## Goal', '', plain(spec.goal), '');

    push('## Agents', '', '| Agent | Role | Tools | Delegates to |', '|---|---|---|---|');
    for (const a of spec.agents) push(`| \`${a.id}\` (${plain(a.name)}) | ${plain(a.role)} | ${a.tools.map(t => `\`${t}\``).join(', ') || 'none'} | ${(a.delegatesTo ?? []).map(d => `\`${d}\``).join(', ') || 'none'} |`);
    push('');

    push('## Tools', '', 'What each tool does, declared once so the engine can decide what to allow.', '', '| Tool | What it does | Effect | What the engine does | Arguments | Credentials |', '|---|---|---|---|---|---|');
    for (const t of spec.tools) {
        const does = t.effect === 'read' ? 'runs it without asking' : t.effect === 'destructive' ? 'asks a person, always (cannot be undone)' : 'treated as "may change things": asks unless a rule says otherwise';
        push(`| \`${t.name}\` | ${plain(t.description)} | ${t.effect}${t.idempotent ? ', idempotent' : ''} | ${does} | ${t.input.map(i => `\`${i.name}\`: ${i.type}${i.optional ? '?' : ''} (${plain(i.description)})`).join(', ') || 'none'} | ${(t.credentials ?? []).map(c => `\`${c}\``).join(', ') || 'none'} |`);
    }
    push('');

    push('## Governance', '', 'The rules live in code, outside the model: no prompt can move them.', '');
    if (g.rules.length === 0) push('No rules of its own: read-only tools run, destructive ones ask a person, and the rest ask.', '');
    for (const r of g.rules) {
        const when = r.when ? ` when \`${r.when.field} ${r.when.op} ${String(r.when.value)}\`` : '';
        const extra = [
            r.accepts ? `accepts ${r.accepts.join(' or ')}` : '',
            r.approverRoles ? `approver role: ${r.approverRoles.join(' or ')}` : '',
            r.ttlSeconds !== undefined ? `request expires after ${r.ttlSeconds} s` : '',
        ].filter(Boolean).join('; ');
        push(`- **${r.id}**: \`${r.tool}\`${when} → **${r.effect}**. ${plain(r.reason)}${extra ? ` (${extra})` : ''}`);
    }
    push('');
    push(`- A tool that is not read-only and matches no rule **asks** (a destructive one, a person).`);
    push(`- Four eyes (the person who asked does not approve): **${g.fourEyes ? 'on' : 'off'}**.`);
    push(`- Approvals: **${g.durableApprovals ? 'stored, a person can answer later' : 'answered right away by an approver'}**.`);
    push(`- Credentials: **${f.usesCredentials ? 'leased per call from a broker you provide, after the call is authorized' : 'none needed'}**.`);
    push(`- Audit: **hash-chained**${g.audit.signedCheckpoints ? ', signed checkpoints (Ed25519)' : ''}${f.anchored ? ', anchored in a file' : ''}.${g.audit.signedCheckpoints && !f.anchored ? ' Without an anchor outside the operator\'s reach it is tamper-evident, not proof.' : ''}`);
    push('');

    if (spec.flow) {
        push('## Flow', '', spec.flow.durable ? 'The run survives a restart.' : 'The run does not survive a restart.', '', '| Step | Kind | Uses | What happens |', '|---|---|---|---|');
        for (const s of spec.flow.steps) push(`| \`${s.id}\` | ${s.kind} | ${s.ref ? `\`${s.ref}\`` : '-'} | ${plain(s.description)} |`);
        push('');
    }

    push('## Cost', '', spec.budget ? `Budget: ${spec.budget.perRunUsd !== undefined ? `$${spec.budget.perRunUsd} per run` : ''}${spec.budget.perRunUsd !== undefined && spec.budget.perDayUsd !== undefined ? ', ' : ''}${spec.budget.perDayUsd !== undefined ? `$${spec.budget.perDayUsd} per day` : ''}. The run stops when it is crossed.` : 'No budget. A run that loops will not be stopped by cost.', '');

    push('## How it is tested', '', 'A scripted model asks for what the case says, and the test asserts what happened, not what a real model would say.', '');
    for (const c of spec.testing.cases) push(`- **${c.id}**: "${plain(c.input)}": ${c.expect.map(e => `\`${e.tool}\` ${e.success ? 'runs' : 'does not run'}`).join(', ')}${c.approver ? `, the approver ${c.approver === 'approves' ? 'approves' : c.approver === 'rejects' ? 'rejects' : 'does not answer'}` : ''}.`);
    if (spec.testing.cases.length === 0) push('No cases yet.');
    push('');

    if (spec.risks.length > 0) { push('## Risks', ''); for (const r of spec.risks) push(`- ${r.needsPersonDecision ? '**A person decides.** ' : ''}${plain(r.text)}`); push(''); }

    const decisions = decisionsForAPerson(spec, warnings);
    push('## Decisions for a person', '', 'The framework runs the rules; it does not choose them. Before this agent is used, someone answers these:', '');
    for (const d of decisions) push(`- ${d}`);
    push('');

    push('## How to build it', '');
    push(`1. **Start from the first agent.** [Your first agent](${DOCS}/start/first-agent/) builds one tool, one profile and one engine, offline.`);
    push(`2. **Write the tools** from \`src/tools.ts\`. Each stub says what to implement. [The engine and tools](${DOCS}/concepts/engine-and-tools/).`);
    push(`3. **Check the rules** in \`src/policy.ts\`, then run the tests: \`src/agent.test.ts\` asserts what the design says. [Govern a payment tool](${DOCS}/guides/govern-a-payment-tool/) shows the same shape.`);
    if (f.usesRoles || g.fourEyes) push(`4. **Provide who may approve.** ${f.usesRoles ? `Roles used: ${f.roles.map(r => `\`${r}\``).join(', ')}; the engine checks them against a directory *you* provide. ` : ''}The framework does not authenticate: \`by.id\` must already be verified by your application. [Governance](${DOCS}/concepts/governance/#who-may-approve-roles).`);
    if (f.usesCredentials) push(`${f.usesRoles || g.fourEyes ? '5' : '4'}. **Provide a credential broker.** The framework defines the contract, not an implementation. [Governance](${DOCS}/concepts/governance/#credentials-leased-for-one-call).`);
    if (f.signed) push(`- **Audit evidence.** \`src/evidence.ts\` exports and verifies a signed bundle. [Governance](${DOCS}/concepts/governance/#evidence-a-third-party-can-check).`);
    if (spec.flow) push(`- **The flow.** This skeleton does not generate it. [Flows](${DOCS}/concepts/flows/) and [a durable flow with approval](${DOCS}/guides/durable-flow-with-approval/).`);
    push(`- **Test it properly.** [Test an agent](${DOCS}/guides/test-an-agent/).`);
    push(`- **Cost.** [Observability and cost](${DOCS}/concepts/observability-and-cost/).`);
    push('');
    return `${out.join('\n')}\n`;
}

// ── the skeleton ──

function renderTool(t: ToolSpec, stub: 'throw' | 'echo'): string {
    const fields = t.input.map(i => `    ${i.name}: ${TS_TYPE[i.type]}.describe(${lit(i.description)})${i.optional ? '.optional()' : ''},`).join('\n');
    const flags = [
        t.effect === 'read' ? '  readOnly: true,' : '',
        t.effect === 'destructive' ? '  destructive: true,' : '',
        t.idempotent ? '  idempotent: true,' : '',
        (t.credentials ?? []).length > 0 ? `  credentials: ${list(t.credentials!)},` : '',
    ].filter(Boolean).join('\n');
    const body = stub === 'echo'
        ? `    return ${lit(`TODO: ${t.name} is not implemented yet`)};`
        : `    throw new Error(${lit(`${t.name} is not implemented yet`)});`;
    const hint = (t.credentials ?? []).length > 0 ? `    // ctx.credentials holds the credentials leased for this call: ${t.credentials!.map(c => oneLine(c, 40)).join(', ')}.\n` : '';
    return [
        `export const ${toolConst(t.name)} = defineTool({`,
        `  name: ${lit(t.name)},`,
        `  description: ${lit(t.description)},`,
        ...(flags ? [flags] : []),
        '  input: z.object({',
        ...(fields ? [fields] : []),
        '  }),',
        '  execute: async (_args, _ctx) => {',
        `    // TODO: ${oneLine(t.description)}`,
        hint + body,
        '  },',
        '});',
    ].join('\n');
}

function renderAgent(a: AgentSpec): string {
    return [
        `export const ${agentConst(a.id)}: AgentProfile = {`,
        `  id: ${lit(a.id)},`,
        `  name: ${lit(a.name)},`,
        `  icon: '🤖',`,
        `  description: ${lit(a.role)},`,
        `  systemPrompt: ${lit(`${a.role} Use your tools when they help, and never act beyond them.`)},`,
        `  allowedTools: ${list(a.tools)},`,
        ...((a.delegatesTo ?? []).length > 0 ? [`  delegatesTo: ${list(a.delegatesTo!)},`] : []),
        '};',
    ].join('\n');
}

function renderRule(r: RuleSpec, spec: DesignSpec): string {
    const tool = spec.tools.find(t => t.name === r.tool)!;
    const field = r.when ? tool.input.find(f => f.name === r.when!.field) : undefined;
    const cond = r.when && field
        ? ` && (call.args[${lit(r.when.field)}] as ${field.type}) ${r.when.op === '==' ? '===' : r.when.op === '!=' ? '!==' : r.when.op} ${typeof r.when.value === 'string' ? lit(r.when.value) : String(r.when.value)}`
        : '';
    const accepts = r.accepts ?? (tool.effect === 'destructive' && r.effect === 'ask' ? ['human'] : undefined);
    const parts = [
        `effect: ${lit(r.effect)}`,
        `reason: ${lit(r.reason)}`,
        ...(accepts ? [`accepts: ${list(accepts)}`] : []),
        ...(r.approverRoles ? [`approverRoles: ${list(r.approverRoles)}`] : []),
        ...(r.ttlSeconds !== undefined ? [`ttlSeconds: ${r.ttlSeconds}`] : []),
    ];
    return `    // rule ${oneLine(r.id, 60)}: ${oneLine(r.reason)}\n    if (call.tool.name === ${lit(r.tool)}${cond}) {\n      return { ${parts.join(', ')} };\n    }`;
}

function renderTestCase(c: TestCaseSpec, f: ReturnType<typeof facts>): string {
    const asks = c.modelAsks.map((a, i) => `{ id: ${lit(`call-${i + 1}`)}, name: ${lit(a.tool)}, args: ${json(a.args)} }`).join(', ');
    const answer = c.approver ?? 'nobody';
    const approver = f.needsApprover || answer !== 'nobody' ? [`    approver: approverThat(${lit(answer)}),`] : [];
    return [
        `test(${lit(c.id)}, async () => {`,
        `  // The user says: ${oneLine(c.input)}`,
        '  const engine = createEngine({',
        '    ...testDeps(),',
        ...(c.agent ? [`    agentId: ${lit(c.agent)},`] : []),
        ...approver,
        `    provider: scriptedProvider([{ tool_calls: [${asks}] }, { content: 'done' }]),`,
        '  });',
        `  const result = await engine.run(${lit(c.input)});`,
        `  assert.deepEqual(result.toolCalls.map(c => [c.name, c.success]), ${json(c.expect.map(e => [e.tool, e.success]))});`,
        '});',
    ].join('\n');
}

export function renderSkeleton(spec: DesignSpec, options: { stubs?: 'throw' | 'echo' } = {}): GeneratedFile[] {
    const stub = options.stubs ?? 'throw';
    const g = spec.governance;
    const f = facts(spec);
    const files: GeneratedFile[] = [];

    files.push({
        path: 'src/tools.ts',
        content: [
            `// Generated from the design "${oneLine(spec.title, 80)}". Each tool is a stub: write what it does.`,
            "import { defineTool, z } from '@backendkit-labs/agent-core';",
            '',
            spec.tools.map(t => renderTool(t, stub)).join('\n\n'),
            '',
            `export const tools = [${spec.tools.map(t => toolConst(t.name)).join(', ')}];`,
            '',
        ].join('\n'),
    });

    files.push({
        path: 'src/agents.ts',
        content: [
            "import type { AgentProfile } from '@backendkit-labs/agent-core';",
            '',
            spec.agents.map(renderAgent).join('\n\n'),
            '',
            `export const agents: AgentProfile[] = [${spec.agents.map(a => agentConst(a.id)).join(', ')}];`,
            `export const defaultAgentId = ${lit(spec.agents[0]!.id)};`,
            '',
        ].join('\n'),
    });

    files.push({
        path: 'src/policy.ts',
        content: [
            "import type { ToolPolicy } from '@backendkit-labs/agent-core';",
            '',
            '/**',
            ' * The rules of the design. They live here, not in the prompt, so nothing the model says can move them. A custom policy',
            ' * replaces the default one, so the last lines bring back what the default did: a read-only tool runs, a destructive one asks a',
            ' * person, and anything else that may change things asks.',
            ' */',
            'export const rules: ToolPolicy = {',
            '  decide(_principal, call) {',
            ...spec.governance.rules.map(r => renderRule(r, spec)),
            "    if (call.tool.readOnly) return { effect: 'allow' };",
            "    if (call.tool.destructive) return { effect: 'ask', reason: 'an irreversible action asks a person', accepts: ['human'] };",
            "    return { effect: 'ask', reason: 'a tool that may change things asks' };",
            '  },',
            '};',
            '',
        ].join('\n'),
    });

    const deps: string[] = [
        '  provider: LLMProvider;',
        '  transport: Transport;',
        f.needsApprover ? '  /** Answers an `ask` right away. Required: with none, every ask is refused. */\n  approver: Approver;' : '  /** Answers an `ask` right away, when the design does not store approvals. */\n  approver?: Approver;',
        '  /** Who the agent acts for. Already authenticated by your application. Required: an agent says on whose behalf it acts. */\n  userId: string;',
        '  /** Gives the agent its digital identity. Default: self-asserted (the audit marks it); pass the one of your identity provider to have it vouched for. */\n  agentIdentity?: AgentIdentityProvider;',
        ...(f.usesRoles ? [`  /** Who an approver is and which roles they hold (${f.roles.join(', ')}). From your user system; the framework does not authenticate. */\n  approverDirectory: ApproverDirectory;`] : []),
        ...(f.usesCredentials ? ['  /** Leases the credentials the tools declare, for one authorized call. The framework ships the contract, not an implementation. */\n  credentialBroker: CredentialBroker;'] : []),
        ...(f.signed ? ['  /** PEM of the Ed25519 private key that signs the checkpoints of the audit. Keep it away from whoever writes the log. */\n  auditSigningKeyPem: string;'] : []),
        ...(f.hasBudget ? ["  /** Dollars per million tokens of YOUR model: with a zero price the budget would never trip. */\n  pricing: { inputPerMToken: number; outputPerMToken: number };"] : []),
        '  /** The agent that takes the conversation. Default: the first of the design. */\n  agentId?: string;',
        '  /** Where the audit log and its checkpoints live. Default: ./audit */\n  auditDir?: string;',
        ...(g.durableApprovals ? ['  /** Where pending approvals are stored. Default: ./approvals */\n  approvalsDir?: string;'] : []),
    ];
    const engineImports = [
        'createBaseEngine', 'HashChainAuditSink',
        ...(g.durableApprovals ? ['FileApprovalStore'] : []),
        ...(f.signed ? ['ed25519Signer'] : []),
        'type Approver', ...(f.usesRoles ? ['type ApproverDirectory'] : []), ...(f.usesCredentials ? ['type CredentialBroker'] : []),
        'type LLMProvider', 'type Transport', 'selfAssertedIdentities', 'type AgentIdentityProvider',
    ];
    const budget = spec.budget && f.hasBudget
        ? [
            '    observability: {',
            '      costTracker: {',
            '        inputPricePerMToken: deps.pricing.inputPerMToken,',
            '        outputPricePerMToken: deps.pricing.outputPerMToken,',
            `        budget: { ${[spec.budget.perRunUsd !== undefined ? `perRun: ${spec.budget.perRunUsd}` : '', spec.budget.perDayUsd !== undefined ? `perDay: ${spec.budget.perDayUsd}` : ''].filter(Boolean).join(', ')} },`,
            '      },',
            '    },',
            '    abortOnBudget: true,',
        ]
        : [];
    files.push({
        path: 'src/engine.ts',
        content: [
            `import { ${engineImports.join(', ')} } from '@backendkit-labs/agent-core';`,
            "import { agents, defaultAgentId } from './agents';",
            "import { tools } from './tools';",
            "import { rules } from './policy';",
            '',
            'export interface EngineDeps {',
            ...deps,
            '}',
            '',
            'export function createEngine(deps: EngineDeps) {',
            "  const auditDir = deps.auditDir ?? './audit';",
            '  return createBaseEngine({',
            "    providers: { main: deps.provider }, defaultProvider: 'main',",
            '    agents, defaultAgent: deps.agentId ?? defaultAgentId, tools,',
            "    transport: deps.transport, workingDir: process.cwd(), iterationMode: 'auto', maxIterations: 12,",
            '    policy: rules,',
            '    ...(deps.approver ? { approver: deps.approver } : {}),',
            ...(g.durableApprovals ? ["    approvals: new FileApprovalStore(deps.approvalsDir ?? './approvals'),"] : []),
            '    identity: { userId: deps.userId },',
            '    agentIdentity: deps.agentIdentity ?? selfAssertedIdentities(),',
            ...(g.fourEyes ? ['    forbidSelfApproval: true,'] : []),
            ...(f.usesRoles ? ['    approverDirectory: deps.approverDirectory,'] : []),
            ...(f.usesCredentials ? ['    credentialBroker: deps.credentialBroker,'] : []),
            ...budget,
            '    audit: new HashChainAuditSink(`${auditDir}/audit.log`' + (f.signed
                ? ", { checkpoints: { signer: ed25519Signer(deps.auditSigningKeyPem, 'k1'), path: `${auditDir}/checkpoints.ndjson`, every: 100 } }"
                : '') + '),',
            '  });',
            '}',
            '',
        ].join('\n'),
    });

    if (f.signed) {
        files.push({
            path: 'src/evidence.ts',
            content: [
                "import { anchorAuditLog, exportAuditBundle, fileAnchor, verifyAuditBundle, verifyAuditBundleAnchored } from '@backendkit-labs/agent-core';",
                '',
                '/** Writes a bundle a third party can check. Call it when it matters: end of day, before an audit. */',
                'export async function exportEvidence(options: { auditDir?: string; publicKeyPem: string; outDir: string' + (f.anchored ? '; witnessFile: string' : '') + ' }) {',
                "  const dir = options.auditDir ?? './audit';",
                ...(f.anchored ? [
                    '  // The witness file must be where the operator cannot write: another host, a write-once volume.',
                    '  await anchorAuditLog({ log: `${dir}/audit.log`, anchors: `${dir}/anchors.ndjson`, anchor: fileAnchor(options.witnessFile) });',
                ] : []),
                '  return exportAuditBundle({',
                '    log: `${dir}/audit.log`, checkpoints: `${dir}/checkpoints.ndjson`, publicKeys: { k1: options.publicKeyPem },',
                ...(f.anchored ? ['    anchors: `${dir}/anchors.ndjson`,'] : []),
                '    outDir: options.outDir,',
                '  });',
                '}',
                '',
                '/** What the auditor runs, with the public key and the witness THEY hold, never the ones inside the bundle. */',
                'export async function verifyEvidence(dir: string, trusted: { publicKeyPem: string' + (f.anchored ? '; witnessFile: string' : '') + ' }) {',
                ...(f.anchored
                    ? ["  return verifyAuditBundleAnchored(dir, { trustedKeys: { k1: trusted.publicKeyPem }, anchors: [fileAnchor(trusted.witnessFile)] });"]
                    : ["  return verifyAuditBundle(dir, { trustedKeys: { k1: trusted.publicKeyPem } });"]),
                '}',
                '',
            ].join('\n'),
        });
    }

    const roleList = f.roles;
    files.push({
        path: 'src/agent.test.ts',
        content: [
            "import { test } from 'node:test';",
            "import assert from 'node:assert/strict';",
            "import { mkdtempSync } from 'node:fs';",
            "import { tmpdir } from 'node:os';",
            "import { join } from 'node:path';",
            ...(f.signed ? ["import { generateKeyPairSync } from 'node:crypto';"] : []),
            "import { scriptedProvider, mockTransport } from '@backendkit-labs/agent-testkit';",
            "import type { Approver } from '@backendkit-labs/agent-core';",
            "import { createEngine } from './engine';",
            '',
            '// What a test of this design needs from the application, as stand-ins. Replace them as you build the real ones.',
            'function approverThat(answer: string): Approver {',
            "  const by = { kind: 'human' as const, id: 'approver-1' };",
            "  return { ref: by, request: async () => ({ decision: answer === 'approves' ? 'approve' as const : 'reject' as const, by, at: new Date().toISOString() }) };",
            '}',
            '',
            'function testDeps() {',
            '  return {',
            '    transport: mockTransport().transport,',
            "    auditDir: mkdtempSync(join(tmpdir(), 'agent-audit-')),",
            ...(g.durableApprovals ? ["    approvalsDir: mkdtempSync(join(tmpdir(), 'agent-approvals-')),"] : []),
            "    userId: 'requester-1',",
            ...(f.usesRoles ? [`    approverDirectory: { describe: () => ({ roles: ${list(roleList)} }) },`] : []),
            ...(f.usesCredentials ? ["    credentialBroker: { lease: () => ({ value: 'test-credential', id: 'lease-1' }) },"] : []),
            ...(f.signed ? ["    auditSigningKeyPem: generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),"] : []),
            ...(f.hasBudget ? ['    pricing: { inputPerMToken: 1, outputPerMToken: 1 },'] : []),
            '  };',
            '}',
            '',
            '// A test that expects a tool to run passes once you implement that tool.',
            spec.testing.cases.map(c => renderTestCase(c, f)).join('\n\n') || '// No cases in the design yet.',
            '',
        ].join('\n'),
    });

    return files;
}

/** A code fence longer than any run of backticks in the code, so what the model wrote inside it cannot close it. */
const fenceFor = (content: string): string => {
    const longest = Math.max(0, ...(content.match(/`+/g) ?? []).map(run => run.length));
    return '`'.repeat(Math.max(3, longest + 1));
};

/** The document of {@link renderMarkdown} with the skeleton as an appendix: one file to download that has everything. */
export function renderFullDocument(spec: DesignSpec, warnings: Issue[] = []): string {
    const out: string[] = [renderMarkdown(spec, warnings).trimEnd(), '', '## Skeleton', '', 'A starting point, not finished code: each tool is a stub that throws until you implement it.', ''];
    for (const f of renderSkeleton(spec)) {
        const fence = fenceFor(f.content);
        out.push(`### \`${f.path}\``, '', `${fence}ts`, f.content.trimEnd(), fence, '');
    }
    return `${out.join('\n')}\n`;
}
