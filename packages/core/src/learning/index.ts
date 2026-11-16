import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { InMemoryStore } from '../agent-memory/stores/InMemoryStore';
import { JsonFileStore } from '../agent-memory/stores/JsonFileStore';
import { FileApprovalStore, MemoryApprovalStore } from '../governance/approval-store';
import { combineDecisions } from '../governance/policy';
import type { ApproverRef, AuditEvent, PolicyDecision, ToolPolicy } from '../governance/types';
import { composeInstructionLayers, sanitizeDiskContent } from '../sources';
import { FileLessonStore, FileRuleStore, MemoryLessonStore, MemoryRuleStore } from './stores';
import { DEFAULT_RATE, QualifiedPatterns, SuccessCounters } from './signal';
import { ENGINE_ERROR_CODES, ENGINE_HINTS, GENERAL_UNIT, fitUnits, groupEntries, lessonIdFor, unitFromMarkdown, unitToMarkdown } from './units';
import type { UnitGroup } from './units';
import type { RateOptions } from './signal';
import type {
    AddRuleInput, ApprovedRule, Experience, ExperienceInput, LearnedPattern, Learning, LearnedRulesView, LearningOptions, LessonUnitInfo, OutcomeInput, Severity,
    TaughtLesson, TeachInput, ToolRule,
} from './types';

export { FileLessonStore, FileRuleStore, MemoryLessonStore, MemoryRuleStore } from './stores';
export type {
    AddRuleInput, ApprovedRule, Experience, ExperienceInput, LearnedPattern, Learning, LearningOptions, LessonStore, LessonUnitInfo,
    LearnedRulesView, OutcomeInput, RuleStore, Severity, TaughtLesson, TeachInput, ToolRule,
} from './types';
export { ENGINE_ERROR_CODES, ENGINE_HINTS, GENERAL_UNIT } from './units';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const TOOL_FAILURES = new Set(['tool_error', 'tool_timeout', 'tool_too_large']);
const MAX_TAUGHT_CHARS = 500;
const LESSON_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

function cleanLessonText(raw: string | undefined): string {
    const text = raw?.replace(/\s+/g, ' ').trim();
    if (!text) throw new Error('A lesson needs a text');
    if (text.length > MAX_TAUGHT_CHARS) throw new Error(`A lesson is at most ${MAX_TAUGHT_CHARS} characters; this one has ${text.length}`);
    return text;
}

interface LessonItem { unit: string; source: 'taught' | 'learned'; text: string; order: string }
const PROPOSER = { agentId: 'learning', sessionId: 'learning', chain: ['learning'] };

// A fingerprint is part of the key only when there is one, so the keys (and the proposals) of before it existed do not change.
const patternKey = (e: Pick<Experience, 'domain' | 'kind' | 'subject' | 'fingerprint'>): string =>
    `${e.domain}:${e.kind}:${e.subject ?? ''}${e.fingerprint ? `#${e.fingerprint}` : ''}`;

/** Patterns never mix tenants: the group is the tenant plus the pattern key. */
const groupKey = (e: Pick<Experience, 'tenantId' | 'domain' | 'kind' | 'subject' | 'fingerprint'>): string =>
    `${e.tenantId ?? ''}\u0000${patternKey(e)}`;

