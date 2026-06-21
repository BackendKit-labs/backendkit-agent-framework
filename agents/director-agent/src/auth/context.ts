import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from './types.js';
import type { AgentEvent } from '@backendkit-labs/agent-core';

export interface RequestContext {
    principal: Principal;
    /** Receptor de eventos por-request (WS streaming). Si está presente, tiene prioridad sobre el callback global del engine. */
    onEvent?:  (evt: AgentEvent) => void;
}

/**
 * Almacén de contexto por-request. El servidor lo inicializa con el Principal
 * antes de llamar engine.run(); los wrappers de tools lo leen para autorizar.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
