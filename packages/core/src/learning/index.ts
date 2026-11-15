import { createHash, randomUUID } from 'node:crypto';
import { InMemoryStore } from '../agent-memory/stores/InMemoryStore';
import { MemoryApprovalStore } from '../governance/approval-store';
import { combineDecisions } from '../governance/policy';
import type { ApproverRef, AuditEvent, PolicyDecision, ToolPolicy } from '../governance/types';
import { composeInstructionLayers, sanitizeDiskContent } from '../sources';
import { MemoryRuleStore } from './stores';
import type {
    ApprovedRule, Experience, ExperienceInput, LearnedPattern, Learning, LearningOptions, Severity, ToolRule,
} from './types';

export { FileRuleStore, MemoryRuleStore } from './stores';
export type {
    ApprovedRule, Experience, ExperienceInput, LearnedPattern, Learning, LearningOptions, RuleStore, Severity, ToolRule,
} from './types';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const TOOL_FAILURES = new Set(['tool_error', 'tool_timeout', 'tool_too_large']);
const PROPOSER = { agentId: 'learning', sessionId: 'learning', chain: ['learning'] };

const patternKey = (e: Pick<Experience, 'domain' | 'kind' | 'subject'>): string =>
    `${e.domain}:${e.kind}:${e.subject ?? ''}`;

/** Patterns never mix tenants: the group is the tenant plus the pattern key. */
const groupKey = (e: Pick<Experience, 'tenantId' | 'domain' | 'kind' | 'subject'>): string =>
    `${e.tenantId ?? ''}\u0000${patternKey(e)}`;

const proposalId = (key: string): string => `learn-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;

// Sanitized on its own: the text comes from a tool or a policy, and inside a lesson line a role prefix would not be
// at the start of the line, where the sanitizer of the whole layer looks for it.
const oneLine = (text: string, max: number): string =>
    sanitizeDiskContent(text.replace(/\s+/g, ' ').trim()).trim().slice(0, max);

/** The experience a tool call leaves, or `undefined` when there is nothing to learn from it (a success). */
function experienceFromAudit(event: AuditEvent): ExperienceInput | undefined {
    let kind: string | undefined;
    let severity: Severity = 'medium';
    switch (event.decision) {
        case 'deny': kind = 'policy_denied'; break;
        case 'guardrail_blocked': kind = 'guardrail_blocked'; break;
        case 'sandbox_denied': kind = 'sandbox_denied'; break;
        case 'not_found': kind = 'tool_not_found'; severity = 'low'; break;
        case 'not_allowed': kind = 'tool_not_allowed'; severity = 'low'; break;
        default:
            if (event.outcome === 'error') kind = 'tool_error';
            else if (event.outcome === 'timeout') kind = 'tool_timeout';
            else if (event.outcome === 'too_large') { kind = 'tool_too_large'; severity = 'low'; }
    }
    if (!kind) return undefined;
    return {
        at: event.at,
        agentId: event.principal.agentId,
        ...(event.principal.tenantId ? { tenantId: event.principal.tenantId } : {}),
        domain: 'tool',
        subject: event.tool,
        situation: `calling ${event.tool}`,
        action: `${event.tool}#${event.argsHash.slice(0, 8)}`,
        kind,
        severity,
        ...(event.reason ? { detail: event.reason } : {}),
    };
}

function detectPatterns(experiences: Experience[], threshold: (sample: Experience) => number): LearnedPattern[] {
    const groups = new Map<string, Experience[]>();
    for (const e of experiences) {
        if (e.outcome !== 'failure') continue;
        const key = groupKey(e);
        const group = groups.get(key);
        if (group) group.push(e); else groups.set(key, [e]);
    }
    const patterns: LearnedPattern[] = [];
    for (const group of groups.values()) {
        group.sort((a, b) => a.at.localeCompare(b.at));
        const last = group[group.length - 1];
        if (group.length < threshold(last)) continue;
        patterns.push({
            key: patternKey(last), ...(last.tenantId ? { tenantId: last.tenantId } : {}), domain: last.domain, kind: last.kind, ...(last.subject ? { subject: last.subject } : {}),
            count: group.length,
            firstSeen: group[0].at,
            lastSeen: last.at,
            severity: group.reduce<Severity>((max, e) => SEVERITIES.indexOf(e.severity) > SEVERITIES.indexOf(max) ? e.severity : max, 'low'),
            experienceIds: group.map(e => e.id),
            agentIds: [...new Set(group.map(e => e.agentId))],
            situation: last.situation,
            ...(last.detail ? { detail: last.detail } : {}),
        });
    }
    return patterns.sort((a, b) => b.count - a.count);
}

