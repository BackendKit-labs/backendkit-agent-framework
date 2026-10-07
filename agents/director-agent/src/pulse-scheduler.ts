import { createHash } from 'node:crypto';
import * as fs   from 'node:fs';
import * as path from 'node:path';
import { bkPaths } from '@backendkit-labs/infra';
import type { Principal } from './auth/types.js';
import type { AuditLogger } from './auth/audit.js';
import type { ProactiveConfig, PlaybookConfig } from './config.js';

/**
 * PulseScheduler — modo proactivo del director (Fase 1: solo lectura).
 * Ver proposals/director-proactivo.md.
 *
 * Cada N minutos ejecuta un "turno sintético" en nombre de cada usuario
 * suscripto: un prompt de playbook elegido por su rol, corriendo con SU
 * principal (mismas policies, mismo vault filter) y una allowlist de tools de
 * solo lectura. Si el resultado no aporta nada ([SILENCIO] o repite el último
 * digest), no se publica.
 *
 * Seguridad de identidad (hallazgo #3 del análisis abac): el Principal NUNCA
 * se serializa a disco. Lo que persiste es solo {userId, playbook}; tras un
 * reinicio la suscripción queda "pendiente" hasta que el usuario se
 * reconecte con un token válido y ws-server llame a reactivate(principal).
 */

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type PulseNotifyFn = (principalId: string, message: string) => void;

/** Spec completo de un turno de pulso — el scheduler resuelve config, el runner solo ejecuta. */
export interface PulseTurnSpec {
    playbookKey:   string;
    prompt:        string;
    allowedTools:  Set<string>;   // nombres cortos
    maxIterations: number;
}

export type PulseRunner = (principal: Principal, spec: PulseTurnSpec) => Promise<string>;

interface StoredSub {
    userId:       string;
    playbook:     string;
    /** Solo informativo (logs/status) — el Principal real llega en reactivate(). */
    role:         string;
    subscribedAt: string;   // ISO
}

interface PulseState {
    subs:       StoredSub[];
    /** Último digest publicado por "userId:playbook" — para el delta-hash. */
    lastDigest: Record<string, { hash: string; at: string }>;
}

interface ActiveSub {
    principal:   Principal;
    nextAt:      number;
    running:     boolean;
    activatedAt: number;
}

const SILENCE_SENTINEL = '[SILENCIO]';
const TICK_MS          = 60_000;
const FIRST_PULSE_MS   = 15_000;   // tras suscribirse, feedback rápido
const REACTIVATE_MS    = 60_000;   // tras reconectar, no disparar de inmediato

// ── Helpers ───────────────────────────────────────────────────────────────────

/** '15m' | '4h' | '90s' → ms. 'off'/inválido → null. */
export function parseEvery(every: string): number | null {
    const m = /^(\d+)\s*(s|m|h)$/.exec(every.trim());
    if (!m) return null;
    const n = Number(m[1]);
    if (n <= 0) return null;
    const unit = m[2] === 's' ? 1_000 : m[2] === 'm' ? 60_000 : 3_600_000;
    return n * unit;
}

/** true si `now` cae dentro de la franja from–to (soporta cruce de medianoche). */
export function inQuietHours(now: Date, from: string, to: string): boolean {
    const toMin = (hhmm: string): number | null => {
        const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
        if (!m) return null;
        return Number(m[1]) * 60 + Number(m[2]);
    };
    const f = toMin(from), t = toMin(to);
    if (f === null || t === null) return false;
    const cur = now.getHours() * 60 + now.getMinutes();
    return f <= t ? (cur >= f && cur < t) : (cur >= f || cur < t);
}

