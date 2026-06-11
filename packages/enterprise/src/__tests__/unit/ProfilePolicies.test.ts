/**
 * Structural compliance test for Fase 4 — Policies-in-vault (ADR-4).
 *
 * Criterio de salida: grep of hardcoded thresholds/matrices in ALL system prompts → 0 matches.
 * The prompts must instruct agents to retrieve current policies via their search tool at runtime.
 */
import { ALL_ENTERPRISE_PROFILES } from '../../profiles';

// ── Helpers ───────────────────────────────────────────────────────────────────

function violations(prompt: string, pattern: RegExp): string[] {
    const matches: string[] = [];
    for (const line of prompt.split('\n')) {
        if (pattern.test(line)) matches.push(line.trim());
    }
    return matches;
}

// ── Criterio de salida: zero hardcoded thresholds ─────────────────────────────

describe('Fase 4 — criterio de salida: no hardcoded business rules in system prompts', () => {
    for (const profile of ALL_ENTERPRISE_PROFILES) {
        const prompt = profile.systemPrompt ?? '';

        it(`[${profile.id}] must not contain hardcoded currency amounts ($NNN)`, () => {
            const found = violations(prompt, /\$\d/);
            expect(found).toEqual([]);
        });

        it(`[${profile.id}] must not contain hardcoded percentage thresholds (NN%)`, () => {
            // Exclude "100%" which is never a business threshold
            const found = violations(prompt, /\b(?!100)\d+%/);
            expect(found).toEqual([]);
        });

        it(`[${profile.id}] must not contain hardcoded severity codes (P1:, P2:, P3:, P4:)`, () => {
            const found = violations(prompt, /\bP[1-4]:/);
            expect(found).toEqual([]);
        });

        it(`[${profile.id}] must not contain hardcoded escalation tiers (Tier N:)`, () => {
            const found = violations(prompt, /\bTier\s+[123]:/i);
            expect(found).toEqual([]);
        });
    }
});

// ── Prompts must reference their search tool for policy lookups ───────────────

describe('Profiles — prompts instruct to use search tool for policy lookups', () => {
    const POLICY_AGENTS = [
        { id: 'finance',  tool: 'search_finance_kb', keyword: 'approval' },
        { id: 'hr',       tool: 'search_hr_kb',      keyword: 'privacy' },
        { id: 'sales',    tool: 'search_sales_kb',   keyword: 'discount' },
        { id: 'ops',      tool: 'search_ops_kb',     keyword: 'severity' },
        { id: 'support',  tool: 'search_support_kb', keyword: 'escalation' },
    ];

    for (const { id, tool, keyword } of POLICY_AGENTS) {
        const profile = ALL_ENTERPRISE_PROFILES.find(p => p.id === id)!;

        it(`[${id}] prompt references its domain search tool (${tool})`, () => {
            expect(profile.systemPrompt).toContain(tool);
        });

        it(`[${id}] prompt contains a policy search instruction related to '${keyword}'`, () => {
            expect(profile.systemPrompt?.toLowerCase()).toContain(keyword);
        });
    }
});

// ── All profiles have non-empty systemPrompts ─────────────────────────────────

describe('All profiles have well-formed system prompts', () => {
    for (const profile of ALL_ENTERPRISE_PROFILES) {
        it(`[${profile.id}] has a non-empty systemPrompt`, () => {
            expect(typeof profile.systemPrompt).toBe('string');
            expect((profile.systemPrompt ?? '').length).toBeGreaterThan(50);
        });
    }
});
