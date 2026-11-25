/**
 * Flow loader: parses and validates declarative flow YAML (SPEC-0023).
 *
 * Validation happens in two layers:
 * 1. Structural (Zod): shapes, required fields, enums.
 * 2. Semantic: duplicate step ids, unknown `after` references, dependency
 *    cycles, trigger coherence, compensation selectors, and the static
 *    half of the compliance rule — a gate evaluator can never be the
 *    step's own executor (evaluador ≠ ejecutor, ADR-3).
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'yaml';
import { FlowDefinitionSchema, type FlowDefinition } from './types';

export class FlowLoadError extends Error {
    readonly issues: string[];

    constructor(flowName: string, issues: string[]) {
        super(`Invalid flow "${flowName}":\n${issues.map(i => `  - ${i}`).join('\n')}`);
        this.name = 'FlowLoadError';
        this.issues = issues;
    }
}

/** Parses a YAML string into a validated FlowDefinition. */
export function parseFlow(yamlContent: string): FlowDefinition {
    let raw: unknown;
    try {
        raw = yaml.parse(yamlContent);
    } catch (err) {
        throw new FlowLoadError('<unparsed>', [`YAML syntax error: ${(err as Error).message}`]);
    }

    const parsed = FlowDefinitionSchema.safeParse(raw);
    if (!parsed.success) {
        const name = (raw as Record<string, unknown>)?.flow;
        throw new FlowLoadError(
            typeof name === 'string' ? name : '<unknown>',
            parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`),
        );
    }

    const def = parsed.data;
    const issues = validateFlow(def);
    if (issues.length > 0) throw new FlowLoadError(def.flow, issues);

    return def;
}

/** Loads and validates a single flow file. */
export async function loadFlow(filePath: string): Promise<FlowDefinition> {
    const content = await fs.readFile(filePath, 'utf-8');
    return parseFlow(content);
}

/** Loads every `*.yaml` / `*.yml` in a directory. Throws on the first invalid flow. */
export async function loadFlowsFromDir(dir: string): Promise<FlowDefinition[]> {
    const entries = await fs.readdir(dir);
    const files = entries
        .filter(f => f.endsWith('.yaml') || f.endsWith('.yml'))
        .sort();
    const flows: FlowDefinition[] = [];
    for (const file of files) {
        flows.push(await loadFlow(path.join(dir, file)));
    }
    return flows;
}

// ── Semantic validation ───────────────────────────────────────────────────────

/** The semantic half of the validation: duplicate ids, unknown or self references, cycles, the trigger and the compensation selectors. */
export function validateFlow(def: FlowDefinition): string[] {
    const issues: string[] = [];
    const ids = new Set<string>();

    for (const step of def.steps) {
        if (ids.has(step.id)) issues.push(`duplicate step id "${step.id}"`);
        ids.add(step.id);
    }

    for (const step of def.steps) {
        for (const dep of step.after) {
            if (!ids.has(dep)) {
                issues.push(`step "${step.id}" references unknown step "${dep}" in after`);
            }
            if (dep === step.id) {
                issues.push(`step "${step.id}" cannot depend on itself`);
            }
        }
        if (step.when) {
            if (!step.after.includes(step.when.step)) {
                issues.push(`step "${step.id}": when.step "${step.when.step}" must be one of its after (a condition looks at a step it waits for)`);
            }
            if (step.when.matches !== undefined) {
                try { new RegExp(step.when.matches); } catch { issues.push(`step "${step.id}": when.matches is not a valid regular expression`); }
            }
        }
        if (step.kind === 'tool' && !step.tool) issues.push(`step "${step.id}": kind "tool" requires a tool ({ name, args? })`);
        if (step.kind !== 'tool' && step.tool) issues.push(`step "${step.id}": a tool call needs kind "tool" (without it the step would run as a prompt and the call would be ignored)`);
        if (step.gate?.evaluator && step.gate.evaluator === step.agent) {
            issues.push(
                `step "${step.id}": gate evaluator "${step.gate.evaluator}" must differ from the executing agent (evaluador ≠ ejecutor)`,
            );
        }
    }

    issues.push(...detectCycles(def));
    issues.push(...validateTrigger(def));

    for (const comp of def.compensation) {
        const stepId = comp.on.replace(/\.failed$/, '');
        if (!ids.has(stepId)) {
            issues.push(`compensation "on: ${comp.on}" references unknown step "${stepId}"`);
        }
    }

    return issues;
}

function detectCycles(def: FlowDefinition): string[] {
    const depMap = new Map(def.steps.map(s => [s.id, s.after]));
    const visited = new Set<string>();
    const inStack = new Set<string>();
    const issues: string[] = [];

    const dfs = (id: string): void => {
        if (inStack.has(id)) {
            issues.push(`dependency cycle detected at step "${id}"`);
            return;
        }
        if (visited.has(id)) return;
        inStack.add(id);
        for (const dep of depMap.get(id) ?? []) dfs(dep);
        inStack.delete(id);
        visited.add(id);
    };

    for (const step of def.steps) {
        if (issues.length > 0) break;
        dfs(step.id);
    }
    return issues;
}

function validateTrigger(def: FlowDefinition): string[] {
    const t = def.trigger;
    switch (t.type) {
        case 'queue':
            return t.queue ? [] : ['trigger type "queue" requires a queue name'];
        case 'webhook':
            return t.path ? [] : ['trigger type "webhook" requires a path'];
        case 'cron':
            return t.schedule ? [] : ['trigger type "cron" requires a schedule'];
        case 'manual':
            return [];
    }
}
