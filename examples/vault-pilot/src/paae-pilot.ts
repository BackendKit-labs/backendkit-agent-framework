/**
 * PAAE Pilot — Employee Onboarding Flow (Fase 6)
 *
 * Runs flows/onboarding-empleado.yaml end-to-end using real enterprise agents,
 * a shared vault, and DeepSeek as the LLM. Demonstrates:
 *   - Declarative flow from YAML (zero platform code)
 *   - Multi-agent execution (hr + finance) through shared vault
 *   - Human approval gate via CLI
 *   - Full audit trail in the vault
 *
 * Run:
 *   DEEPSEEK_API_KEY=<key> npm run paae
 *   DEEPSEEK_API_KEY=<key> EMPLOYEE_NAME="Ana López" START_DATE=2026-08-01 npm run paae
 */

import 'dotenv/config';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import {
    AgentEngine,
    ProviderRegistry,
    CallbackTransport,
} from '@backendkit-labs/agent-core';
import type { AgentEvent } from '@backendkit-labs/agent-core';
import {
    createEnterpriseSetup,
    loadFlow,
    FlowRunner,
    PolicySeeder,
} from '@backendkit-labs/agent-enterprise';
import type { FlowRunOptions, FlowStep } from '@backendkit-labs/agent-enterprise';
import { DeepSeekProvider } from './providers/DeepSeekProvider';

// ── Config ─────────────────────────────────────────────────────────────────────

const VAULT_PATH  = process.env.VAULT_PATH ?? path.resolve(__dirname, '../vault');
const FLOWS_DIR   = path.resolve(__dirname, '../flows');
const INDEX_DIR   = path.join(os.homedir(), '.bk-agent', 'rag', 'paae-pilot');
const LLM_MODEL   = process.env.LLM_MODEL ?? 'deepseek-chat';

