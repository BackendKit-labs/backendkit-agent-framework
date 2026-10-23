import type { Guardrail, ToolDefinition } from '@backendkit-labs/agent-core';
import { Hermes, defaultResultGuardrails, type HermesOptions } from './Hermes';
import { parseFleet, validateFleet, type FleetConfig } from './fleet/schema';
import { createFleetTools, type FleetToolsOptions } from './tools';

export interface CreateHermesOptions extends Omit<HermesOptions, 'fleet'> {
    /** The fleet: a `fleet.yaml` text, an object parsed from it, or an already validated config. Always checked. */
    fleet: string | FleetConfig | Record<string, unknown>;
}

/**
 * A Hermes ready to use from one call: the fleet is validated (blueprints included), and what an engine needs comes with it —
 * the supervision tools for a principal and the guardrails for what agents answer. The same code is the conventional Hermes
 * (a fleet and nothing else) and a company's specific one (plus blueprints, a provisioner, an approver and the events it cares about).
 */
export function createHermes(options: CreateHermesOptions): { hermes: Hermes; tools(options: FleetToolsOptions): ToolDefinition[]; guardrails(): Guardrail[] } {
    const fleet = typeof options.fleet === 'string' ? parseFleet(options.fleet) : validateFleet(options.fleet);
    const hermes = new Hermes({ ...options, fleet });
    return {
        hermes,
        tools: toolOptions => createFleetTools(hermes, toolOptions),
        guardrails: defaultResultGuardrails,
    };
}
