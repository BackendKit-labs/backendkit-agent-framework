import type { Principal } from './types.js';

// ── Tipos públicos ────────────────────────────────────────────────────────────

export interface AbacContext {
    principal: Principal;
    args:      Record<string, unknown>;
    now:       Date;
}

export interface AbacCondition {
    effect: 'allow' | 'deny';
    reason: string;
    match:  unknown;
}

export interface AbacResult {
    allowed: boolean;
    reason?: string;
}

// ── Evaluador de operadores ───────────────────────────────────────────────────

function evalOp(val: unknown, expr: Record<string, unknown>): boolean {
    const str = (v: unknown) => String(v ?? '');
    if ('eq'     in expr) return str(val) === str(expr['eq']);
    if ('neq'    in expr) return str(val) !== str(expr['neq']);
    if ('gt'     in expr) return Number(val) >  Number(expr['gt']);
    if ('gte'    in expr) return Number(val) >= Number(expr['gte']);
    if ('lt'     in expr) return Number(val) <  Number(expr['lt']);
    if ('lte'    in expr) return Number(val) <= Number(expr['lte']);
    if ('in'     in expr) return (expr['in']     as unknown[]).some(v => str(v) === str(val));
    if ('not_in' in expr) return !(expr['not_in'] as unknown[]).some(v => str(v) === str(val));
    return false;
}

// ── Evaluador de expresiones de match (recursivo) ────────────────────────────

function evalMatch(expr: unknown, ctx: AbacContext): boolean {
    if (!expr || typeof expr !== 'object') return false;
    const e = expr as Record<string, unknown>;

    // Compuestos
    if ('all' in e) return (e['all'] as unknown[]).every(c => evalMatch(c, ctx));
    if ('any' in e) return (e['any'] as unknown[]).some(c  => evalMatch(c, ctx));
    if ('not' in e) return !evalMatch(e['not'], ctx);

    // Atributo del usuario: { user: 'role'|'department'|'id', <op>: value }
    if ('user' in e) {
        const attr = String(e['user']);
        const val  = attr === 'role'       ? ctx.principal.role
                   : attr === 'department' ? (ctx.principal.department ?? '')
                   : attr === 'id'         ? ctx.principal.id
                   : undefined;
        return evalOp(val, e);
    }

    // Argumento de la tool: { arg: 'campo', <op>: value }
    if ('arg' in e) {
        return evalOp(ctx.args[String(e['arg'])], e);
    }

    // Tiempo: { time: 'hour'|'minute'|'weekday', <op>: value }
    // weekday: 0=Domingo … 6=Sábado
    if ('time' in e) {
        const unit = String(e['time']);
        const val  = unit === 'hour'    ? ctx.now.getHours()
                   : unit === 'minute'  ? ctx.now.getMinutes()
                   : unit === 'weekday' ? ctx.now.getDay()
                   : undefined;
        return evalOp(val, e);
    }

    return false;
}

// ── Punto de entrada público ──────────────────────────────────────────────────

/**
 * Evalúa la lista de condiciones ABAC en orden.
 * Primera condición que hace match corta la evaluación:
 *   effect: deny  → deniega con la reason de la condición
 *   effect: allow → permite (override de condiciones deny posteriores)
 * Si ninguna condición hace match → permite (RBAC ya pasó).
 */
export function applyConditions(conditions: AbacCondition[], ctx: AbacContext): AbacResult {
    for (const cond of conditions) {
        if (evalMatch(cond.match, ctx)) {
            return cond.effect === 'deny'
                ? { allowed: false, reason: cond.reason }
                : { allowed: true };
        }
    }
    return { allowed: true };
}
