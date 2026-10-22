import type {
    Guardrail,
    GuardrailContext,
    GuardrailEventInfo,
    GuardrailOutcome,
    GuardrailPhase,
} from './types';

/**
 * Runs the guardrails of one phase in order. A `redact` feeds its text to the next guardrail; the first
 * `block` wins. Guardrails in `dryRun` report but never change or block anything.
 * Everything that happened comes back in `outcome.events`; the caller decides how to surface it.
 */
export class GuardrailRunner {
    private readonly byPhase = new Map<GuardrailPhase, Guardrail[]>();

    constructor(guardrails: Guardrail[]) {
        for (const g of guardrails) {
            for (const phase of g.phases) {
                const list = this.byPhase.get(phase) ?? [];
                list.push(g);
                this.byPhase.set(phase, list);
            }
        }
    }

    has(phase: GuardrailPhase): boolean {
        return (this.byPhase.get(phase)?.length ?? 0) > 0;
    }

    async run(ctx: GuardrailContext): Promise<GuardrailOutcome> {
        const guardrails = this.byPhase.get(ctx.phase);
        const events: GuardrailEventInfo[] = [];
        if (!guardrails?.length) return { content: ctx.content, changed: false, events };

        let content = ctx.content;
        let changed = false;
        const base = { phase: ctx.phase, agentId: ctx.agentId, ...(ctx.toolName ? { tool: ctx.toolName } : {}) };

        for (const g of guardrails) {
            const dryRun = g.dryRun === true;
            let decision;
            try {
                decision = await g.check({ ...ctx, content });
            } catch (err) {
                const reason = `guardrail error: ${err instanceof Error ? err.message : String(err)}`;
                if ((g.failMode ?? 'closed') === 'open' || dryRun) {
                    events.push({ ...base, name: g.name, action: 'error', reason, dryRun });
                    continue;
                }
                events.push({ ...base, name: g.name, action: 'block', reason, dryRun: false });
                return { content, changed, blocked: { guardrail: g.name, reason }, events };
            }

            if (decision.action === 'allow') continue;

            if (decision.action === 'redact') {
                events.push({ ...base, name: g.name, action: 'redact', reason: decision.reason, dryRun });
                if (!dryRun && decision.content !== content) {
                    content = decision.content;
                    changed = true;
                }
                continue;
            }

            events.push({ ...base, name: g.name, action: 'block', reason: decision.reason, dryRun });
            if (!dryRun) return { content, changed, blocked: { guardrail: g.name, reason: decision.reason }, events };
        }
        return { content, changed, events };
    }
}