const proposalId = (key: string): string => `learn-${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;

// Sanitized on its own: the text comes from a tool or a policy, and inside a lesson line a role prefix would not be
// at the start of the line, where the sanitizer of the whole layer looks for it.
const oneLine = (text: string, max: number): string =>
    sanitizeDiskContent(text.replace(/\s+/g, ' ').trim()).trim().slice(0, max);

// A unit name ends up in a heading of the prompt. A tool name from an MCP server or the domain of a vertical is external.
const normUnit = (name: string): string => oneLine(name, 64) || GENERAL_UNIT;
const unitNameOf = (p: { subject?: string; domain: string }): string => normUnit(p.subject ?? p.domain);

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
        ...(event.errorCode && kind === 'tool_error' ? { fingerprint: event.errorCode } : {}),
        ...(event.reason ? { detail: event.reason } : {}),
    };
}

/** What `detectPatterns` needs to tell a pattern from noise: how many correct calls a subject had. */
interface RateContext {
    rate: RateOptions | false;
    /** Correct calls of the subject in the window, of one agent or of all of them. */
    successes(tenantId: string | undefined, domain: string, subject: string, agentId?: string): number;
    /** Set when the patterns are those of a single agent: the share is then its own. */
    agentId?: string;
    /** The patterns that already passed the rate: they stay while their failures stay in the window. */
    qualified: { has(key: string): boolean; confirm(key: string): void; drop(key: string): void };
}

function detectPatterns(experiences: Experience[], threshold: (sample: Experience) => number, ctx?: RateContext): LearnedPattern[] {
    const groups = new Map<string, Experience[]>();
    const failuresOf = new Map<string, number>();
    for (const e of experiences) {
        if (e.outcome !== 'failure') continue;
        const key = groupKey(e);
        const group = groups.get(key);
        if (group) group.push(e); else groups.set(key, [e]);
        if (e.subject) {
            const subjectKey = `${e.tenantId ?? ''}\u0000${e.domain}\u0000${e.subject}`;
            failuresOf.set(subjectKey, (failuresOf.get(subjectKey) ?? 0) + 1);
        }
    }
    const patterns: LearnedPattern[] = [];
    for (const group of groups.values()) {
        group.sort((a, b) => a.at.localeCompare(b.at));
        const last = group[group.length - 1];
        const gk = groupKey(last);
        if (group.length < threshold(last)) { ctx?.qualified.drop(gk); continue; }
        let passes = true;
        if (ctx?.rate && last.subject) {
            const calls = ctx.successes(last.tenantId, last.domain, last.subject, ctx.agentId)
                + (failuresOf.get(`${last.tenantId ?? ''}\u0000${last.domain}\u0000${last.subject}`) ?? 0);
            passes = !(calls >= ctx.rate.minCalls && group.length / calls < ctx.rate.minFailureRate);
        }
        // The rate decides when a pattern enters; once in, it stays while its failures stay in the window.
        if (!passes && !ctx?.qualified.has(gk)) continue;
        ctx?.qualified.confirm(gk);
        patterns.push({
            key: patternKey(last), ...(last.tenantId ? { tenantId: last.tenantId } : {}), domain: last.domain, kind: last.kind,
            ...(last.subject ? { subject: last.subject } : {}),
            ...(last.fingerprint ? { fingerprint: last.fingerprint } : {}),
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
    return patterns.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
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
    const dir = options.dir;
    const store = options.store ?? (dir ? new JsonFileStore(join(dir, 'experiences.json')) : new InMemoryStore());
    const approvals = options.approvals ?? (dir ? new FileApprovalStore(join(dir, 'proposals')) : new MemoryApprovalStore());
    const rules = options.rules ?? (dir ? new FileRuleStore(join(dir, 'rules.json')) : new MemoryRuleStore());
    const lessonStore = options.lessonStore ?? (dir ? new FileLessonStore(join(dir, 'lessons.json')) : new MemoryLessonStore());
    const base = options.threshold ?? 3;
    const threshold = options.thresholdFor ?? (() => base);
    const maxExperiences = options.maxExperiences ?? 1000;
    const maxChars = options.lessons?.maxChars ?? 1500;
    const maxLessons = options.lessons?.maxLessons ?? 5;
    const maxPerUnit = options.lessons?.maxPerUnit ?? 3;
    const hints = new Map<string, Record<string, string>>();
    const approverKinds = options.approverKinds ?? ['human'];
    const ruleFor = options.ruleFor ?? defaultRuleFor;
    const now = options.now ?? (() => new Date());
    const windowDays = options.window?.days ?? 30;
    const rate: RateOptions | false = options.rate === false ? false : { ...DEFAULT_RATE, ...(options.rate ?? {}) };
    const counterStore = options.counters ?? (dir ? new JsonFileStore(join(dir, 'counters.json')) : new InMemoryStore());
    const counters = new SuccessCounters(counterStore);
    const qualified = new QualifiedPatterns(counterStore);
    const lessonCache = new Map<string, { count: number; day: string; at: number; items: LessonItem[] }>();
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

    const dayBefore = (days: number): string => new Date(now().getTime() - days * 86_400_000).toISOString().slice(0, 10);
    /** The experiences still inside the window: the only ones patterns, lessons and proposals look at. */
    const inWindow = (): Experience[] => {
        const since = new Date(now().getTime() - windowDays * 86_400_000).toISOString();
        return all().filter(e => e.at >= since);
    };
    const rateContext = (agentId?: string): RateContext => ({
        rate,
        successes: (tenantId, domain, subject, agent) => counters.since(dayBefore(windowDays), tenantId, domain, subject, agent),
        ...(agentId ? { agentId } : {}),
        // The view of one agent has its own share, so it has its own memory of what passed it.
        qualified: {
            has: key => qualified.has(`${agentId ?? ''}|${key}`, dayBefore(windowDays)),
            confirm: key => qualified.confirm(`${agentId ?? ''}|${key}`, now().toISOString().slice(0, 10)),
            drop: key => qualified.drop(`${agentId ?? ''}|${key}`),
        },
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
        const group = inWindow().filter(e => groupKey(e) === key);
        // The view of each agent has its own share: the moment the failure is recorded is the moment it qualifies, not the first
        // turn that happens to ask for the lessons after a flood of correct calls.
        for (const agentId of new Set(group.map(e => e.agentId))) detectPatterns(group.filter(e => e.agentId === agentId), threshold, rateContext(agentId));
        const pattern = detectPatterns(group, threshold, rateContext())[0];
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
        if (experience.outcome === 'success') {
            // A success is only counted (SPEC-0019 D1): it is the denominator of a failure rate, never a record to keep.
            if (experience.subject) counters.add(experience.at, experience.agentId, experience.tenantId, experience.domain, experience.subject);
            return experience;
        }
        store.insert({ ...experience, createdAt: experience.at });
        if (store.count() > maxExperiences) store.deleteOldest(maxExperiences);
        await propose(experience);
        await counters.flush(dayBefore(windowDays * 2));
        return experience;
    });

    /** The sentence of a learned lesson: what the tool's author says about the error, what the engine says about the kind of failure, or the plain fact. */
    function lineFor(p: LearnedPattern, scope: string): string {
        const id = `${scope}\u0000${p.key}`;
        const cached = lessonLines.get(id);
        if (cached) return cached;
        const fp = p.fingerprint ? oneLine(p.fingerprint, 64) : undefined;
        // What a tool's author says is about the errors it raises. A denial, a block or a timeout is not one: for those the
        // engine speaks, so that a `*` hint never tells the model to retry a call that was refused.
        const toolHints = p.domain === 'tool' && p.kind === 'tool_error' && p.subject ? hints.get(p.subject) : undefined;
        const toolError = p.domain === 'tool' && p.kind === 'tool_error';
        // The author of the tool for this very code, then what the engine knows of the code (a malformed call), then the author's
        // fallback, then what the engine knows of the kind of failure.
        const hint = (p.fingerprint ? toolHints?.[p.fingerprint] : undefined)
            ?? (toolError && p.fingerprint ? ENGINE_ERROR_CODES[p.fingerprint] : undefined)
            ?? toolHints?.['*'] ?? (p.domain === 'tool' ? ENGINE_HINTS[p.kind] : undefined);
        // The advice, when there is one. The situation is the one of the LATEST experience of a pattern that may span several
        // symbols or steps, so it is only used when there is nothing better to say.
        const line = hint
            ? `${fp ?? p.kind}: ${oneLine(hint, 240)}`
            : p.detail
                ? `${p.kind}${fp ? ` (${fp})` : ''} keeps happening: ${oneLine(p.detail, 200)}`
                : `${p.kind}${fp ? ` (${fp})` : ''} keeps happening. ${oneLine(p.situation, 120)}`;
        lessonLines.set(id, line);
        return line;
    }

    // What the patterns say is cached while the experiences do not change; what people taught is read each time, because
    // it may be changed from another process.
    function learnedItems(agentId: string, tenantId: string | undefined): LessonItem[] {
        const count = store.count();
        const at = now().getTime();
        const day = new Date(at).toISOString().slice(0, 10);
        const scope = `${tenantId ?? ''}\u0000${agentId}`;
        // Recomputed when the experiences change, the day changes or a minute passes: the counters of correct calls move all
        // the time, and the lessons must not flap with each call.
        const cached = lessonCache.get(scope);
        if (cached && cached.count === count && cached.day === day && at - cached.at < 60_000) return cached.items;
        const own = inWindow().filter(e => e.agentId === agentId && e.tenantId === tenantId);
        // Patterns come most frequent first: the cap per unit and the cap in total keep the ones that happen most.
        const perUnit = new Map<string, number>();
        const chosen: LearnedPattern[] = [];
        for (const p of detectPatterns(own, threshold, rateContext(agentId))) {
            const unit = unitNameOf(p);
            if ((perUnit.get(unit) ?? 0) >= maxPerUnit) continue;
            if (chosen.length >= maxLessons) break;
            perUnit.set(unit, (perUnit.get(unit) ?? 0) + 1);
            chosen.push(p);
        }
        const items = chosen.map(p => ({ unit: unitNameOf(p), source: 'learned' as const, text: lineFor(p, scope), order: p.key }));
        lessonCache.set(scope, { count, day, at, items });
        return items;
    }

    const unitOf = (l: { unit?: string; tools?: string[] }): string => normUnit(l.unit ?? l.tools?.[0] ?? GENERAL_UNIT);

    async function taughtItems(agentId: string, tenantId: string | undefined, available: string[] | undefined): Promise<LessonItem[]> {
        return (await lessonStore.list())
            .filter(l => l.tenantId === tenantId
                && (!l.agentId || l.agentId === agentId)
                && (!l.tools?.length || (available ?? []).some(t => l.tools!.includes(t))))
            .map(l => ({ unit: unitOf(l), source: 'taught' as const, text: oneLine(l.text, MAX_TAUGHT_CHARS), order: `${l.at}\u0000${l.id}` }));
    }

    async function lessonsFor(agentId: string, tenantId?: string, availableTools?: string[]): Promise<string | undefined> {
        const items = [...await taughtItems(agentId, tenantId, availableTools), ...learnedItems(agentId, tenantId)];
        const text = fitUnits(groupEntries(items), maxChars);
        return text ? composeInstructionLayers([{ title: 'Lessons', content: text }]) : undefined;
    }

    // Two lessons taught in the same millisecond keep the order in which they were taught.
    let lastAt = 0;
    const nextAt = (): string => {
        lastAt = Math.max(Date.now(), lastAt + 1);
        return new Date(lastAt).toISOString();
    };

    function requireAuthor(by: ApproverRef, what: string): void {
        if (!approverKinds.includes(by.kind)) {
            throw new Error(`${what} needs ${approverKinds.join(' or ')}, not ${by.kind}`);
        }
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

    const api: Learning = {
        rules,
        policy,
        sink: {
            write(event) {
                if (event.decision === 'allow' && event.outcome === 'ok') {
                    counters.add(event.at, event.principal.agentId, event.principal.tenantId, 'tool', event.tool);
                    return undefined;
                }
                const input = experienceFromAudit(event);
                return input ? record(input).then(() => undefined) : undefined;
            },
        },
        hooks: {
            name: 'learning',
            systemPrompt: (ctx, profile) => lessonsFor(profile.id, ctx.principal.tenantId, profile.allowedTools),
            // The counters of correct calls reach their store at the end of each turn. A failed write must not fail the turn.
            afterRun: async () => { await counters.flush(dayBefore(windowDays * 2)).catch(() => undefined); },
        },
        record,
        trackOutcome(o) {
            if (o.ok && !o.subject?.trim()) {
                return Promise.reject(new Error('A success needs a subject: it is counted against it, and without one it would never be counted'));
            }
            return record({
                agentId: o.agentId, ...(o.tenantId ? { tenantId: o.tenantId } : {}), domain: o.domain, subject: o.subject,
                kind: o.ok ? 'ok' : (o.kind ?? 'failure'), outcome: o.ok ? 'success' : 'failure',
                ...(o.severity ? { severity: o.severity } : {}), ...(o.detail ? { detail: o.detail } : {}),
                situation: o.situation ?? `${o.domain} ${o.subject}`, action: o.action ?? o.subject,
                ...(o.meta ? { meta: o.meta } : {}), ...(o.at ? { at: o.at } : {}),
            });
        },
        async experiences(filter = {}) {
            return all().filter(e => (!filter.agentId || e.agentId === filter.agentId)
                && (!filter.domain || e.domain === filter.domain)
                && (filter.tenantId === undefined || e.tenantId === filter.tenantId));
        },
        async patterns(filter = {}) {
            return detectPatterns(inWindow().filter(e => (!filter.agentId || e.agentId === filter.agentId)
                && (filter.tenantId === undefined || e.tenantId === filter.tenantId)), threshold, rateContext(filter.agentId));
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
        rulesView(tenantId) {
            // Copies, and no way back to the store: a tool that reads the rules cannot change them.
            const mine = async () => (await rules.list()).filter(r => r.tenantId === tenantId).map(r => structuredClone(r));
            return Object.freeze({
                list: mine,
                async where<T>(guard: (rule: unknown) => rule is T) {
                    return (await mine()).filter(r => guard(r.rule)).map(r => ({ id: r.id, rule: r.rule as T, approvedAt: r.approvedAt, approvedBy: r.approvedBy }));
                },
            });
        },
        flush: async () => { qualified.prune(dayBefore(windowDays * 2)); await counters.flush(dayBefore(windowDays * 2)); },
        registerHints(tool, toolHints) { hints.set(tool, { ...(hints.get(tool) ?? {}), ...toolHints }); },
        async units(filter = {}) {
            const out = new Map<string, { name: string; tenantId?: string; taught: number; learned: number }>();
            const slot = (name: string, tenantId: string | undefined) => {
                const k = `${tenantId ?? ''}\u0000${name}`;
                let u = out.get(k);
                if (!u) out.set(k, u = { name, ...(tenantId ? { tenantId } : {}), taught: 0, learned: 0 });
                return u;
            };
            for (const l of await lessonStore.list()) {
                if (filter.tenantId === undefined || l.tenantId === filter.tenantId) slot(unitOf(l), l.tenantId).taught++;
            }
            for (const p of detectPatterns(inWindow().filter(e => filter.tenantId === undefined || e.tenantId === filter.tenantId), threshold, rateContext())) {
                slot(p.subject ?? p.domain, p.tenantId).learned++;
            }
            return [...out.values()].sort((a, b) => a.name.localeCompare(b.name) || (a.tenantId ?? '').localeCompare(b.tenantId ?? ''));
        },
        async exportUnit(rawUnit, scope = {}) {
            const unit = normUnit(rawUnit);
            const taught = (await lessonStore.list())
                .filter(l => unitOf(l) === unit && l.tenantId === scope.tenantId && l.agentId === scope.agentId)
                .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
            const learnedScope = `${scope.tenantId ?? ''}\u0000export`;
            const learned = detectPatterns(inWindow().filter(e => e.tenantId === scope.tenantId && unitNameOf(e) === unit), threshold, rateContext())
                .map(p => lineFor(p, learnedScope)).sort();
            const tools = [...new Set(taught.flatMap(l => l.tools ?? []))].sort();
            return unitToMarkdown({
                unit, tools, ...(scope.agentId ? { agentId: scope.agentId } : {}), ...(scope.tenantId ? { tenantId: scope.tenantId } : {}),
                taught: taught.map(l => l.text), learned,
            });
        },
        async importUnit(markdown, by, opts = {}) {
            requireAuthor(by, 'Importing lessons');
            const doc = unitFromMarkdown(markdown);
            // In a product with tenants the caller says which one the file is for; otherwise the front matter decides.
            const tenantId = 'tenantId' in opts ? opts.tenantId : doc.tenantId;
            const unit = normUnit(doc.unit);
            const tools = doc.tools.length ? doc.tools : unit === GENERAL_UNIT ? [] : [unit];
            // Everything is checked before anything is written: a file is imported whole or not at all.
            const texts = doc.taught.map(cleanLessonText);
            const lessons: TaughtLesson[] = [];
            for (const text of texts) {
                lessons.push(await api.teach({
                    text, unit, ...(tools.length ? { tools } : {}),
                    ...(doc.agentId ? { agentId: doc.agentId } : {}), ...(tenantId ? { tenantId } : {}),
                    id: lessonIdFor(unit, tenantId, doc.agentId, text),
                }, by));
            }
            if (opts.replace) {
                const keep = new Set(lessons.map(l => l.id));
                for (const l of await lessonStore.list()) {
                    if (unitOf(l) === unit && l.tenantId === tenantId && l.agentId === doc.agentId && !keep.has(l.id)) await lessonStore.remove(l.id);
                }
            }
            return lessons;
        },
        async teach(input, by) {
            requireAuthor(by, 'Teaching a lesson');
            const text = cleanLessonText(input.text);
            if (input.id !== undefined && !LESSON_ID.test(input.id)) throw new Error('A lesson id is letters, digits, _ and -, up to 128 characters');
            const candidate: Omit<TaughtLesson, 'id' | 'by' | 'at'> = {
                text,
                ...(input.unit ? { unit: normUnit(input.unit) } : {}),
                ...(input.agentId ? { agentId: input.agentId } : {}),
                ...(input.tenantId ? { tenantId: input.tenantId } : {}),
                ...(input.tools?.length ? { tools: input.tools } : {}),
            };
            if (input.id !== undefined) {
                // The same lesson again changes nothing: it keeps its place in the prompt and its first author.
                const existing = (await lessonStore.list()).find(l => l.id === input.id);
                if (existing && JSON.stringify({ ...candidate, id: 0 }) === JSON.stringify({ text: existing.text, ...(existing.unit ? { unit: existing.unit } : {}), ...(existing.agentId ? { agentId: existing.agentId } : {}), ...(existing.tenantId ? { tenantId: existing.tenantId } : {}), ...(existing.tools?.length ? { tools: existing.tools } : {}), id: 0 })) return existing;
            }
            const lesson: TaughtLesson = { id: input.id ?? `lesson-${randomUUID()}`, ...candidate, by, at: nextAt() };
            await lessonStore.add(lesson);
            return lesson;
        },
        async taught(filter = {}) {
            return (await lessonStore.list()).filter(l => (!filter.agentId || l.agentId === filter.agentId)
                && (filter.tenantId === undefined || l.tenantId === filter.tenantId));
        },
        forget: id => lessonStore.remove(id),
        async addRule(input, by) {
            requireAuthor(by, 'Adding a rule');
            const rule = input.rule as Partial<ToolRule> | null;
            if (!rule || typeof rule !== 'object') throw new Error('A rule must be an object');
            if ('tool' in rule || 'effect' in rule) {
                if (typeof rule.tool !== 'string' || !rule.tool) throw new Error('A tool rule names its tool');
                if (rule.effect !== 'ask' && rule.effect !== 'deny') throw new Error("A tool rule's effect is 'ask' or 'deny'");
            }
            const approved: ApprovedRule = {
                id: `manual-${randomUUID()}`,
                rule: 'tool' in rule ? { reason: `Added by ${by.id}`, ...rule } : input.rule,
                ...(input.tenantId ? { tenantId: input.tenantId } : {}),
                approvedBy: by, approvedAt: new Date().toISOString(),
                source: `Added by ${by.id}`, ...(input.reason ? { reason: input.reason } : {}),
            };
            await rules.add(approved);
            return approved;
        },
    };
    return api;
}
