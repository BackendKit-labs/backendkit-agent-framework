import type { FleetConfig } from './schema';
import { blueprintWarnings } from './provisioning';

export interface FleetWarning {
    /** Where in the file, by agent or blueprint id (e.g. `agents.worker.limits.budgetUsdPerDay`). */
    path: string;
    message: string;
}

/**
 * What the file declares that Hermes does not enforce (ADR-0007: a limit that is accepted must be a limit that applies,
 * or say loudly that it does not). Not errors: such files keep loading. Today that is every budget, because Hermes does not
 * measure the spend of the agents it supervises. `limits.maxConcurrent` is enforced and is not listed.
 */
export function fleetWarnings(fleet: FleetConfig): FleetWarning[] {
    const warnings: FleetWarning[] = [];

    for (const agent of fleet.agents) {
        const budget = agent.limits?.budgetUsdPerDay;
        if (budget !== undefined) {
            warnings.push({
                path: `agents.${agent.id}.limits.budgetUsdPerDay`,
                message: `${budget} USD/day is enforced only from the cost this agent reports (costUsd): an agent that reports none is not enforced, and a run already going is never cut`,
            });
        }
    }

    const budget = fleet.policies?.budget;
    if (budget?.perRunUsd !== undefined) {
        warnings.push({ path: 'policies.budget.perRunUsd', message: `${budget.perRunUsd} USD per run is declared, not enforced: it is accepted and kept, nothing applies it yet` });
    }
    if (budget?.perDayUsd !== undefined) {
        warnings.push({ path: 'policies.budget.perDayUsd', message: `${budget.perDayUsd} USD/day is enforced only over the cost agents report (costUsd): agents that report none are not counted` });
    }

    for (const blueprint of fleet.blueprints ?? []) {
        for (const w of blueprintWarnings(blueprint, fleet.policies?.provisioning)) {
            warnings.push({ path: `blueprints.${blueprint.id}.${w.path}`, message: w.message });
        }
    }
    return warnings;
}
