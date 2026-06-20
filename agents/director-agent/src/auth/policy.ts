import type { Principal } from './types.js';
import type { AccessControlConfig } from '../config.js';
import { applyConditions, type AbacCondition } from './abac.js';

export interface AuthzResult {
    allowed: boolean;
    reason?: string;
    layer?:  'rbac' | 'abac';   // qué capa tomó la decisión (solo en denegaciones)
}

export class PolicyEngine {
    private readonly enforce:     boolean;
    private readonly defaultDeny: boolean;
    private readonly tools:       NonNullable<AccessControlConfig>['tools'];

    constructor(cfg: NonNullable<AccessControlConfig>) {
        this.enforce     = cfg.enforce;
        this.defaultDeny = cfg.default_deny;
        this.tools       = cfg.tools;
    }

    isEnforcing(): boolean { return this.enforce; }

    /**
     * Autoriza (principal, toolName, args) → AuthzResult.
     *
     * Capa 2 (RBAC): verifica allowed_roles.
     * Capa 3 (ABAC): evalúa condiciones sobre atributos del usuario, args y tiempo.
     *
     * toolName puede ser el nombre completo MCP (`mcp__codex__reset_vault`)
     * o el nombre corto (`reset_vault`); ambos se buscan en la política.
     */
    authorize(
        principal: Principal,
        toolName:  string,
        args:      Record<string, unknown> = {},
    ): AuthzResult {
        if (!this.enforce) return { allowed: true };

        const shortName = toolName.includes('__') ? toolName.split('__').at(-1)! : toolName;
        const policy    = this.tools[toolName] ?? this.tools[shortName ?? ''];

        if (!policy) return { allowed: !this.defaultDeny };

        // ── Capa 2: RBAC ──────────────────────────────────────────────────────
        const rolesOk = policy.allowed_roles.includes('*')
            || policy.allowed_roles.includes(principal.role);

        if (!rolesOk) {
            return { allowed: false, reason: this.denyMessage(principal, toolName), layer: 'rbac' };
        }

        // ── Capa 3: ABAC ──────────────────────────────────────────────────────
        const conditions = (policy.conditions ?? []) as AbacCondition[];
        if (conditions.length > 0) {
            const result = applyConditions(conditions, {
                principal,
                args,
                now: new Date(),
            });
            if (!result.allowed) return { ...result, layer: 'abac' };
        }

        return { allowed: true };
    }

    denyMessage(principal: Principal, toolName: string): string {
        const shortName = toolName.includes('__') ? toolName.split('__').at(-1)! : toolName;
        const policy    = this.tools[toolName] ?? this.tools[shortName ?? ''];
        const allowed   = policy?.allowed_roles.join(', ') ?? 'ninguno configurado';
        return `Autorización denegada: el rol "${principal.role}" (usuario: ${principal.id}) no puede ejecutar "${shortName}". Roles permitidos: ${allowed}.`;
    }
}
