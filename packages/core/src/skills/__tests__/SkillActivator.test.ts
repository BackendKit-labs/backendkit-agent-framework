import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SkillActivator } from '../activator';
import type { Skill } from '../types';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeSkill(overrides: Partial<Skill>): Skill {
    return {
        name: 'test-skill',
        version: '1.0.0',
        description: 'Test skill',
        triggers: ['hello'],
        ...overrides,
    };
}

// ── activate() ────────────────────────────────────────────────────────────────

describe('SkillActivator.activate()', () => {
    const activator = new SkillActivator();

    it('returns skills whose trigger substring matches user input', () => {
        const skill = makeSkill({ triggers: ['typescript', 'type error'] });
        const result = activator.activate('fix this typescript error', [skill]);
        expect(result).toContain(skill);
    });

    it('returns nothing when no trigger matches', () => {
        const skill = makeSkill({ triggers: ['deploy', 'release'] });
        const result = activator.activate('write a unit test', [skill]);
        expect(result).toHaveLength(0);
    });

    it('trigger matching is case-insensitive', () => {
        const skill = makeSkill({ triggers: ['TypeScript'] });
        const result = activator.activate('fix typescript code', [skill]);
        expect(result).toContain(skill);
    });

    it('language-agnostic skills (no language field) pass stack gate', () => {
        const skill = makeSkill({ triggers: ['test'], language: undefined });
        const result = activator.activate('write a test', [skill], ['python']);
        expect(result).toContain(skill);
    });

    it('language-agnostic skills with empty language array pass stack gate', () => {
        const skill = makeSkill({ triggers: ['test'], language: [] });
        const result = activator.activate('write a test', [skill], ['python']);
        expect(result).toContain(skill);
    });

    it('pack skills are filtered out when their language does not match detectedStack', () => {
        const skill = makeSkill({ triggers: ['lint'], language: ['node'], scope: 'pack' });
        const result = activator.activate('run lint', [skill], ['python']);
        expect(result).toHaveLength(0);
    });

    it('pack skills pass when their language matches at least one detected stack entry', () => {
        const skill = makeSkill({ triggers: ['lint'], language: ['node', 'typescript'], scope: 'pack' });
        const result = activator.activate('run lint', [skill], ['typescript', 'javascript']);
        expect(result).toContain(skill);
    });

    it('returns multiple matching skills', () => {
        const s1 = makeSkill({ name: 'a', triggers: ['deploy'] });
        const s2 = makeSkill({ name: 'b', triggers: ['deploy', 'release'] });
        const s3 = makeSkill({ name: 'c', triggers: ['test'] });
        const result = activator.activate('deploy to production', [s1, s2, s3]);
        expect(result).toContain(s1);
        expect(result).toContain(s2);
        expect(result).not.toContain(s3);
    });
});

// ── getAgentSkills() ──────────────────────────────────────────────────────────

describe('SkillActivator.getAgentSkills()', () => {
    const activator = new SkillActivator();

    it('returns skills bound to the given agentId', () => {
        const skill = makeSkill({ name: 'agent-skill', triggers: [], agents: ['backend-agent'] });
        const result = activator.getAgentSkills('backend-agent', [skill]);
        expect(result).toContain(skill);
    });

    it('does not return skills bound to a different agentId', () => {
        const skill = makeSkill({ triggers: [], agents: ['frontend-agent'] });
        const result = activator.getAgentSkills('backend-agent', [skill]);
        expect(result).toHaveLength(0);
    });

    it('does not return skills with no agents field', () => {
        const skill = makeSkill({ triggers: [], agents: undefined });
        const result = activator.getAgentSkills('backend-agent', [skill]);
        expect(result).toHaveLength(0);
    });

    it('applies stack gate to agent-bound skills', () => {
        const skill = makeSkill({ triggers: [], agents: ['backend-agent'], language: ['java'] });
        const result = activator.getAgentSkills('backend-agent', [skill], ['node']);
        expect(result).toHaveLength(0);
    });
});

// ── buildSystemPromptAddition() ───────────────────────────────────────────────

describe('SkillActivator.buildSystemPromptAddition()', () => {
    const activator = new SkillActivator();

    it('returns empty string for empty list', () => {
        expect(activator.buildSystemPromptAddition([])).toBe('');
    });

    it('returns empty string for skills without systemPromptAddition', () => {
        const skill = makeSkill({ systemPromptAddition: undefined });
        expect(activator.buildSystemPromptAddition([skill])).toBe('');
    });

    it('returns single skill content trimmed', () => {
        const skill = makeSkill({ systemPromptAddition: '  Use strict types.  ' });
        expect(activator.buildSystemPromptAddition([skill])).toBe('Use strict types.');
    });

    it('joins multiple skills with double newline', () => {
        const s1 = makeSkill({ name: 'a', systemPromptAddition: 'Rule A.' });
        const s2 = makeSkill({ name: 'b', systemPromptAddition: 'Rule B.' });
        const result = activator.buildSystemPromptAddition([s1, s2]);
        expect(result).toBe('Rule A.\n\nRule B.');
    });

    /**
     * PRIORITY INVARIANT:
     * When two skills share the same name (e.g. a project skill overrides a global skill),
     * the LAST occurrence wins — project > pack > global > builtin.
     * Callers merge in ascending priority order: [builtin, global, pack, project].
     */
    it('last-wins on name collision — project skill content overrides global', () => {
        const global = makeSkill({ name: 'style', scope: 'global', systemPromptAddition: 'Global style.' });
        const project = makeSkill({ name: 'style', scope: 'project', systemPromptAddition: 'Project style.' });

        // Merge order: builtin/global first, project last
        const result = activator.buildSystemPromptAddition([global, project]);
        expect(result).toBe('Project style.');
        expect(result).not.toContain('Global style.');
    });

    it('last-wins — pack does not override project when project comes after', () => {
        const pack = makeSkill({ name: 'lint', scope: 'pack', systemPromptAddition: 'Pack lint.' });
        const project = makeSkill({ name: 'lint', scope: 'project', systemPromptAddition: 'Project lint.' });

        const result = activator.buildSystemPromptAddition([pack, project]);
        expect(result).toBe('Project lint.');
    });

    it('output position follows first appearance (stable order despite override)', () => {
        const global = makeSkill({ name: 'style', scope: 'global', systemPromptAddition: 'Style.' });
        const project = makeSkill({ name: 'style', scope: 'project', systemPromptAddition: 'Project style.' });
        const other = makeSkill({ name: 'docs', scope: 'global', systemPromptAddition: 'Docs.' });

        // style appears first (position 0), but gets project content; docs at position 1
        const result = activator.buildSystemPromptAddition([global, other, project]);
        const parts = result.split('\n\n');
        // 'style' entry (with project content) should appear before 'docs'
        expect(parts[0]).toBe('Project style.');
        expect(parts[1]).toBe('Docs.');
    });

    it('does not include duplicate content for same-name skills', () => {
        const s1 = makeSkill({ name: 'a', systemPromptAddition: 'Content A.' });
        const s2 = makeSkill({ name: 'a', systemPromptAddition: 'Content A v2.' });

        const result = activator.buildSystemPromptAddition([s1, s2]);
        // Should appear exactly once
        expect(result.split('Content').length - 1).toBe(1);
    });
});
