/**
 * Validation of a design (SPEC-0040 F0): the schema first, then what a schema cannot say, which is whether the pieces fit
 * together. An error means the design contradicts itself or asks for something the framework cannot do; a warning means it
 * is allowed but a person should look.
 */
import { DesignSchema, type DesignSpec, type ToolSpec } from './schema.ts';

export interface Issue {
    code: string;
    message: string;
    /** Where, in the dotted form of the schema (`tools.2.name`), when it is known. */
    path?: string;
}

export type Validation =
    | { ok: true; spec: DesignSpec; warnings: Issue[] }
    | { ok: false; errors: Issue[] };

const ORDERED = new Set(['>', '>=', '<', '<=']);

export function validateDesign(input: unknown): Validation {
    const parsed = DesignSchema.safeParse(input);
    if (!parsed.success) {
        return {
            ok: false,
            errors: parsed.error.issues.map(i => ({ code: 'SCHEMA', message: i.message, path: i.path.join('.') })),
        };
    }
    const spec = parsed.data;
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const err = (code: string, message: string, path?: string) => errors.push({ code, message, ...(path ? { path } : {}) });
    const warn = (code: string, message: string, path?: string) => warnings.push({ code, message, ...(path ? { path } : {}) });

    // ── names ──
    const toolByName = new Map<string, ToolSpec>();
    spec.tools.forEach((t, i) => {
        if (toolByName.has(t.name)) err('DUPLICATE_TOOL', `the tool "${t.name}" is defined twice`, `tools.${i}.name`);
        toolByName.set(t.name, t);
    });
    const agentIds = new Set<string>();
    spec.agents.forEach((a, i) => {
        if (agentIds.has(a.id)) err('DUPLICATE_AGENT', `the agent "${a.id}" is defined twice`, `agents.${i}.id`);
        agentIds.add(a.id);
    });
    const ruleIds = new Set<string>();
    spec.governance.rules.forEach((r, i) => {
        if (ruleIds.has(r.id)) err('DUPLICATE_RULE', `the rule "${r.id}" is defined twice`, `governance.rules.${i}.id`);
        ruleIds.add(r.id);
    });

    // ── agents ──
    const used = new Set<string>();
    spec.agents.forEach((a, i) => {
        a.tools.forEach((name, j) => {
            used.add(name);
            if (!toolByName.has(name)) err('AGENT_UNKNOWN_TOOL', `the agent "${a.id}" allows the tool "${name}", which is not defined`, `agents.${i}.tools.${j}`);
        });
        (a.delegatesTo ?? []).forEach((to, j) => {
            if (to === a.id) err('SELF_DELEGATION', `the agent "${a.id}" delegates to itself`, `agents.${i}.delegatesTo.${j}`);
            else if (!agentIds.has(to)) err('AGENT_UNKNOWN_DELEGATE', `the agent "${a.id}" delegates to "${to}", which is not defined`, `agents.${i}.delegatesTo.${j}`);
        });
    });
    spec.tools.forEach((t, i) => {
        if (!used.has(t.name)) warn('ORPHAN_TOOL', `no agent may use the tool "${t.name}"`, `tools.${i}.name`);
    });

    // ── rules ──
    const g = spec.governance;
    g.rules.forEach((r, i) => {
        const at = `governance.rules.${i}`;
        const tool = toolByName.get(r.tool);
        if (!tool) { err('RULE_UNKNOWN_TOOL', `the rule "${r.id}" is about the tool "${r.tool}", which is not defined`, `${at}.tool`); return; }
        if (r.when) {
            const field = tool.input.find(f => f.name === r.when!.field);
            if (!field) err('RULE_UNKNOWN_FIELD', `the rule "${r.id}" compares "${r.when.field}", which is not an argument of "${tool.name}"`, `${at}.when.field`);
            else {
                if (ORDERED.has(r.when.op) && field.type !== 'number') err('RULE_BAD_COMPARISON', `the rule "${r.id}" orders "${field.name}", which is a ${field.type}, not a number`, `${at}.when.op`);
                if (typeof r.when.value !== field.type) err('RULE_BAD_COMPARISON', `the rule "${r.id}" compares "${field.name}" (a ${field.type}) with a ${typeof r.when.value}`, `${at}.when.value`);
            }
        }
        if (r.effect !== 'ask' && (r.accepts || r.approverRoles || r.ttlSeconds !== undefined)) {
            err('ASK_ONLY_OPTION', `the rule "${r.id}" is "${r.effect}" but sets who approves or for how long: that only means something for "ask"`, at);
        }
        if (r.approverRoles && !g.approverDirectory) {
            err('ROLES_NEED_DIRECTORY', `the rule "${r.id}" asks for approver roles, so the application has to provide a directory (approverDirectory)`, `${at}.approverRoles`);
        }
        if (r.ttlSeconds !== undefined && !g.durableApprovals) {
            err('TTL_NEEDS_DURABLE', `the rule "${r.id}" sets an expiry, which only applies to stored approvals (durableApprovals)`, `${at}.ttlSeconds`);
        }
        if (tool.effect === 'destructive' && r.effect === 'ask' && r.accepts && !r.accepts.includes('human')) {
            err('DESTRUCTIVE_NEEDS_HUMAN', `the rule "${r.id}" lets no person approve a destructive tool: an irreversible action is a person's`, `${at}.accepts`);
        }
        if (tool.effect === 'destructive' && r.effect === 'allow' && !r.when) {
            warn('DESTRUCTIVE_UNCONDITIONAL_ALLOW', `the rule "${r.id}" always allows the destructive tool "${tool.name}": nothing will ask a person`, at);
        }
    });

    if (g.fourEyes && !g.actsForUser) err('FOUR_EYES_NEEDS_USER', 'four eyes compares who approves with who the agent acts for, so calls must carry the user (actsForUser)', 'governance.fourEyes');
    spec.tools.forEach((t, i) => {
        if (t.credentials && t.credentials.length > 0 && !g.credentialBroker) {
            err('CREDENTIALS_NEED_BROKER', `the tool "${t.name}" needs credentials, so the application has to provide a broker (credentialBroker)`, `tools.${i}.credentials`);
        }
        if (t.credentials && new Set(t.credentials).size !== t.credentials.length) err('DUPLICATE_CREDENTIAL', `the tool "${t.name}" lists a credential twice`, `tools.${i}.credentials`);
        const names = new Set<string>();
        t.input.forEach((f, j) => {
            if (names.has(f.name)) err('DUPLICATE_FIELD', `the tool "${t.name}" has the argument "${f.name}" twice`, `tools.${i}.input.${j}.name`);
            names.add(f.name);
        });
    });

    // ── what a person should look at ──
    for (const t of spec.tools.filter(x => x.effect === 'destructive')) {
        if (!g.rules.some(r => r.tool === t.name)) {
            warn('DESTRUCTIVE_NO_RULE', `the destructive tool "${t.name}" has no rule: it will ask a person every time, so an approver has to be configured`, `tools.${t.name}`);
        }
        const tested = spec.testing.cases.some(c => c.modelAsks.some(a => a.tool === t.name) && c.expect.some(e => e.tool === t.name && !e.success));
        if (!tested) warn('DESTRUCTIVE_NOT_TESTED', `no test shows the destructive tool "${t.name}" being refused`, `tools.${t.name}`);
    }
    if (g.audit.signedCheckpoints && (g.audit.anchor ?? 'none') === 'none') {
        warn('SIGNED_WITHOUT_ANCHOR', 'the audit is signed but not anchored outside the operator\'s reach: it is tamper-evident, not proof, because whoever holds the key could rewrite and sign it again', 'governance.audit');
    }
    if (g.audit.anchor === 'file') {
        warn('ANCHOR_LOCATION', 'a file anchor anchors something only if the file is where the operator cannot write (another host, a write-once volume)', 'governance.audit.anchor');
    }
    if (!spec.budget) warn('NO_BUDGET', 'there is no cost budget: a run that loops will not be stopped by cost', 'budget');
    if (g.rules.some(r => r.approverRoles) && !g.fourEyes) {
        warn('ROLES_WITHOUT_FOUR_EYES', 'a rule asks for approver roles but four eyes is off: the person who asked can approve it if they hold the role', 'governance.fourEyes');
    }

    // ── flow ──
    if (spec.flow) {
        spec.flow.steps.forEach((s, i) => {
            const at = `flow.steps.${i}`;
            if (s.kind === 'agent' && !(s.ref && agentIds.has(s.ref))) err('FLOW_UNKNOWN_REF', `the step "${s.id}" uses the agent "${String(s.ref)}", which is not defined`, `${at}.ref`);
            if (s.kind === 'tool' && !(s.ref && toolByName.has(s.ref))) err('FLOW_UNKNOWN_REF', `the step "${s.id}" uses the tool "${String(s.ref)}", which is not defined`, `${at}.ref`);
            if (s.kind === 'human' && !spec.flow!.durable) err('FLOW_HUMAN_NEEDS_DURABLE', `the step "${s.id}" waits for a person, so the flow has to be durable`, `${at}.kind`);
        });
        const ids = new Set<string>();
        spec.flow.steps.forEach((s, i) => { if (ids.has(s.id)) err('DUPLICATE_STEP', `the step "${s.id}" is defined twice`, `flow.steps.${i}.id`); ids.add(s.id); });
    }

    // ── tests ──
    spec.testing.cases.forEach((c, i) => {
        const at = `testing.cases.${i}`;
        const runner = spec.agents.find(a => a.id === (c.agent ?? spec.agents[0]!.id));
        if (!runner) err('TEST_UNKNOWN_AGENT', `the test "${c.id}" runs on the agent "${String(c.agent)}", which is not defined`, `${at}.agent`);
        c.modelAsks.forEach((a, j) => {
            const tool = toolByName.get(a.tool);
            if (!tool) { err('TEST_UNKNOWN_TOOL', `the test "${c.id}" asks for the tool "${a.tool}", which is not defined`, `${at}.modelAsks.${j}.tool`); return; }
            // A tool the agent may not use is refused whatever the rules say, so a test that expects a refusal would pass for the wrong reason.
            if (runner && !runner.tools.includes(a.tool)) err('TEST_TOOL_NOT_ALLOWED', `the test "${c.id}" runs on "${runner.id}", which may not use the tool "${a.tool}": set the agent of the case`, `${at}.modelAsks.${j}.tool`);
            for (const key of Object.keys(a.args)) {
                if (!tool.input.some(f => f.name === key)) err('TEST_UNKNOWN_ARGUMENT', `the test "${c.id}" gives "${tool.name}" the argument "${key}", which it does not have`, `${at}.modelAsks.${j}.args.${key}`);
            }
        });
        c.expect.forEach((e, j) => {
            if (!toolByName.has(e.tool)) err('TEST_UNKNOWN_TOOL', `the test "${c.id}" expects the tool "${e.tool}", which is not defined`, `${at}.expect.${j}.tool`);
        });
    });
    const caseIds = new Set<string>();
    spec.testing.cases.forEach((c, i) => { if (caseIds.has(c.id)) err('DUPLICATE_CASE', `the test "${c.id}" is defined twice`, `testing.cases.${i}.id`); caseIds.add(c.id); });

    return errors.length > 0 ? { ok: false, errors } : { ok: true, spec, warnings };
}