const EMPLOYEE = {
    employee_name:  process.env.EMPLOYEE_NAME  ?? 'Ana González',
    employee_email: process.env.EMPLOYEE_EMAIL ?? 'ana.gonzalez@empresa.com',
    department:     process.env.DEPARTMENT     ?? 'Engineering',
    start_date:     process.env.START_DATE     ?? '2026-08-01',
    salary:         process.env.SALARY         ?? '5000',
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function hr(msg: string) { process.stdout.write(msg); }
function hrl(msg = '') { console.log(msg); }
function sep(char = '─', n = 65) { hrl(char.repeat(n)); }

async function humanApproval(step: FlowStep, previousOutputs: Record<string, string>): Promise<boolean> {
    sep('═');
    hrl(`  HUMAN APPROVAL REQUIRED — step: ${step.id}`);
    hrl(`  Reason: ${step.gate?.approval === 'human' ? 'HR manager review' : 'Manual review'}`);
    sep('═');

    if (Object.keys(previousOutputs).length) {
        hrl('\n  Outputs from completed steps:\n');
        for (const [id, out] of Object.entries(previousOutputs)) {
            sep('·', 65);
            hrl(`  [${id}]`);
            hrl((out ?? '').slice(0, 600) + ((out ?? '').length > 600 ? '\n  ...[truncated]' : ''));
        }
        sep('·', 65);
    }

    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
        rl.question('\n  Approve? [y/N]  ', (ans) => {
            rl.close();
            const approved = ans.trim().toLowerCase() === 'y';
            hrl(approved ? '  ✓ Approved.\n' : '  ✗ Rejected.\n');
            resolve(approved);
        });
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
        console.error('✗  DEEPSEEK_API_KEY is required. Add it to pilot/.env or set it in the shell.');
        process.exit(1);
    }

    hrl();
    hrl('  PAAE Pilot — Employee Onboarding Flow');
    sep();
    hrl(`  Vault:    ${VAULT_PATH}`);
    hrl(`  LLM:      DeepSeek ${LLM_MODEL}`);
    hrl(`  Employee: ${EMPLOYEE.employee_name} (${EMPLOYEE.department})`);
    hrl(`  Start:    ${EMPLOYEE.start_date}`);
    sep();
    hrl();

    // ── Seed policies (idempotent — skips if already present) ─────────────────

    const seeder = new PolicySeeder(VAULT_PATH);
    const seeded = await seeder.seed();
    if (seeded.length) hrl(`  Seeded ${seeded.length} policy notes into vault.\n`);

    // ── Enterprise setup ───────────────────────────────────────────────────────

    const providers = new ProviderRegistry();
    providers.register('deepseek', new DeepSeekProvider({ apiKey, model: LLM_MODEL }));

    const setup = createEnterpriseSetup({
        vaultPath:       VAULT_PATH,
        indexDir:        INDEX_DIR,
        providers,
        defaultProvider: 'deepseek',
        maxIterations:   15,
    });

    hr('  Indexing vault... ');
    await setup.indexAll();
    hrl('done.\n');

    // ── Load flow ──────────────────────────────────────────────────────────────

    const flowDef = await loadFlow(path.join(FLOWS_DIR, 'onboarding-empleado.yaml'));
    hrl(`  Flow: ${flowDef.flow}  (${flowDef.steps.length} steps)`);
    flowDef.steps.forEach((s, i) => hrl(`    ${i + 1}. [${s.agent}] ${s.id}`));
    hrl();

    // ── Agent runner ───────────────────────────────────────────────────────────
    //
    // Each flow step gets its own AgentEngine instance so conversation histories
    // don't bleed across steps. The enterprise tools (vault search + write) are
    // shared via the factory.

    const flowTransport = new CallbackTransport(() => { /* transition events handled via onTransition */ });

    const runAgent: FlowRunOptions['runAgent'] = async (agentId, input, _context, stepId) => {
        hrl();
        sep('─', 65);
        hrl(`  STEP: ${stepId ?? '?'}  [${agentId} agent]`);
        sep('─', 65);

        const tokens: string[] = [];
        const stepTransport = new CallbackTransport((evt: AgentEvent) => {
            switch (evt.type) {
                case 'token':
                    hr(evt.content);
                    tokens.push(evt.content);
                    break;
                case 'tool_call': {
                    const preview = (evt.args_preview ?? '').slice(0, 70);
                    hrl(`\n  ↳ [${evt.name}] ${preview}`);
                    break;
                }
                case 'tool_result': {
                    const preview = (evt.preview ?? '').slice(0, 80).replace(/\n/g, ' ');
                    const icon = evt.success ? '✓' : '✗';
                    hrl(`  ${icon} ${preview}`);
                    break;
                }
            }
        });

        const engine: AgentEngine = setup.engineFactory(`paae-${stepId}-${Date.now()}`, stepTransport);
        engine.switchAgent(agentId);

        hrl();
        try {
            await engine.run(input);
        } catch (err) {
            hrl(`\n  ✗ Agent error: ${(err as Error).message}`);
            throw err;
        }
        hrl();

        // Re-index so subsequent steps can search notes written in this step
        await setup.indexAll({ verbose: false });

        return { content: tokens.join('') };
    };

    // ── Run ────────────────────────────────────────────────────────────────────

    const runner = new FlowRunner(flowDef, {
        payload: EMPLOYEE,
        transport: flowTransport,
        runAgent,
        onApprovalRequired: humanApproval,
        onTransition: (t) => {
            const icons: Record<string, string> = {
                started: '▶', completed: '✓', failed: '✗',
                skipped: '○', approval_requested: '⏸', rejected: '✗',
            };
            const icon = icons[t.event] ?? '·';
            if (['approval_requested', 'rejected', 'gate_passed', 'gate_failed'].includes(t.event)) {
                hrl(`  ${icon} ${t.stepId}: ${t.event}${t.detail ? ` — ${t.detail}` : ''}`);
            }
        },
    });

    hrl('  Starting flow...\n');
    const startTime = Date.now();
    const result = await runner.run();
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ── Summary ────────────────────────────────────────────────────────────────

    hrl();
    sep('═');
    hrl(`  FLOW RESULT: ${result.status.toUpperCase()}   (${elapsed}s)`);
    sep('═');

    for (const step of Object.values(result.steps)) {
        const icons: Record<string, string> = { completed: '✓', failed: '✗', skipped: '○' };
        const icon = icons[step.status] ?? '?';
        hrl(`  ${icon}  ${step.stepId}: ${step.status}${step.error ? ` — ${step.error}` : ''}`);
    }

    if (result.compensations.length) {
        hrl('\n  Compensations:');
        for (const c of result.compensations) {
            hrl(`    ${c.status === 'completed' ? '✓' : '✗'} ${c.on} → [${c.agent}]`);
        }
    }

    hrl();
    if (result.status === 'completed') {
        hrl('  Audit notes written to vault. Run /reindex in the REPL to search them.');
    }
    hrl();
}

main().catch(err => {
    console.error('\nFatal error:', err);
    process.exit(1);
});
