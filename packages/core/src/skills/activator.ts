import * as fs from 'fs/promises';
import * as path from 'path';
import { run, isOk } from '@backendkit-labs/result';
import type { Skill } from './types';

/** Detectable stacks mapped to their indicator files */
const STACK_INDICATORS: Array<{ file: string; stack: string }> = [
    { file: 'package.json',      stack: 'node' },
    { file: 'tsconfig.json',     stack: 'typescript' },
    { file: 'requirements.txt',  stack: 'python' },
    { file: 'pyproject.toml',    stack: 'python' },
    { file: 'pom.xml',           stack: 'java' },
    { file: 'build.gradle',      stack: 'java' },
    { file: 'Cargo.toml',        stack: 'rust' },
    { file: 'go.mod',            stack: 'go' },
    { file: 'composer.json',     stack: 'php' },
    { file: 'Gemfile',           stack: 'ruby' },
    { file: 'mix.exs',           stack: 'elixir' },
];

export class SkillActivator {
    /**
     * Returns the subset of skills whose triggers match the user input.
     * Language-agnostic skills (no `language` field) always pass the stack filter.
     * Pack skills are included only if their language matches the detected stack.
     */
    activate(input: string, skills: Skill[], detectedStack: string[] = []): Skill[] {
        const lower = input.toLowerCase();
        return skills.filter(skill => {
            // Stack gate — skip pack skills that don't match the project stack
            if (skill.language && skill.language.length > 0) {
                const matches = skill.language.some(lang =>
                    detectedStack.includes(lang.toLowerCase())
                );
                if (!matches) return false;
            }
            // Trigger match
            return skill.triggers.some(trigger =>
                lower.includes(trigger.toLowerCase())
            );
        });
    }

    /**
     * Returns all skills that should always be active for a given agent,
     * regardless of user input (skills with `agents` field containing the agentId).
     */
    getAgentSkills(agentId: string, skills: Skill[], detectedStack: string[] = []): Skill[] {
        return skills.filter(skill => {
            if (!skill.agents?.includes(agentId)) return false;
            if (skill.language && skill.language.length > 0) {
                return skill.language.some(lang => detectedStack.includes(lang.toLowerCase()));
            }
            return true;
        });
    }

    /** Detects project stack by checking for indicator files in cwd */
    async detectStack(cwd: string): Promise<string[]> {
        const stacks: string[] = [];
        await Promise.all(
            STACK_INDICATORS.map(async ({ file, stack }) => {
                const result = await run(() => fs.access(path.join(cwd, file)));
                if (isOk(result) && !stacks.includes(stack)) {
                    stacks.push(stack);
                }
            })
        );
        return stacks;
    }

    /**
     * Builds the combined systemPromptAddition for a set of active skills.
     *
     * Deduplicates by skill name. On a name collision the LAST occurrence wins,
     * so that higher-priority scopes override lower ones — matching the documented
     * precedence (project > pack > global > builtin), since callers merge skills
     * in that ascending order. Output position follows first appearance to keep
     * the prompt order stable.
     */
    buildSystemPromptAddition(activeSkills: Skill[]): string {
        // Last write wins: a project skill overrides a global/builtin with the same name.
        const contentByName = new Map<string, string>();
        for (const skill of activeSkills) {
            if (!skill.systemPromptAddition) continue;
            contentByName.set(skill.name, skill.systemPromptAddition.trim());
        }

        const seen = new Set<string>();
        const parts: string[] = [];
        for (const skill of activeSkills) {
            if (seen.has(skill.name) || !contentByName.has(skill.name)) continue;
            seen.add(skill.name);
            parts.push(contentByName.get(skill.name)!);
        }
        return parts.join('\n\n');
    }
}
