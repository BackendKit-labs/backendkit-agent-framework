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
import * as fs                                                         from 'node:fs';
import { stdin, stdout }                                               from 'node:process';
import * as path                                                       from 'node:path';
import { loadConfig, resolveDataDir, type OrchestratorConfig }        from './config.js';
import { PlanExecutor, type ExecutionResult }                          from './executor.js';
import { RunStore, type RunState, type StepResult }                   from './run-store.js';
import { buildRAG }                                                    from './rag.js';
import {
    TaskPlanner, type TaskPlan,
    OpenAICompatibleProvider, callLLM,
    matchFlow, flowToTaskPlan, loadFlow,
} from '@backendkit-labs/orchestrator-agent';
import { WorkspaceManager }                                            from '../../workspace-manager-project/dist/WorkspaceManager.js';
import { generateDesign }                                              from './design.js';
import { PhaseRunner }                                                 from './phase-runner.js';
import type { PhaseState }                                             from './run-store.js';

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
            this.waiters.length = 0;
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
    configDir:    string,
): Promise<void> {
    // Resolve project root from workspace-manager (best-effort)
    let projectRoot: string | undefined;
    try { projectRoot = new WorkspaceManager().current().root; } catch { /* no active project */ }

    while (true) {
        const executor = new PlanExecutor({
            config,
            ragSearchFn: rag?.search,
            projectRoot,
            configDir,
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

    let projectRoot: string | undefined;
    try { projectRoot = new WorkspaceManager().current().root; } catch { /* no active project */ }

    const runId = store.newRunId();
    await store.save({
        runId, task, configPath,
        projectRoot,
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
    await executeWithGates(runId, plan, config, rag, store, [], rl, configDir);
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

    if (state.phaseState) {
        const ps = state.phaseState;
        console.log(`\n   SDD: fase ${ps.currentPhase}/${ps.totalPhases} — ${ps.phaseTitle}` +
            (ps.reworkCount > 0 ? `  (rework #${ps.reworkCount})` : '') +
            (ps.verdict ? `  · QA: ${ps.verdict}` : ''));
        ps.phaseTitles.forEach((t, i) => {
            const n = i + 1;
            const mark = n < ps.currentPhase ? '✓' : n === ps.currentPhase ? '▶' : ' ';
            console.log(`     ${mark} Fase ${n}: ${t}`);
        });
    }

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
    await executeWithGates(runId, state.plan as TaskPlan, config, rag, store, priorResults, rl, path.dirname(path.resolve(configPath)));
}

async function cmdList(configPath: string, args: string[]): Promise<void> {
    const statusIdx  = args.indexOf('--status');
    const statusFilt = statusIdx !== -1 ? args[statusIdx + 1] : 'all';
    const showAll    = args.includes('--all');

    const store = openStore(configPath);
    const all   = await store.list();

    // By default filter by active project; --all shows every run
    let projectRoot: string | undefined;
    if (!showAll) {
        try { projectRoot = new WorkspaceManager().current().root; } catch { /* no active project */ }
    }

    const byProject = projectRoot ? all.filter(r => r.projectRoot === projectRoot) : all;
    const runs = statusFilt === 'all' ? byProject : byProject.filter(r => r.status === statusFilt);

    if (projectRoot) console.log(`Proyecto activo: ${projectRoot}\n`);

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

// ── project command ───────────────────────────────────────────────────────────

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string> } {
    const positional: string[] = [];
    const flags: Record<string, string> = {};
    let i = 0;
    while (i < args.length) {
        if (args[i].startsWith('--')) {
            const key = args[i].slice(2);
            flags[key] = args[i + 1] ?? '';
            i += 2;
        } else {
            positional.push(args[i]);
            i++;
        }
    }
    return { positional, flags };
}

async function cmdProject(args: string[]): Promise<void> {
    const [sub, ...rest] = args;
    if (!sub) { printProjectUsage(); process.exit(1); }

    const wm = new WorkspaceManager();
    const { positional, flags } = parseFlags(rest);

    switch (sub) {

        case 'list': {
            const { current, projects } = wm.list();
            if (projects.length === 0) {
                console.log('Sin proyectos. Usá: orchestrator-cli project create <nombre> --root <path>');
                return;
            }
            console.log(`\nProyectos (${projects.length}):\n`);
            for (const p of projects) {
                const marker = p.id === current ? '▶' : ' ';
                const tag    = p.id === current ? ' [activo]' : '';
                console.log(`${marker} ${p.name}${tag}`);
                console.log(`    id  : ${p.id}`);
                console.log(`    root: ${p.root}`);
                console.log('');
            }
            break;
        }

        case 'current': {
            let project: ReturnType<WorkspaceManager['current']>;
            try { project = wm.current(); }
            catch (err) { console.error(err instanceof Error ? err.message : String(err)); process.exit(1); }

            console.log(`\nProyecto activo: ${project.name}`);
            console.log(`root: ${project.root}`);
            if (project.description) console.log(`desc: ${project.description}`);

            console.log(`\nAgentes:`);
            for (const [id, cfg] of Object.entries(project.agents)) {
                console.log(`  ${id.padEnd(10)} modelo: ${cfg.model}  temp: ${cfg.temperature}`);
            }

            console.log(`\nGates:`);
            console.log(`  designReview  : ${project.gates.designReview}`);
            console.log(`  qaApproval    : ${project.gates.qaApproval}`);
            console.log(`  securityReview: ${project.gates.securityReview}`);

            console.log(`\nPolicies: ${project.policies.enabled.join(', ') || '(ninguna)'}`);
            console.log(`Memoria  : namespace "${project.memory.namespace}" — ${project.memory.enabled ? 'activa' : 'inactiva'}`);
            break;
        }

        case 'switch': {
            const name = positional[0];
            if (!name) { console.error('Error: se requiere el nombre del proyecto'); process.exit(1); }
            try {
                const result = wm.switch(name);
                console.log(`✓ Proyecto activo: ${result.previous ?? '(ninguno)'} → ${result.current}`);
            } catch (err) {
                console.error(err instanceof Error ? err.message : String(err));
                process.exit(1);
            }
            break;
        }

        case 'create': {
            const name = positional[0];
            const root = flags['root'];
            const desc = flags['description'] || flags['desc'];

            if (!name) { console.error('Error: se requiere el nombre del proyecto'); process.exit(1); }
            if (!root) { console.error('Error: se requiere --root <path>'); process.exit(1); }

            const absRoot = path.resolve(root);

            // Crear estructura de directorios en disco
            const dirs = [
                absRoot,
                path.join(absRoot, 'src'),
                path.join(absRoot, '.specs'),
                path.join(absRoot, '.qa'),
                path.join(absRoot, '.security'),
            ];
            for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

            // Registrar en workspace-manager
            let project: ReturnType<WorkspaceManager['current']>;
            try {
                ({ project } = wm.create(name, absRoot, desc));
            } catch (err) {
                console.error(err instanceof Error ? err.message : String(err));
                process.exit(1);
            }

            // Activar automáticamente
            wm.switch(name);

            console.log(`\n✓ Proyecto "${project.name}" creado y activado`);
            console.log(`  root: ${project.root}`);
            console.log(`\n  Directorios:`);
            dirs.forEach(d => console.log(`    ${d}`));
            console.log(`\n  Próximo paso:`);
            console.log(`    orchestrator-cli design <config.yaml> "<feature>"`);
            break;
        }

        case 'delete': {
            const name = positional[0];
            if (!name) { console.error('Error: se requiere el nombre del proyecto'); process.exit(1); }

            const rl = new PromptReader();
            const answer = await rl.question(`¿Eliminar proyecto "${name}"? [y/n]: `);
            rl.close();

            if (!answer.trim().toLowerCase().startsWith('y')) {
                console.log('Cancelado.');
                return;
            }

            try {
                wm.delete(name);
                console.log(`✓ Proyecto "${name}" eliminado del registro.`);
                console.log(`  (El directorio en disco no fue borrado.)`);
            } catch (err) {
                console.error(err instanceof Error ? err.message : String(err));
                process.exit(1);
            }
            break;
        }

        case 'update': {
            // orchestrator-cli project update <nombre> --gate.designReview auto --agents.backend.model gpt-4o
            const name = positional[0];
            if (!name) { console.error('Error: se requiere el nombre del proyecto'); process.exit(1); }

            if (Object.keys(flags).length === 0) {
                console.error('Error: se requiere al menos un flag --<campo> <valor>');
                process.exit(1);
            }

            try {
                const { changes } = wm.update(name, flags);
                console.log(`✓ Proyecto "${name}" actualizado:`);
                changes.forEach(c => console.log(`  ${c}`));
            } catch (err) {
                console.error(err instanceof Error ? err.message : String(err));
                process.exit(1);
            }
            break;
        }

        default:
            console.error(`Subcomando desconocido: "${sub}"`);
            printProjectUsage();
            process.exit(1);
    }
}

// ── design command ────────────────────────────────────────────────────────────

async function cmdDesign(configPath: string, args: string[]): Promise<void> {
    // Flags: --project <name>  --root <path>
    const projectFlagIdx = args.indexOf('--project');
    const rootFlagIdx    = args.indexOf('--root');

    const projectName = projectFlagIdx !== -1 ? args[projectFlagIdx + 1] : undefined;
    const rootOverride = rootFlagIdx !== -1 ? args[rootFlagIdx + 1] : undefined;

    // Feature = remaining tokens after removing flags
    const featureTokens = args.filter((_, i) => {
        if (projectFlagIdx !== -1 && (i === projectFlagIdx || i === projectFlagIdx + 1)) return false;
        if (rootFlagIdx    !== -1 && (i === rootFlagIdx    || i === rootFlagIdx    + 1)) return false;
        return true;
    });
    const feature = featureTokens.join(' ').trim();

    if (!feature) {
        console.error('Error: se requiere la descripción de la feature');
        console.error('Uso: orchestrator-cli design <config.yaml> "<feature>" [--project <nombre>] [--root <path>]');
        process.exit(1);
    }

    // Load orchestrator config (for LLM provider)
    let config: OrchestratorConfig;
    try { config = loadConfig(configPath); }
    catch (err) { console.error(`Config: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }

    // Resolve project root
    let projectRoot: string;
    if (rootOverride) {
        projectRoot = path.resolve(rootOverride);
    } else {
        const wm = new WorkspaceManager();
        try {
            const target = projectName ? wm.getRoot(projectName) : wm.getRoot();
            projectRoot = target.root;
            const name  = target.name;
            console.log(`\nProyecto: ${name}`);
        } catch (err) {
            console.error(err instanceof Error ? err.message : String(err));
            console.error('Hint: usá --root <path> para especificar el directorio manualmente');
            process.exit(1);
        }
    }

    console.log(`Root   : ${projectRoot}`);
    console.log(`Feature: ${feature}`);
    console.log(`\nGenerando artefactos de diseño...\n`);

    let artifacts;
    try {
        artifacts = await generateDesign(config, projectRoot, feature, msg => process.stdout.write(`${msg}\n`));
    } catch (err) {
        console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
    }

    console.log(`\n✓ Artefactos generados en ${path.join(projectRoot, '.specs')}/\n`);
    console.log(`  specification.md  — ${artifacts.spec.split('\n').length} líneas`);
    console.log(`  design.md         — ${artifacts.design.split('\n').length} líneas`);
    console.log(`  ROADMAP.md        — ${artifacts.roadmap.split('\n').length} líneas`);

    // Extract phases count from roadmap
    const phases = (artifacts.roadmap.match(/^## Phase/gm) ?? []).length;
    if (phases > 0) console.log(`\n  ${phases} fases de implementación definidas`);

    console.log(`\nPróximo paso:`);
    console.log(`  orchestrator-cli run ${configPath} "<feature>" --flow sdd-implement`);
}

// ── sdd command — phase-by-phase SDD with rework gates ───────────────────────

async function cmdSdd(configPath: string, args: string[]): Promise<void> {
    let config: OrchestratorConfig;
    try { config = loadConfig(configPath); }
    catch (err) { console.error(`Config: ${err instanceof Error ? err.message : String(err)}`); process.exit(1); }

    const resumeIdx = args.indexOf('--resume');
    const resumeId  = resumeIdx !== -1 ? args[resumeIdx + 1] : undefined;

    // Resolve project root from workspace-manager
    let projectRoot: string | undefined;
    let projectName = '';
    try {
        const cur   = new WorkspaceManager().current();
        projectRoot = cur.root;
        projectName = cur.name;
    } catch {
        console.error('No hay proyecto activo. Usá: orchestrator-cli project switch <nombre>');
        process.exit(1);
    }

    const rag = await buildRAG(config, resolveDataDir(configPath, config)).catch(() => null);
    const runner = new PhaseRunner({
        config,
        projectRoot: projectRoot!,
        ragSearchFn: rag?.search,
        onProgress: (msg) => process.stdout.write(`${msg}\n`),
    });

    if (!runner.hasPhases()) {
        console.error(`No se encontraron fases en el ROADMAP.md de ${projectRoot}`);
        console.error('Generá el diseño primero: orchestrator-cli design <config.yaml> "<feature>"');
        process.exit(1);
    }

    const store = openStore(configPath, config);

    // ── Resolve run: explicit --resume, auto-detect, or fresh start ───────────
    let runId:          string;
    let state:          PhaseState;
    let collectedSteps: StepResult[];

    let resumeRun: RunState | null = null;
    if (resumeId) {
        resumeRun = await store.load(resumeId);
        if (!resumeRun)            { console.error(`Run no encontrado: ${resumeId}`); process.exit(1); }
        if (!resumeRun.phaseState) { console.error(`El run ${resumeId} no es un run SDD.`); process.exit(1); }
    } else {
        // Auto-detect the most recent incomplete SDD run for this project
        const all = await store.list();
        resumeRun = all.find(r =>
            r.projectRoot === projectRoot && r.phaseState && r.status !== 'complete',
        ) ?? null;
    }

    if (resumeRun && resumeRun.phaseState) {
        runId          = resumeRun.runId;
        state          = resumeRun.phaseState;
        collectedSteps = [...resumeRun.completedSteps];
        // A resume re-runs the current phase fresh — clear rework markers
        state.qaFindings  = undefined;
        state.reworkCount = 0;
        state.verdict     = undefined;
        console.log(`\n🔄 Retomando SDD — ${projectName}  (run ${runId})`);
        console.log(`   Reanudando desde la fase ${state.currentPhase}/${state.totalPhases}: ${state.phaseTitle}\n`);
    } else {
        runId          = store.newRunId();
        state          = runner.initialState();
        collectedSteps = [];
        console.log(`\n🚀 SDD iniciado — ${projectName}`);
        console.log(`   ${state.totalPhases} fases en el ROADMAP:`);
        state.phaseTitles.forEach((t, i) => console.log(`     ${i + 1}. ${t}`));
        console.log('');
    }

    const startedAt = resumeRun?.startedAt ?? ts();
    const saveRun = async (extra: Partial<RunState> = {}) => {
        await store.save({
            runId, task: `SDD: ${projectName}`, configPath, projectRoot,
            status: 'running', startedAt, updatedAt: ts(),
            completedSteps: collectedSteps, phaseState: state, ...extra,
        });
    };
    await saveRun();

    const rl = new PromptReader();

    while (true) {
        let step;
        try {
            step = await runner.runCurrentPhase(state, s => collectedSteps.push(s));
        } catch (err) {
            console.error(`\n❌ Error: ${err instanceof Error ? err.message : String(err)}`);
            await saveRun({ status: 'failed', error: err instanceof Error ? err.message : String(err) });
            rl.close();
            process.exit(1);
        }

        if (step.type === 'complete') {
            await saveRun({ status: 'complete', completedAt: ts(), finalReport: step.summary });
            console.log(`\n✅ ${step.summary}\n`);
            rl.close();
            return;
        }

        // ── Phase gate ────────────────────────────────────────────────────────
        const icon = step.verdict === 'GO' ? '✅' : step.verdict === 'NO_GO' ? '❌' : '⚠️';
        console.log(`\n${icon} Gate — Fase ${step.phase}: ${step.phaseTitle}`);
        console.log(`   Veredicto QA: ${step.verdict}`);
        if (step.executionReport) {
            const er = step.executionReport;
            const execIcon = er.passed ? '✅' : '❌';
            console.log(`   Ejecución   : ${execIcon} ${er.stack}` +
                (er.build  ? ` | build ${er.build.success  ? '✓' : `✗ (exit ${er.build.exitCode})`}`  : '') +
                (er.test   ? ` | tests ${er.test.success   ? '✓' : `✗ (exit ${er.test.exitCode})`}`   : ''));
        }
        if (step.criteria.length) {
            console.log('\n   Criterios de la fase:');
            step.criteria.forEach(c => console.log(`     • ${c}`));
        }
        console.log('\n── Reporte QA ─────────────────────────────────────────────────');
        console.log(step.qaOutput.slice(0, 1500));
        console.log('───────────────────────────────────────────────────────────────');

        await saveRun({
            status: 'waiting_gate',
            waitingGate: {
                gateId: `phase-${step.phase}`, stepId: `qa-p${step.phase}`,
                agentId: 'qa', output: step.qaOutput, criteria: step.criteria,
                requestedAt: ts(), verdict: step.verdict, phase: step.phase, allowRework: step.allowRework,
            },
        });

        // Gate loop — repeat while user asks QA questions
        while (true) {
            const hint = step.verdict === 'GO'
                ? '[a] Aprobar y avanzar  [w] Rework  [q] Consultar al QA  [x] Rechazar'
                : '[w] Rework (recomendado)  [a] Aprobar igual  [q] Consultar al QA  [x] Rechazar';
            const answer = (await rl.question(`\n${hint}: `)).trim().toLowerCase();

            if (answer.startsWith('x')) {
                await saveRun({ status: 'failed', completedAt: ts(), error: `Rechazado en fase ${step.phase}`, waitingGate: undefined });
                console.log(`\n❌ SDD detenido en fase ${step.phase}.`);
                console.log(`   Para retomar: orchestrator-cli sdd ${configPath}`);
                rl.close();
                return;
            }

            if (answer.startsWith('q')) {
                const question = (await rl.question('Pregunta al QA (Enter para revisión general): ')).trim();
                console.log('');
                try {
                    const analysis = await runner.queryQA(
                        step.phase,
                        question,
                        step.executionReport,
                        (msg) => process.stdout.write(`${msg}\n`),
                    );
                    console.log('\n── Análisis del QA ────────────────────────────────────────────');
                    console.log(analysis.slice(0, 2000));
                    console.log('───────────────────────────────────────────────────────────────');
                } catch (err) {
                    console.error(`Error en QA: ${err instanceof Error ? err.message : String(err)}`);
                }
                continue; // volvemos al gate prompt
            }

            const decision = answer.startsWith('w') ? 'rework' : 'approve';
            runner.advance(state, decision, step.qaOutput);
            await saveRun({ waitingGate: undefined });

            if (decision === 'approve') {
                console.log(state.stage === 'security'
                    ? `\n✅ Fase ${step.phase} aprobada — todas las fases completas, finalizando...\n`
                    : `\n✅ Fase ${step.phase} aprobada — avanzando a fase ${state.currentPhase}...\n`);
            } else {
                console.log(`\n🔁 Rework de fase ${step.phase} — reimplementando con los hallazgos del QA...\n`);
            }
            break;
        }
    }
}

// ── Usage ─────────────────────────────────────────────────────────────────────

function printProjectUsage(): void {
    console.log(`
Uso:
  orchestrator-cli project list
  orchestrator-cli project current
  orchestrator-cli project create <nombre> --root <path> [--description "<texto>"]
  orchestrator-cli project switch <nombre>
  orchestrator-cli project delete <nombre>
  orchestrator-cli project update <nombre> --<campo> <valor>
`);
}

function printUsage(): void {
    console.log(`
Uso:
  orchestrator-cli project <subcomando>                           — gestión de proyectos
  orchestrator-cli design  <config.yaml> "<feature>"             — genera spec/design/roadmap
                           [--project <nombre>] [--root <path>]
  orchestrator-cli sdd     <config.yaml> [--resume <run_id>]     — SDD por fases del ROADMAP (gates con rework)
  orchestrator-cli run     <config.yaml> "<tarea>" [--flow <id>] — ejecuta implementación
  orchestrator-cli status  <config.yaml> <run_id>
  orchestrator-cli approve <config.yaml> <run_id> [--reject] [--notes "<texto>"]
  orchestrator-cli list    <config.yaml> [--status running|waiting_gate|complete|failed] [--all]
`);
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const [,, command, ...argv] = process.argv;

    if (!command) { printUsage(); process.exit(1); }

    // project no necesita config_path
    if (command === 'project') {
        await cmdProject(argv);
        return;
    }

    // El resto de comandos requieren config_path como segundo arg
    const [configPath, ...rest] = argv;
    if (!configPath) { printUsage(); process.exit(1); }

    switch (command) {
        case 'design':  await cmdDesign(configPath, rest);  break;
        case 'sdd':     await cmdSdd(configPath, rest);     break;
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
