#!/usr/bin/env node

// Load .env without external deps
import * as fsSync   from 'node:fs';
import * as pathSync from 'node:path';
import { fileURLToPath } from 'node:url';

(function loadDotEnv() {
    const pkgRoot    = pathSync.resolve(fileURLToPath(import.meta.url), '..', '..');
    const candidates = [pathSync.join(process.cwd(), '.env'), pathSync.join(pkgRoot, '.env')];
    for (const f of candidates) {
        if (!fsSync.existsSync(f)) continue;
        for (const line of fsSync.readFileSync(f, 'utf-8').split('\n')) {
            const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
        break;
    }
})();

import { createInterface }                                             from 'node:readline';
import { stdin, stdout }                                               from 'node:process';
import * as path                                                       from 'node:path';
import { loadConfig, resolveDataDir, type OrchestratorConfig }        from './config.js';
import { TaskPlanner, type TaskPlan }                                  from './planner.js';
import { PlanExecutor, type ExecutionResult }                          from './executor.js';
import { OpenAICompatibleProvider, callLLM }                          from './provider.js';
import { RunStore, type RunState, type StepResult }                   from './run-store.js';
import { buildRAG }                                                    from './rag.js';
import { matchFlow, flowToTaskPlan, loadFlow }                        from './static-flow.js';

// ── PromptReader ──────────────────────────────────────────────────────────────
// Buffers stdin lines upfront so readline closing after EOF doesn't break
// subsequent question() calls (happens when input is piped, not a TTY).

class PromptReader {
    private readonly buffer: string[] = [];
    private readonly waiters: Array<(line: string) => void> = [];
    private closed = false;

    constructor() {
        const rl = createInterface({ input: stdin, terminal: false });
        rl.on('line', (line) => {
            if (this.waiters.length > 0) {
                this.waiters.shift()!(line);
            } else {
                this.buffer.push(line);
            }
        });
        rl.on('close', () => {
            this.closed = true;
            for (const w of this.waiters) w('');
            this.waiters = [];
        });
    }

    async question(prompt: string): Promise<string> {
        process.stdout.write(prompt);
        if (this.buffer.length > 0) return this.buffer.shift()!;
        if (this.closed) return '';
        return new Promise(resolve => this.waiters.push(resolve));
    }

    close(): void { /* managed internally */ }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString();

function openStore(configPath: string, config?: OrchestratorConfig): RunStore {
    return new RunStore(path.join(resolveDataDir(configPath, config), 'runs'));
}

function toStepResult(r: ExecutionResult): StepResult {
    return {
        stepId:     r.subtask_id,
        agentId:    r.agent_id,
        task:       r.task,
        output:     r.result,
        success:    r.success,
        durationMs: r.duration_ms,
    };
}

async function planDynamic(
    config: OrchestratorConfig,
    rag:    { search: (q: string) => Promise<string> } | null,
    task:   string,
): Promise<TaskPlan> {
    const provCfg = config.providers[config.orchestrator.provider];
    if (!provCfg) throw new Error(`Provider "${config.orchestrator.provider}" no configurado`);
    const provider = new OpenAICompatibleProvider(provCfg);
    const planner  = new TaskPlanner((sys, usr) => callLLM(provider, sys, usr));
    const ctx      = rag ? await rag.search(task).catch(() => '') : undefined;
    return planner.plan(task, config.agents, ctx);
}

// ── Gate loop — shared by run + approve ──────────────────────────────────────

async function executeWithGates(
    runId:        string,
    plan:         TaskPlan,
    config:       OrchestratorConfig,
    rag:          { search: (q: string) => Promise<string> } | null,
    store:        RunStore,
    priorResults: ExecutionResult[],
    rl:           PromptReader,
): Promise<void> {
    while (true) {
        const executor = new PlanExecutor({
            config,
            ragSearchFn: rag?.search,
            onProgress:  (msg) => process.stdout.write(`${msg}\n`),
        });

        const result = await executor.execute(plan, priorResults);

        if ('gateRequired' in result) {
            const state = (await store.load(runId))!;
            await store.save({
                ...state,
                status:         'waiting_gate',
                completedSteps: result.completedSoFar.map(toStepResult),
                waitingGate: {
                    gateId:         result.stepId,
                    stepId:         result.stepId,
                    agentId:        result.agentId,
                    output:         result.output,
                    criteria:       result.criteria,
                    requestedAt:    ts(),
                    appliedRuleIds: result.appliedRuleIds.length ? result.appliedRuleIds : undefined,
                },
            });

            console.log('\n⏸  Gate — esperando aprobación');
            console.log(`   Step : ${result.stepId}`);
            console.log(`   Agent: ${result.agentId}`);
            if (result.criteria.length) {
                console.log('\n   Criterios a evaluar:');
                result.criteria.forEach(c => console.log(`     • ${c}`));
            }
            console.log('\n── Salida del agente ──────────────────────────────────────────');
            console.log(result.output.slice(0, 1500));
            console.log('───────────────────────────────────────────────────────────────');

            const answer = await rl.question('\n¿Aprobar? [y/n]: ');
            if (!answer.trim().toLowerCase().startsWith('y')) {
                const notes   = await rl.question('Motivo del rechazo (opcional): ');
                const current = (await store.load(runId))!;
                await store.save({
                    ...current,
                    status:      'failed',
                    completedAt: ts(),
                    error:       `Gate rechazado. Step: ${result.stepId}. Notas: ${notes.trim() || '(ninguna)'}`,
                    waitingGate: undefined,
                });
                console.log('\n❌ Gate rechazado — run detenido.');
                return;
            }

            console.log('\n✅ Aprobado — continuando...\n');
            priorResults = result.completedSoFar;
            const current = (await store.load(runId))!;
            await store.save({ ...current, status: 'running', waitingGate: undefined });

        } else {
            const state = (await store.load(runId))!;
            await store.save({
                ...state,
                status:         'complete',
                completedAt:    ts(),
                completedSteps: result.results.map(toStepResult),
                finalReport:    result.summary,
                waitingGate:    undefined,
            });
            console.log('\n✅ Run completado\n');
            console.log(result.summary);
            return;
        }
    }
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdRun(configPath: string, args: string[]): Promise<void> {
    const flowFlagIdx = args.indexOf('--flow');
    const flowId      = flowFlagIdx !== -1 ? args[flowFlagIdx + 1] : undefined;
    const taskTokens  = flowFlagIdx !== -1
        ? args.filter((_, i) => i !== flowFlagIdx && i !== flowFlagIdx + 1)
        : args;
    const task        = taskTokens.join(' ').trim();

    if (!task) {
        console.error('Error: se requiere la descripción de la tarea.');
        printUsage();
        process.exit(1);
    }

    let config: OrchestratorConfig;
    try { config = loadConfig(configPath); }
    catch (err) { console.error(`Config: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }

    const configDir = path.dirname(path.resolve(configPath));
    const rag       = await buildRAG(config, resolveDataDir(configPath, config)).catch(() => null);
    const store     = openStore(configPath, config);

    let plan: TaskPlan;
    let planSource: string;

    if (flowId) {
        const entry = config.flows?.find(f => f.id === flowId);
        if (!entry) { console.error(`Flow "${flowId}" no declarado en orchestrator.yaml`); process.exit(1); }
        plan       = flowToTaskPlan(loadFlow(path.resolve(configDir, entry.file)), {});
        planSource = 'static';
    } else if (config.flows?.length) {
        const matched = matchFlow(config.flows, configDir, task);
        if (matched) { plan = flowToTaskPlan(matched.flow, {}); planSource = `static (${matched.entry.id})`; }
        else         { plan = await planDynamic(config, rag, task); planSource = 'dynamic'; }
    } else {
        plan       = await planDynamic(config, rag, task);
        planSource = 'dynamic';
    }

    const runId = store.newRunId();
    await store.save({
        runId, task, configPath,
        status:         'running',
        startedAt:      ts(),
        updatedAt:      ts(),
        plan,
        completedSteps: [],
    });

    console.log(`\n🚀 Run iniciado  [${planSource}]`);
    console.log(`   runId: ${runId}`);
    console.log(`\n📋 ${plan.summary}`);
    plan.subtasks.forEach(st => {
        const gate = (st.gate ?? config.agents.find(a => a.id === st.agent_id)?.gate) ? ' [GATE]' : '';
        console.log(`  • [${st.agent_id}]${gate} ${st.task.slice(0, 90)}`);
    });
    console.log('');

    const rl = new PromptReader();
    await executeWithGates(runId, plan, config, rag, store, [], rl);
}

async function cmdStatus(configPath: string, args: string[]): Promise<void> {
    const runId = args[0];
    if (!runId) { console.error('Error: se requiere run_id'); process.exit(1); }

    const store = openStore(configPath);
    const state = await store.load(runId);
    if (!state) { console.error(`Run no encontrado: ${runId}`); process.exit(1); }

    const ICON: Record<string, string> = {
        running: '⏳', waiting_gate: '⏸', complete: '✓', failed: '✗',
    };

    console.log(`\n${ICON[state.status] ?? '?'} ${state.runId}  [${state.status}]`);
    console.log(`   task    : ${state.task}`);
    console.log(`   started : ${state.startedAt}`);
    if (state.completedAt) console.log(`   ended   : ${state.completedAt}`);

    if (state.completedSteps.length) {
        console.log(`\n   Pasos completados (${state.completedSteps.length}):`);
        state.completedSteps.forEach(s =>
            console.log(`   ${s.success ? '✓' : '✗'} [${s.agentId}] ${s.task.slice(0, 80)}`),
        );
    }

    if (state.status === 'waiting_gate' && state.waitingGate) {
        const g = state.waitingGate;
        console.log(`\n⏸  Gate pendiente — step: ${g.stepId}  agent: ${g.agentId}`);
        if (g.criteria.length) {
            console.log('   Criterios:');
            g.criteria.forEach(c => console.log(`     • ${c}`));
        }
        console.log(`\n── Salida del agente ──────────────────────────────────────────`);
        console.log(g.output.slice(0, 800));
        console.log(`───────────────────────────────────────────────────────────────`);
        console.log(`\n   → orchestrator-cli approve ${configPath} ${runId}`);
    }

    if (state.status === 'complete' && state.finalReport) {
        console.log('\n── Reporte final ──────────────────────────────────────────────');
        console.log(state.finalReport);
    }

    if (state.status === 'failed' && state.error) {
        console.log(`\n❌ Error: ${state.error}`);
    }
}

async function cmdApprove(configPath: string, args: string[]): Promise<void> {
    const runId    = args[0];
    const reject   = args.includes('--reject');
    const notesIdx = args.indexOf('--notes');
    const notes    = notesIdx !== -1 ? args[notesIdx + 1] : undefined;

    if (!runId) { console.error('Error: se requiere run_id'); process.exit(1); }

    let config: OrchestratorConfig;
    try { config = loadConfig(configPath); }
    catch (err) { console.error(`Config: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }

    const store = openStore(configPath, config);
    const state = await store.load(runId);

    if (!state) { console.error(`Run no encontrado: ${runId}`); process.exit(1); }
    if (state.status !== 'waiting_gate') {
        console.error(`El run no está en gate (status: ${state.status})`);
        process.exit(1);
    }
    if (!state.plan) { console.error('Plan no encontrado en el run.'); process.exit(1); }

    if (reject) {
        await store.save({
            ...state,
            status:      'failed',
            completedAt: ts(),
            error:       `Gate rechazado. Step: ${state.waitingGate!.stepId}. Notas: ${notes ?? '(ninguna)'}`,
            waitingGate: undefined,
        });
        console.log('❌ Gate rechazado — run detenido.');
        return;
    }

    const priorResults: ExecutionResult[] = state.completedSteps.map(s => ({
        subtask_id:  s.stepId,
        agent_id:    s.agentId,
        task:        s.task,
        result:      s.output,
        success:     s.success,
        duration_ms: s.durationMs,
    }));

    await store.save({ ...state, status: 'running', waitingGate: undefined });
    console.log(`✅ Gate aprobado — reanudando ${runId}...\n`);

    const rag = await buildRAG(config, resolveDataDir(configPath, config)).catch(() => null);
    const rl  = new PromptReader();
    await executeWithGates(runId, state.plan as TaskPlan, config, rag, store, priorResults, rl);
}

async function cmdList(configPath: string, args: string[]): Promise<void> {
    const statusIdx  = args.indexOf('--status');
    const statusFilt = statusIdx !== -1 ? args[statusIdx + 1] : 'all';

    const store = openStore(configPath);
    const all   = await store.list();
    const runs  = statusFilt === 'all' ? all : all.filter(r => r.status === statusFilt);

    if (runs.length === 0) {
        console.log(statusFilt === 'all' ? 'No hay runs.' : `No hay runs con status "${statusFilt}".`);
        return;
    }

    const ICON: Record<string, string> = {
        running: '⏳', waiting_gate: '⏸', complete: '✓', failed: '✗',
    };

    console.log(`\nRuns (${runs.length}):\n`);
    for (const r of runs.slice(0, 20)) {
        const when = r.startedAt.slice(0, 16).replace('T', ' ');
        console.log(`${ICON[r.status] ?? '?'} ${r.runId}  [${r.status}]  ${when}`);
        console.log(`   ${r.task.slice(0, 80)}`);
        if (r.status === 'waiting_gate' && r.waitingGate) {
            console.log(`   ⏸ gate pendiente en step "${r.waitingGate.stepId}"`);
        }
        if (r.status === 'failed' && r.error) {
            console.log(`   ✗ ${r.error.slice(0, 100)}`);
        }
        console.log('');
    }
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printUsage(): void {
    console.log(`
Uso:
  orchestrator-cli run    <config.yaml> "<tarea>" [--flow <id>]
  orchestrator-cli status <config.yaml> <run_id>
  orchestrator-cli approve <config.yaml> <run_id> [--reject] [--notes "<texto>"]
  orchestrator-cli list   <config.yaml> [--status running|waiting_gate|complete|failed]
`);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const [,, command, configPath, ...rest] = process.argv;

    if (!command || !configPath) { printUsage(); process.exit(1); }

    switch (command) {
        case 'run':     await cmdRun(configPath, rest);     break;
        case 'status':  await cmdStatus(configPath, rest);  break;
        case 'approve': await cmdApprove(configPath, rest); break;
        case 'list':    await cmdList(configPath, rest);    break;
        default:
            console.error(`Comando desconocido: "${command}"`);
            printUsage();
            process.exit(1);
    }
}

main().catch(err => {
    console.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
});
