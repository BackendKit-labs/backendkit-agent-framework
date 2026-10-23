import type { Guardrail, ToolDefinition } from '@backendkit-labs/agent-core';
import type { AgentConnector } from './connectors/types';
import { Hermes, defaultResultGuardrails, type HermesOptions } from './Hermes';
import { parseFleet, validateFleet, type FleetConfig } from './fleet/schema';
import { applyPreset, loadPresetModule, PresetError, type HermesPreset, type PresetUse } from './presets/applyPreset';
import { createFleetTools, type FleetToolsOptions } from './tools';

export interface CreateHermesOptions extends Omit<HermesOptions, 'fleet'> {
    /** The fleet: a `fleet.yaml` text, an object parsed from it, or an already validated config. Always checked. */
    fleet: string | FleetConfig | Record<string, unknown>;
    /** Presets given as objects from code, each with what the operator decides about it. */
    presets?: Array<{ preset: HermesPreset } & PresetUse>;
}

export interface CreatedHermes {
    hermes: Hermes;
    tools(options: FleetToolsOptions): ToolDefinition[];
    guardrails(): Guardrail[];
    /** What the presets changed on the way in (e.g. an approval raised to the operator's default). */
    notes: string[];
}

/**
 * A Hermes ready to use from one call: the fleet is validated (blueprints included), presets are merged and checked against
 * the operator's limits, and what an engine needs comes with it — the supervision tools for a principal and the guardrails
 * for what agents answer. The same code is the conventional Hermes (a fleet and nothing else) and a company's specific one
 * (plus presets, blueprints, a provisioner, an approver and the events it cares about).
 */
export function createHermes(options: CreateHermesOptions): CreatedHermes {
    const parsed = typeof options.fleet === 'string' ? parseFleet(options.fleet) : validateFleet(options.fleet);
    const baseDir = options.pluginBaseDir ?? process.cwd();

    let fleet: FleetConfig = parsed;
    const inProcess: Record<string, AgentConnector> = { ...(options.inProcess ?? {}) };
    const notes: string[] = [];
    const uses: Array<{ preset: HermesPreset } & PresetUse> = [...(options.presets ?? [])];
    for (const entry of parsed.presets ?? []) {
        uses.push({ preset: loadPresetModule(entry.module, baseDir, entry.options), ...(entry.grants ? { grants: entry.grants as PresetUse['grants'] } : {}), ...(entry.roleMap ? { roleMap: entry.roleMap } : {}) });
    }
    fleet = { ...fleet, presets: undefined } as FleetConfig;
    delete (fleet as { presets?: unknown }).presets;
    for (const { preset, ...use } of uses) {
        const applied = applyPreset(fleet, preset, use);
        fleet = applied.fleet;
        for (const id of Object.keys(applied.inProcess)) {
            if (id in inProcess) throw new PresetError(preset.name, `agent "${id}" collides with an in-process agent given in code`);
        }
        Object.assign(inProcess, applied.inProcess);
        notes.push(...applied.notes.map(n => `${preset.name}: ${n}`));
    }

    const hermes = new Hermes({ ...options, fleet, inProcess });
    return {
        hermes, notes,
        tools: toolOptions => createFleetTools(hermes, toolOptions),
        guardrails: defaultResultGuardrails,
    };
}

