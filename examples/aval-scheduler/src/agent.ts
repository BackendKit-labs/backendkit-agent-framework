import { createAutonomousAgent, selfAssertedIdentities } from '@backendkit-labs/agent-core';
import type { AgentIdentityProvider, AutonomousAgent, AutonomousAgentOptions } from '@backendkit-labs/agent-core';
import { createAvalTools } from '@backendkit-labs/aval-tools';
import { buildProfile } from './profile';

export interface SchedulerAgentOptions {
    /** Modelos disponibles y cuál usar. En producción un `DeepSeekProvider`; en las pruebas, uno guionizado. */
    providers: AutonomousAgentOptions['providers'];
    defaultProvider: string;
    /** Dónde vive AVAL y la clave de ESTE agente (nunca la de consola). */
    avalUrl: string;
    avalKey: string;
    /** Por cuenta de quién paga este agente (la persona u organización responsable). `agent-core` exige decirlo: sin esto no ejecuta ninguna tool. */
    actsFor: string;
    /** La identidad digital del agente. Por defecto autoafirmada (la auditoría lo marca); en producción, la de tu proveedor de identidad. */
    agentIdentity?: AgentIdentityProvider;
    /** Qué dispara una corrida: cron, webhook, evento. Sin triggers, solo se corre a mano con `agent.engine.run`. */
    triggers?: AutonomousAgentOptions['triggers'];
    transport?: AutonomousAgentOptions['transport'];
    /**
     * Dónde está el JSON del origen de pagos. Ausente: el servidor MCP usa su valor por defecto
     * (`~/.aval-scheduler/schedule.json`). Un valor "" no es lo mismo que ausente, así que solo se
     * pasa a ese proceso si de verdad hay algo que pasar.
     */
    paymentsSourcePath?: string;
    /**
     * Script del servidor MCP del origen de pagos. Por defecto el compilado de este proyecto; las pruebas lo
     * apuntan a `dist/` porque un hijo de Node no ejecuta TypeScript.
     */
    paymentsServerEntry?: string;
    /** Puerto del webhook, si hay un trigger `webhook`. */
    webhookPort?: number;
}

/**
 * El agente de pagos programados, sin la parte de proceso (variables de entorno, señales, panel).
 * Está separado de `index.ts` para poder construirlo igual en producción y en las pruebas: lo único que
 * cambia entre una y otra es el modelo, la URL de AVAL y los triggers.
 */
export function buildSchedulerAgent(opts: SchedulerAgentOptions): AutonomousAgent {
    // pay, check_payment y list_own_history, del paquete de npm.
    const avalTools = createAvalTools({ baseUrl: opts.avalUrl });

    return createAutonomousAgent({
        providers: opts.providers,
        defaultProvider: opts.defaultProvider,
        agents: [buildProfile(opts.avalKey)],
        tools: [...avalTools],
        identity: { userId: opts.actsFor },
        agentIdentity: opts.agentIdentity ?? selfAssertedIdentities(),
        ...(opts.transport ? { transport: opts.transport } : {}),
        goal: 'Ejecutar pagos programados a través de AVAL, reconciliando lo pendiente antes de procesar lo nuevo.',

        // El proceso vive días o semanas; sin esto el historial de mensajes
        // crece sin límite en el mismo AgentEngine entre corridas del cron.
        // 40 es el valor que el propio framework recomienda para agentes
        // autónomos de larga duración.
        maxContextMessages: 40,

        mcpServers: [
            {
                name: 'payments-source',
                command: 'node',
                args: [opts.paymentsServerEntry ?? require.resolve('./mcp-payments-source/server')],
                ...(opts.paymentsSourcePath ? { env: { PAYMENTS_SOURCE_PATH: opts.paymentsSourcePath } } : {}),
            },
        ],

        triggers: opts.triggers ?? [],
        ...(opts.webhookPort ? { webhookPort: opts.webhookPort } : {}),
    });
}

/**
 * Apaga el agente por completo: los triggers (cron, webhook, eventos) y también el servidor MCP del
 * calendario, que es un proceso hijo. En `agent-core` anterior a 0.48.10, `agent.stop()` solo paraba los
 * triggers y el hijo quedaba vivo mientras el proceso padre siguiera corriendo (en las pruebas, o si el agente
 * se embebe en otro programa). Desde 0.48.10 `stop()` ya lo cierra; esta función sigue siendo válida en cualquier 0.48.
 */
export async function stopSchedulerAgent(agent: AutonomousAgent): Promise<void> {
    await agent.stop();
    await agent.engine.getMCPManager()?.disconnect();
}
