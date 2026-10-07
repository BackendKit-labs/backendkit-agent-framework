import { OpenAICompatibleProvider, callLLM } from '@backendkit-labs/orchestrator-agent';
import type { OrchestratorConfig } from './config.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriageAction = 'retry' | 'escalate' | 'fail';

export interface TriageDecision {
    action:  TriageAction;
    reason:  string;   // one-line internal reason, for logs
    message: string;   // human-readable explanation — shown at the gate/failure
}

export type TriageContext =
    | { kind: 'run-failure'; error: string; attemptsSoFar: number }
    | { kind: 'stuck-rework'; phaseTitle: string; reworkHistory: string[] };

// ── Core ──────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sos el criterio de supervisión de un pipeline SDD automatizado. Se te llama
SOLO cuando algo salió mal de forma inesperada — nunca en el camino feliz, nunca para decidir un
veredicto de QA (eso lo hace el QA, no vos). Tu trabajo es decidir UNA de tres acciones:

- "retry": el problema parece transitorio (infra, timeout, proceso que no arrancó, hiccup de red)
  y vale la pena UN reintento acotado del mismo paso.
- "escalate": hace falta que un humano decida — el problema no es mecánico, ya se reintentó sin
  éxito, o el patrón sugiere que la fase/tarea está mal planteada (no un bug de código).
- "fail": no tiene sentido reintentar (error de configuración claro, límite alcanzado, causa
  raíz evidente y no accionable automáticamente) — terminá con un diagnóstico útil.

Respondé SOLO JSON, sin texto alrededor: {"action": "retry"|"escalate"|"fail", "reason": "...", "message": "..."}
"reason" es interno (una frase). "message" lo va a leer un humano — explicá QUÉ pasó y POR QUÉ
elegiste esa acción, en español, conciso (máx 4-5 líneas).`;

function buildUserPrompt(ctx: TriageContext): string {
    if (ctx.kind === 'run-failure') {
        return `Un run falló con este error después de agotar los reintentos automáticos de infra:\n\n` +
            `${ctx.error}\n\nIntentos previos ya realizados: ${ctx.attemptsSoFar}. ¿Qué hacemos?`;
    }
    return `La fase "${ctx.phaseTitle}" lleva ${ctx.reworkHistory.length} reworks y el QA la sigue ` +
        `rechazando. Hallazgos de cada intento, en orden:\n\n` +
        ctx.reworkHistory.map((h, i) => `--- Intento ${i + 1} ---\n${h.slice(0, 800)}`).join('\n\n') +
        `\n\n¿Esto es un patrón resoluble con otro rework mecánico (ej: el mismo detalle chico se ` +
        `sigue rompiendo), o el patrón sugiere que la fase está mal planteada y hace falta que un ` +
        `humano la replanifique?`;
}

/**
 * A single, cheap LLM call used ONLY when the deterministic pipeline hits an
 * exception it doesn't know how to react to on its own. This is the layer that
 * gives the orchestrator judgment without touching the deterministic happy path
 * (build+test gate, QA verdicts, file writes) — it only decides how to react to
 * infra failures and stuck rework loops, and for "stuck-rework" it only ever
 * ANNOTATES the gate a human already sees, never advances/rejects on its own.
 */
export async function triageFailure(
    config: OrchestratorConfig,
    ctx:    TriageContext,
): Promise<TriageDecision> {
    const provCfg = config.providers[config.orchestrator.provider];
    if (!provCfg) {
        // No provider to triage with — fail safe (don't retry blindly without judgment).
        return {
            action:  'fail',
            reason:  'no-provider',
            message: ctx.kind === 'run-failure' ? ctx.error : `Fase "${ctx.phaseTitle}" sigue en NO_GO tras ${ctx.reworkHistory.length} reworks.`,
        };
    }

    try {
        const provider = new OpenAICompatibleProvider(provCfg);
        const raw   = await callLLM(provider, SYSTEM_PROMPT, buildUserPrompt(ctx));
        const match = /\{[\s\S]*\}/.exec(raw);
        if (!match) throw new Error('respuesta sin JSON');

        const parsed = JSON.parse(match[0]) as Partial<TriageDecision>;
        if (parsed.action !== 'retry' && parsed.action !== 'escalate' && parsed.action !== 'fail') {
            throw new Error(`acción inválida: ${String(parsed.action)}`);
        }

        return {
            action:  parsed.action,
            reason:  parsed.reason ?? '',
            message: parsed.message ?? raw.slice(0, 500),
        };
    } catch (err) {
        // Triage itself failed — fail safe: escalate to a human rather than silently
        // retrying forever or hiding the original error.
        const detail = err instanceof Error ? err.message : String(err);
        return {
            action:  'escalate',
            reason:  'triage-error',
            message: `No pude diagnosticar el fallo automáticamente (${detail}). ` +
                (ctx.kind === 'run-failure' ? `Error original: ${ctx.error}` : `Fase "${ctx.phaseTitle}" con ${ctx.reworkHistory.length} reworks.`),
        };
    }
}
