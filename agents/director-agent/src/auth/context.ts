import { AsyncLocalStorage } from 'node:async_hooks';
import type { Principal } from './types.js';

export interface RequestContext {
    principal: Principal;
}

/**
 * Almacén de contexto por-request. El servidor lo inicializa con el Principal
 * antes de llamar engine.run(); los wrappers de tools lo leen para autorizar.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
