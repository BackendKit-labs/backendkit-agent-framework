import type { ToolDefinition } from '@backendkit-labs/agent-core';
import type { AgentConnector } from '../connectors/types';
import type { HermesEvent, Principal } from '../errors';

/**
 * What a plugin says it needs. The operator decides what it gets (`PluginGrant`); asking for more than that stops the
 * plugin from loading. There is deliberately no `network` here: a plugin runs inside the Hermes process with its privileges,
 * and Hermes cannot confine what such code does on the network, so a field for it would promise something nobody enforces.
 */
export interface PluginRequires {
    /** Names of the tools it will add for the model. */
    tools?: string[];
    /** Connector kinds it will provide (what `connector: { kind }` in the fleet file refers to). */
    connectors?: string[];
    /** Event types it will listen to. */
    events?: HermesEvent['type'][];
    /** It will register blueprints (still bounded by what Hermes may hand out). */
    blueprints?: boolean;
    /** It will register policy rules (which can only deny). */
    rules?: boolean;
}

/** The operator's decision for one plugin. Same shape as `requires`: the plugin gets the part it asked for AND was granted. */
export type PluginGrant = PluginRequires;

/** What a rule is asked about: something that changes the world, before it is approved or done. */
export interface RuleContext {
    action: 'run' | 'cancel' | 'policy_set' | 'job_cancel' | 'agent_create';
    principal: Principal;
    agentId: string;
    /** The capability (or flow as `flow:<name>`, or the blueprint id for `agent_create`). */
    capability: string;
    runId?: string;
}

/**
 * A rule can only say no. Returning `{ deny: reason }` refuses the action; returning anything else has no effect, and a rule
 * that throws or takes too long counts as a refusal. It can never turn a refusal into a permission.
 */
export type PolicyRule = (context: RuleContext) => { deny: string } | undefined | void | Promise<{ deny: string } | undefined | void>;

export type ConnectorFactory = (config: Record<string, unknown>, context: { agentId: string }) => AgentConnector | Promise<AgentConnector>;

export interface HermesPluginApi {
    /** The `options` of the plugin's entry in the fleet file (or of the code that loaded it). */
    readonly options: Record<string, unknown>;
    /** A tool for the model. Its name must be in `requires.tools` and granted, and must not be one Hermes already has. */
    registerTool(tool: ToolDefinition): void;
    registerConnector(kind: string, factory: ConnectorFactory): void;
    /** A blueprint, checked like the operator's own against what Hermes may hand out. */
    registerBlueprint(blueprint: unknown): void;
    registerRule(rule: PolicyRule): void;
    /** Listens to an event. Handlers have a deadline and cannot affect Hermes. Returns the unsubscribe function. */
    on<T extends HermesEvent['type']>(event: T, handler: (event: Extract<HermesEvent, { type: T }>) => void | Promise<void>): () => void;
}

export interface HermesPlugin {
    readonly name: string;
    readonly version: string;
    readonly requires?: PluginRequires;
    setup(api: HermesPluginApi): void | Promise<void>;
}

export type PluginStatus = 'loaded' | 'refused' | 'disabled';

export interface PluginReport {
    name: string;
    version?: string;
    status: PluginStatus;
    reason?: string;
    tools: string[];
    connectors: string[];
    blueprints: string[];
    rules: number;
}
