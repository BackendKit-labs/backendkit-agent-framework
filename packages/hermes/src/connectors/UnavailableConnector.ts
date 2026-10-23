import type { AgentConnector, AgentDescriptor, HealthReport, RunHandle } from './types';

/**
 * Stands in for an agent whose connector cannot be built (no plugin provides its kind, or its factory failed). The agent stays
 * in the fleet, visibly down, and nothing can be run on it: a missing piece never turns into a silent gap or a permission.
 */
export class UnavailableConnector implements AgentConnector {
    constructor(readonly kind: string, private readonly why: string) {}
    async describe(): Promise<AgentDescriptor> { throw Object.assign(new Error(this.why), { code: 'AGENT_UNAVAILABLE' }); }
    async health(): Promise<HealthReport> { return { state: 'down', detail: this.why }; }
    async run(): Promise<RunHandle> { throw Object.assign(new Error(this.why), { code: 'AGENT_UNAVAILABLE' }); }
}