function isToolRule(value: unknown): value is ToolRule {
    const r = value as Partial<ToolRule> | null;
    return !!r && typeof r === 'object' && typeof r.tool === 'string' && (r.effect === 'ask' || r.effect === 'deny');
}

/**
 * Learning from what happens to the agents (SPEC-0017 F6). Experiences come from the audit events of the tool calls
 * and from whatever a vertical records; the same failure seen `threshold` times becomes a lesson in the prompt of
 * the agent and a proposed rule that waits for a person. Nothing a pattern proposes applies itself.
 *
 * ```ts
 * const learning = createLearning();
 * createBaseEngine({ ..., learning });
 * ```
 */
export function createLearning(options: LearningOptions = {}): Learning {
    const store = options.store ?? new InMemoryStore();
    const approvals = options.approvals ?? new MemoryApprovalStore();
    const rules = options.rules ?? new MemoryRuleStore();
    const base = options.threshold ?? 3;
    const threshold = options.thresholdFor ?? (() => base);
    const maxExperiences = options.maxExperiences ?? 1000;
    const maxChars = options.lessons?.maxChars ?? 1500;
    const maxLessons = options.lessons?.maxLessons ?? 5;
    const approverKinds = options.approverKinds ?? ['human'];
    const ruleFor = options.ruleFor ?? defaultRuleFor;
    const lessonCache = new Map<string, { count: number; text: string | undefined }>();
    // The line of a lesson is written once: a new failure of the same pattern must not change the system prompt.
    const lessonLines = new Map<string, string>();

    function defaultRuleFor(p: LearnedPattern): ToolRule | undefined {
        if (p.domain !== 'tool' || !p.subject || !TOOL_FAILURES.has(p.kind)) return undefined;
        return { tool: p.subject, effect: 'ask', reason: `"${p.subject}" failed ${p.count} times (${p.kind})` };
    }

    const all = (): Experience[] => store.getAll().map(r => {
        const { createdAt: _createdAt, ...rest } = r;
        return rest as unknown as Experience;
    });

    // record() calls run one after another, so two failures at once cannot both propose the same rule.
    let queue: Promise<unknown> = Promise.resolve();
    const serialized = <T>(fn: () => Promise<T>): Promise<T> => {
        const next = queue.then(fn, fn);
        queue = next.catch(() => undefined);
        return next;
    };

    async function propose(experience: Experience): Promise<void> {
        const key = groupKey(experience);
        const pattern = detectPatterns(all().filter(e => groupKey(e) === key), threshold)[0];
        if (!pattern) return;
        const id = proposalId(key);
        if (await approvals.get(id)) return;
        const rule = ruleFor(pattern);
        if (rule === undefined) return;
        await approvals.put({
            id,
            principal: { ...PROPOSER, ...(pattern.tenantId ? { tenantId: pattern.tenantId } : {}) },
            subject: {
                kind: 'rule_proposal',
                rule,
                evidence: `${pattern.count} x ${pattern.kind}${pattern.subject ? ` on ${pattern.subject}` : ''}, ${pattern.firstSeen} to ${pattern.lastSeen}`,
            },
            reason: `Learned from ${pattern.count} repetitions of ${pattern.key}`,
            createdAt: new Date().toISOString(),
        });
    }

    const record = (input: ExperienceInput): Promise<Experience> => serialized(async () => {
        const { at, outcome, severity, ...rest } = input;
        const experience: Experience = {
            ...rest, id: `exp_${randomUUID()}`, at: at ?? new Date().toISOString(),
            outcome: outcome ?? 'failure', severity: severity ?? 'medium',
        };
        store.insert({ ...experience, createdAt: experience.at });
        if (store.count() > maxExperiences) store.deleteOldest(maxExperiences);
        if (experience.outcome === 'failure') await propose(experience);
        return experience;
    });

    async function lessonsFor(agentId: string, tenantId?: string): Promise<string | undefined> {
        const count = store.count();
        const scope = `${tenantId ?? ''}\u0000${agentId}`;
        const cached = lessonCache.get(scope);
        if (cached && cached.count === count) return cached.text;
        const own = all().filter(e => e.agentId === agentId && e.tenantId === tenantId);
        const lines = detectPatterns(own, threshold).slice(0, maxLessons)
            .sort((x, y) => x.key.localeCompare(y.key))
            .map(p => {
                const id = `${scope}\u0000${p.key}`;
                let line = lessonLines.get(id);
                if (!line) {
                    line = `- ${p.subject ? `${p.subject}: ` : ''}${p.kind} keeps happening. ${oneLine(p.situation, 120)}${p.detail ? `: ${oneLine(p.detail, 160)}` : ''}`;
                    lessonLines.set(id, line);
                }
                return line;
            });
        const text = lines.length
            ? composeInstructionLayers([{ title: 'Lessons learned', content: lines.join('\n'), maxChars }])
            : undefined;
        lessonCache.set(scope, { count, text });
        return text;
    }

    async function resolve(id: string, by: ApproverRef, decision: 'approve' | 'reject', reason?: string) {
        if (!approverKinds.includes(by.kind)) {
            throw new Error(`A learned rule needs approval from ${approverKinds.join(' or ')}, not from ${by.kind}`);
        }
        const request = await approvals.get(id);
        if (!request || request.subject.kind !== 'rule_proposal') throw new Error(`No proposed rule "${id}"`);
        const stored = await approvals.resolve(id, { decision, by, at: new Date().toISOString(), ...(reason ? { reason } : {}) });
        return { request, stored };
    }

    const policy: ToolPolicy = {
        async decide(principal, call): Promise<PolicyDecision> {
            const decisions: PolicyDecision[] = [];
            for (const { rule, tenantId } of await rules.list()) {
                if (tenantId !== principal.tenantId) continue;
                if (!isToolRule(rule) || rule.tool !== call.tool.name) continue;
                decisions.push(rule.effect === 'deny'
                    ? { effect: 'deny', reason: rule.reason }
                    : { effect: 'ask', reason: rule.reason });
            }
            return decisions.length ? combineDecisions(decisions) : { effect: 'allow' };
        },
    };

    return {
        rules,
        policy,
        sink: {
            write(event) {
                const input = experienceFromAudit(event);
                return input ? record(input).then(() => undefined) : undefined;
            },
        },
        hooks: {
            name: 'learning',
            systemPrompt: (ctx, profile) => lessonsFor(profile.id, ctx.principal.tenantId),
        },
        record,
        async experiences(filter = {}) {
            return all().filter(e => (!filter.agentId || e.agentId === filter.agentId)
                && (!filter.domain || e.domain === filter.domain)
                && (filter.tenantId === undefined || e.tenantId === filter.tenantId));
        },
        async patterns(filter = {}) {
            return detectPatterns(all().filter(e => (!filter.agentId || e.agentId === filter.agentId)
                && (filter.tenantId === undefined || e.tenantId === filter.tenantId)), threshold);
        },
        lessonsFor,
        async proposals(filter = {}) {
            const list = await approvals.list({ status: filter.status ?? 'pending' });
            return list.filter(a => a.subject.kind === 'rule_proposal' && a.id.startsWith('learn-')
                && (filter.tenantId === undefined || a.principal.tenantId === filter.tenantId));
        },
        async approve(id, by, reason) {
            const { request } = await resolve(id, by, 'approve', reason);
            const subject = request.subject as { kind: 'rule_proposal'; rule: unknown; evidence: string };
            const approved: ApprovedRule = {
                id, rule: subject.rule, ...(request.principal.tenantId ? { tenantId: request.principal.tenantId } : {}),
                approvedBy: by, approvedAt: new Date().toISOString(),
                source: request.reason, ...(reason ? { reason } : {}),
            };
            await rules.add(approved);
            return approved;
        },
        async reject(id, by, reason) { await resolve(id, by, 'reject', reason); },
        retire: id => rules.remove(id),
    };
}