function digestHash(text: string): string {
    // Normaliza antes de hashear: números con separadores, espacios y case no
    // deberían hacer pasar dos reformulaciones del mismo digest como "nuevo".
    const normalized = text.toLowerCase().replace(/[\s,.]+/g, ' ').trim();
    return createHash('sha256').update(normalized).digest('hex');
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class PulseScheduler {
    private readonly statePath = path.join(bkPaths.home(), 'director', 'pulse-state.json');
    private state:  PulseState = { subs: [], lastDigest: {} };
    private active  = new Map<string, ActiveSub>();
    private notify: PulseNotifyFn = () => {};
    private runner: PulseRunner | null = null;
    private timer:  NodeJS.Timeout | null = null;

    constructor(
        private readonly cfg:   ProactiveConfig | null,
        private readonly audit: AuditLogger | null,
    ) {
        this.loadState();
    }

    get isEnabled(): boolean { return this.cfg?.enabled === true; }
    get allowsDev(): boolean { return this.cfg?.allow_dev === true; }

    /** ws-server cablea el push real; engine cablea el ejecutor de turnos. */
    setNotifier(fn: PulseNotifyFn): void { this.notify = fn; }
    setRunner(fn: PulseRunner):     void { this.runner = fn; }

    start(): void {
        if (!this.isEnabled || this.timer) return;
        this.timer = setInterval(() => { void this.tick(); }, TICK_MS);
        this.timer.unref();
        process.stderr.write(`[pulse] modo proactivo habilitado (${this.state.subs.length} suscripciones en disco, pendientes de reconexión)\n`);
    }

    stop(): void {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
    }

    // ── Suscripciones ─────────────────────────────────────────────────────────

    /** Activa el pulso para un principal. Devuelve el mensaje para el usuario. */
    subscribe(principal: Principal): string {
        if (!this.cfg?.enabled) return 'El modo proactivo está deshabilitado en la configuración del director.';

        const resolved = this.resolvePlaybook(principal.role);
        if (!resolved) {
            return `No hay un playbook proactivo configurado para tu rol ("${principal.role}") y no existe uno "default". Pedile al administrador que agregue uno en director.yaml → proactive.playbooks.`;
        }
        const [key, playbook] = resolved;
        const intervalMs = parseEvery(playbook.every);
        if (intervalMs === null) {
            return `El playbook "${key}" está apagado (every: ${playbook.every}).`;
        }

        if (!this.state.subs.some(s => s.userId === principal.id)) {
            this.state.subs.push({
                userId:       principal.id,
                playbook:     key,
                role:         principal.role,
                subscribedAt: new Date().toISOString(),
            });
            this.saveState();
        }
        this.active.set(principal.id, {
            principal,
            nextAt:      Date.now() + FIRST_PULSE_MS,
            running:     false,
            activatedAt: Date.now(),
        });

        return `Modo proactivo activado 🔄 — playbook "${key}" cada ${playbook.every}. ` +
               `El primer chequeo sale en unos segundos; si no hay nada que valga la pena, no vas a recibir ruido. ` +
               `Desactivalo cuando quieras con "/pulse off".`;
    }

    unsubscribe(userId: string): string {
        const had = this.state.subs.some(s => s.userId === userId);
        this.state.subs = this.state.subs.filter(s => s.userId !== userId);
        this.active.delete(userId);
        if (had) this.saveState();
        return had ? 'Modo proactivo desactivado.' : 'No tenías el modo proactivo activo.';
    }

    statusFor(userId: string): string {
        const sub = this.state.subs.find(s => s.userId === userId);
        if (!sub) return 'Modo proactivo: inactivo. Activalo con "/pulse on".';
        const act = this.active.get(userId);
        if (!act) return `Modo proactivo: suscripto (playbook "${sub.playbook}") pero pausado hasta tu próxima reconexión.`;
        const inMin = Math.max(0, Math.round((act.nextAt - Date.now()) / 60_000));
        return `Modo proactivo: activo (playbook "${sub.playbook}"). Próximo chequeo en ~${inMin} min.`;
    }

    /**
     * Reactiva la suscripción persistida de un usuario que acaba de
     * (re)conectarse con un token verificado. Es la ÚNICA vía por la que una
     * suscripción de disco vuelve a correr — nunca se rehidrata un Principal.
     */
    reactivate(principal: Principal): void {
        if (!this.cfg?.enabled) return;
        if (this.active.has(principal.id)) {
            // Refresca el principal (claims nuevos) y el reloj de TTL.
            const act = this.active.get(principal.id)!;
            act.principal   = principal;
            act.activatedAt = Date.now();
            return;
        }
        if (!this.state.subs.some(s => s.userId === principal.id)) return;
        this.active.set(principal.id, {
            principal,
            nextAt:      Date.now() + REACTIVATE_MS,
            running:     false,
            activatedAt: Date.now(),
        });
        process.stderr.write(`[pulse] suscripción reactivada para ${principal.id}\n`);
    }

    // ── Loop ──────────────────────────────────────────────────────────────────

    private async tick(): Promise<void> {
        if (!this.cfg?.enabled || !this.runner) return;
        const now = Date.now();

        if (this.cfg.quiet_hours && inQuietHours(new Date(), this.cfg.quiet_hours.from, this.cfg.quiet_hours.to)) {
            return;
        }

        const ttlMs = this.cfg.subscription_ttl_hours * 3_600_000;

        for (const [userId, act] of this.active) {
            if (now - act.activatedAt > ttlMs) {
                // TTL vencido sin reconexión — pausa hasta la próxima re-auth.
                this.active.delete(userId);
                process.stderr.write(`[pulse] suscripción de ${userId} pausada por TTL (${this.cfg.subscription_ttl_hours}h sin reconexión)\n`);
                continue;
            }
            if (act.running || now < act.nextAt) continue;
            void this.fire(userId, act);
        }
    }

    private async fire(userId: string, act: ActiveSub): Promise<void> {
        const cfg = this.cfg!;
        const sub = this.state.subs.find(s => s.userId === userId);
        if (!sub) { this.active.delete(userId); return; }

        const playbook = cfg.playbooks[sub.playbook];
        const intervalMs = playbook ? parseEvery(playbook.every) : null;
        if (!playbook || intervalMs === null) {
            // El admin apagó/borró el playbook después de la suscripción.
            this.active.delete(userId);
            return;
        }

        act.running = true;
        const start = Date.now();
        let outcome = 'error';

        try {
            const spec: PulseTurnSpec = {
                playbookKey:   sub.playbook,
                prompt:        playbook.prompt,
                allowedTools:  new Set(playbook.allowed_tools ?? cfg.allowed_tools),
                maxIterations: cfg.max_iterations,
            };
            const text = (await this.runner!(act.principal, spec)).trim();

            if (!text || text.includes(SILENCE_SENTINEL)) {
                outcome = 'silence';
            } else {
                const key  = `${userId}:${sub.playbook}`;
                const hash = digestHash(text);
                const last = this.state.lastDigest[key];
                const cooldownMs = cfg.repeat_cooldown_hours * 3_600_000;

                if (last && last.hash === hash && Date.now() - Date.parse(last.at) < cooldownMs) {
                    outcome = 'duplicate';
                } else {
                    this.notify(userId, `🔄 **Pulso proactivo** (${sub.playbook})\n\n${text}`);
                    this.state.lastDigest[key] = { hash, at: new Date().toISOString() };
                    this.saveState();
                    outcome = 'published';
                }
            }
        } catch (err) {
            process.stderr.write(`[pulse] error en pulso de ${userId}: ${(err as Error).message}\n`);
        } finally {
            act.running = false;
            act.nextAt  = Date.now() + intervalMs;
            this.audit?.write({
                ts: new Date().toISOString(),
                userId,
                role: act.principal.role,
                department: act.principal.department,
                tool: '__pulse__',
                decision: 'allowed',
                durationMs: Date.now() - start,
                extra: { playbook: sub.playbook, outcome },
            });
        }
    }

    // ── Resolución de playbook ────────────────────────────────────────────────

    private resolvePlaybook(role: string): [string, PlaybookConfig] | null {
        const books = this.cfg?.playbooks ?? {};
        if (books[role])      return [role, books[role]];
        if (books['default']) return ['default', books['default']];
        return null;
    }

    // ── Persistencia (solo userId + playbook — nunca el Principal) ───────────

    private loadState(): void {
        try {
            const raw = fs.readFileSync(this.statePath, 'utf-8');
            const parsed = JSON.parse(raw) as Partial<PulseState>;
            this.state = {
                subs:       Array.isArray(parsed.subs) ? parsed.subs : [],
                lastDigest: parsed.lastDigest && typeof parsed.lastDigest === 'object' ? parsed.lastDigest : {},
            };
        } catch {
            // Sin estado previo (primer arranque) o archivo corrupto → estado limpio.
            this.state = { subs: [], lastDigest: {} };
        }
    }

    private saveState(): void {
        try {
            fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
            fs.writeFileSync(this.statePath, JSON.stringify(this.state, null, 2), 'utf-8');
        } catch (err) {
            process.stderr.write(`[pulse] no se pudo persistir el estado: ${(err as Error).message}\n`);
        }
    }
}
