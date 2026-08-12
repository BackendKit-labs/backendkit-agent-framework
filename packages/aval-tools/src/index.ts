import { createPayTool } from './pay';
import { createCheckPaymentTool } from './check-payment';
import { createHistoryTool } from './history';

export type { AvalToolsConfig } from './client';
export { avalKey, avalRequest } from './client';
export { createPayTool } from './pay';
export { createCheckPaymentTool } from './check-payment';
export { createHistoryTool } from './history';

import type { AvalToolsConfig } from './client';

/**
 * The three AVAL tools together, ready to spread into an agent's tool list.
 *
 * Wiring an agent up to AVAL is then: give the agent's profile a `secrets`
 * entry with its AVAL key, add "pay", "check_payment" and "list_own_history"
 * to its `allowedTools`, and register these with the engine's ToolRegistry.
 *
 * @example
 * ```ts
 * import { createAvalTools } from '@backendkit-labs/aval-tools';
 *
 * const avalTools = createAvalTools({ baseUrl: 'https://aval.internal' });
 * for (const tool of avalTools) tools.register(tool);
 *
 * const profile: AgentProfile = {
 *   // ...
 *   allowedTools: ['pay', 'check_payment', 'list_own_history', ...],
 *   secrets: { AVAL_KEY: process.env.EXPEDIENTES_BOT_AVAL_KEY! },
 * };
 * ```
 */
export function createAvalTools(config: AvalToolsConfig) {
    return [createPayTool(config), createCheckPaymentTool(config), createHistoryTool(config)] as const;
}
