#!/usr/bin/env node

// Load .env before any imports read process.env
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

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput                                            from 'ink-text-input';
import * as path                                           from 'node:path';
import { loadConfig, resolveDataDir, type OrchestratorConfig } from './config.js';
import { RunStore, type RunState, type StepResult }        from './run-store.js';
import { TaskPlanner, type TaskPlan }                      from './planner.js';
import { PlanExecutor, type ExecutionResult }              from './executor.js';
import { OpenAICompatibleProvider, callLLM }               from './provider.js';
import { buildRAG }                                        from './rag.js';
import { matchFlow, flowToTaskPlan, loadFlow }             from './static-flow.js';
import { WorkspaceManager }                                from '../../workspace-manager-project/dist/WorkspaceManager.js';

// ── Shared helpers ────────────────────────────────────────────────────────────

const ts = () => new Date().toISOString();

function toStepResult(r: ExecutionResult): StepResult {
    return { stepId: r.subtask_id, agentId: r.agent_id, task: r.task, output: r.result, success: r.success, durationMs: r.duration_ms };
}

async function buildPlan(
    config:     OrchestratorConfig,
    configPath: string,
    rag:        { search: (q: string) => Promise<string> } | null,
    task:       string,
    flowId:     string,
): Promise<TaskPlan> {
    const configDir = path.dirname(path.resolve(configPath));
    if (flowId) {
        const entry = config.flows?.find(f => f.id === flowId);
        if (!entry) throw new Error(`Flow "${flowId}" no encontrado`);
        return flowToTaskPlan(loadFlow(path.resolve(configDir, entry.file)), {});
    }
    if (config.flows?.length) {
        const m = matchFlow(config.flows, configDir, task);
        if (m) return flowToTaskPlan(m.flow, {});
    }
    const prov = config.providers[config.orchestrator.provider];
    if (!prov) throw new Error(`Provider "${config.orchestrator.provider}" no configurado`);
    const provider = new OpenAICompatibleProvider(prov);
    const planner  = new TaskPlanner((sys, usr) => callLLM(provider, sys, usr));
    const ctx      = rag ? await rag.search(task).catch(() => '') : undefined;
    return planner.plan(task, config.agents, ctx);
}

// ── Terminal size hook ────────────────────────────────────────────────────────

function useTerminalSize(): [number, number] {
    const [size, setSize] = useState<[number, number]>([
        process.stdout.columns ?? 80,
        process.stdout.rows    ?? 24,
    ]);
    useEffect(() => {
        const onResize = () => setSize([process.stdout.columns ?? 80, process.stdout.rows ?? 24]);
        process.stdout.on('resize', onResize);
        return () => { process.stdout.off('resize', onResize); };
    }, []);
    return size;
}

// ── Display helpers ───────────────────────────────────────────────────────────

const STATUS_ICON:  Record<string, string> = { running: '⏳', waiting_gate: '⏸', complete: '✓', failed: '✗' };
const STATUS_COLOR: Record<string, string> = { running: 'yellow', waiting_gate: 'cyan', complete: 'green', failed: 'red' };

function timeAgo(iso: string): string {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m`;
    return `${Math.floor(s / 3600)}h`;
}

// ── RunDetail component ───────────────────────────────────────────────────────

interface RunDetailProps {
    run:           RunState;
    isExecuting:   boolean;
    progressLines: string[];
    maxLines?:     number;
}

function RunDetail({ run, isExecuting, progressLines }: RunDetailProps) {
    const gate = run.waitingGate;

    return (
        <Box flexDirection="column" gap={1}>
            {/* Title */}
            <Box flexDirection="column">
                <Box gap={1}>
                    <Text color={STATUS_COLOR[run.status] ?? 'white'} bold>
                        {STATUS_ICON[run.status]} [{run.status}]
                    </Text>
                    <Text dimColor>{run.runId}</Text>
                </Box>
                <Text>{run.task}</Text>
                <Text dimColor>
                    Iniciado: {timeAgo(run.startedAt)} atrás
                    {run.completedAt ? `  ·  Finalizado: ${timeAgo(run.completedAt)} atrás` : ''}
                </Text>
            </Box>

            {/* Completed steps */}
            {run.completedSteps.length > 0 && (
                <Box flexDirection="column">
                    <Text bold>Pasos ({run.completedSteps.length}):</Text>
                    {run.completedSteps.slice(-6).map(s => (
                        <Text key={s.stepId}>
                            {'  '}
                            <Text color={s.success ? 'green' : 'red'}>{s.success ? '✓' : '✗'}</Text>
                            <Text dimColor> [{s.agentId}] </Text>
                            {s.task.slice(0, 55)}
                        </Text>
                    ))}
                </Box>
            )}

            {/* Live progress */}
            {isExecuting && (
                <Box flexDirection="column">
                    <Text color="yellow" bold>⏳ Ejecutando...</Text>
                    {progressLines.slice(-6).map((line, i) => (
                        <Text key={i} dimColor>{line}</Text>
                    ))}
                </Box>
            )}

            {/* Gate */}
            {run.status === 'waiting_gate' && gate && (
                <Box flexDirection="column" borderStyle="single" borderColor="cyan" paddingX={1}>
                    <Text color="cyan" bold>⏸  Gate: {gate.stepId}  [{gate.agentId}]</Text>

                    {gate.criteria.length > 0 && (
                        <Box flexDirection="column" marginTop={1}>
                            <Text bold>Criterios:</Text>
                            {gate.criteria.map((c, i) => <Text key={i}> • {c}</Text>)}
                        </Box>
                    )}

                    <Box flexDirection="column" marginTop={1}>
                        <Text bold>Salida del agente:</Text>
                        {gate.output.slice(0, 600).split('\n').slice(0, 12).map((line, i) => (
                            <Text key={i} dimColor>{line}</Text>
                        ))}
                        {gate.output.length > 600 && <Text dimColor>  ... (truncado)</Text>}
                    </Box>

                    <Box marginTop={1} gap={3}>
                        <Text color="green" bold>[A] Aprobar</Text>
                        <Text color="red"   bold>[X] Rechazar</Text>
                    </Box>
                </Box>
            )}

            {/* Final report */}
            {run.status === 'complete' && run.finalReport && (
                <Box flexDirection="column">
                    <Text color="green" bold>Reporte final:</Text>
                    {run.finalReport.split('\n').slice(0, 12).map((line, i) => (
                        <Text key={i} dimColor>{line}</Text>
                    ))}
                </Box>
            )}

            {/* Error */}
            {run.status === 'failed' && run.error && (
                <Text color="red">✗ {run.error.slice(0, 200)}</Text>
            )}
        </Box>
    );
}

// ── NewRunDialog component ────────────────────────────────────────────────────

interface NewRunDialogProps {
    taskValue:    string;
    flowValue:    string;
    activeField:  'task' | 'flow';
    onTaskChange: (v: string) => void;
    onFlowChange: (v: string) => void;
    project?:     { name: string; root: string } | null;
}

function NewRunDialog({ taskValue, flowValue, activeField, onTaskChange, onFlowChange, project }: NewRunDialogProps) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={2} paddingY={1}>
            <Box gap={2}>
                <Text bold color="yellow">Nueva tarea</Text>
                {project
                    ? <Text dimColor>proyecto: <Text color="cyan">{project.name}</Text></Text>
                    : <Text color="red">⚠ sin proyecto activo — usá [P] para seleccionar</Text>
                }
            </Box>
            <Box marginTop={1} gap={1}>
                <Text>{activeField === 'task' ? '▶' : ' '} Descripción:</Text>
                <TextInput
                    value={taskValue}
                    onChange={onTaskChange}
                    focus={activeField === 'task'}
                    placeholder="implementar módulo de JWT..."
                />
            </Box>
            <Box gap={1}>
                <Text>{activeField === 'flow' ? '▶' : ' '} Flow ID    :</Text>
                <TextInput
                    value={flowValue}
                    onChange={onFlowChange}
                    focus={activeField === 'flow'}
                    placeholder="sdd-implement (opcional)"
                />
            </Box>
            <Box marginTop={1}>
                <Text dimColor>[Enter] Ejecutar  [Tab] Cambiar campo  [Esc] Cancelar</Text>
            </Box>
        </Box>
    );
}

// ── RejectDialog component ────────────────────────────────────────────────────

interface RejectDialogProps {
    value:    string;
    onChange: (v: string) => void;
}

function RejectDialog({ value, onChange }: RejectDialogProps) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="red" paddingX={2} paddingY={1}>
            <Text bold color="red">Rechazar gate</Text>
            <Box marginTop={1} gap={1}>
                <Text>Motivo:</Text>
                <TextInput value={value} onChange={onChange} focus placeholder="(opcional)" />
            </Box>
            <Box marginTop={1}>
                <Text dimColor>[Enter] Confirmar  [Esc] Cancelar</Text>
            </Box>
        </Box>
    );
}

// ── ProjectSelector component ─────────────────────────────────────────────────

interface ProjectItem { id: string; name: string; root: string; active: boolean }

interface ProjectSelectorProps {
    projects:    ProjectItem[];
    selectedIdx: number;
}

// projects.length = índice de la opción "+ Crear nuevo"
function ProjectSelector({ projects, selectedIdx }: ProjectSelectorProps) {
    const total      = projects.length + 1;            // +1 para la opción crear
    const winStart   = Math.max(0, Math.min(selectedIdx - 3, total - 6));
    const winItems   = Array.from({ length: Math.min(6, total) }, (_, i) => winStart + i);

    return (
        <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
            <Text bold color="cyan">Proyectos</Text>
            <Box flexDirection="column" marginTop={1}>
                {winItems.map(idx => {
                    const sel     = idx === selectedIdx;
                    const isCreate = idx === projects.length;
                    if (isCreate) {
                        return (
                            <Text key="create" bold={sel}
                                color={sel ? 'white' : 'green'}
                                backgroundColor={sel ? 'green' : undefined}>
                                {sel ? '▶' : ' '} + Crear nuevo proyecto
                            </Text>
                        );
                    }
                    const p = projects[idx];
                    if (!p) return null;
                    return (
                        <Text key={p.id} bold={sel}
                            color={sel ? 'white' : p.active ? 'cyan' : 'gray'}
                            backgroundColor={sel ? 'blue' : undefined}>
                            {sel ? '▶' : ' '}{p.active ? '●' : ' '} {p.name.slice(0, 20).padEnd(20)}  {p.root.slice(0, 32)}
                        </Text>
                    );
                })}
            </Box>
            <Box marginTop={1}>
                <Text dimColor>[↑↓] Navegar  [Enter] Seleccionar  [Esc] Cancelar</Text>
            </Box>
        </Box>
    );
}

// ── ProjectCreateDialog component ─────────────────────────────────────────────

type CreateField = 'name' | 'root' | 'desc';

interface ProjectCreateDialogProps {
    nameValue:    string;
    rootValue:    string;
    descValue:    string;
    activeField:  CreateField;
    onNameChange: (v: string) => void;
    onRootChange: (v: string) => void;
    onDescChange: (v: string) => void;
    error:        string;
}

function ProjectCreateDialog({
    nameValue, rootValue, descValue,
    activeField, onNameChange, onRootChange, onDescChange, error,
}: ProjectCreateDialogProps) {
    return (
        <Box flexDirection="column" borderStyle="round" borderColor="green" paddingX={2} paddingY={1}>
            <Text bold color="green">Crear proyecto</Text>
            <Box marginTop={1} gap={1}>
                <Text>{activeField === 'name' ? '▶' : ' '} Nombre:</Text>
                <TextInput value={nameValue} onChange={onNameChange}
                    focus={activeField === 'name'} placeholder="mi-app" />
            </Box>
            <Box gap={1}>
                <Text>{activeField === 'root' ? '▶' : ' '} Root  :</Text>
                <TextInput value={rootValue} onChange={onRootChange}
                    focus={activeField === 'root'} placeholder="/dev/mi-app" />
            </Box>
            <Box gap={1}>
                <Text>{activeField === 'desc' ? '▶' : ' '} Desc  :</Text>
                <TextInput value={descValue} onChange={onDescChange}
                    focus={activeField === 'desc'} placeholder="(opcional)" />
            </Box>
            {error && <Text color="red">✗ {error}</Text>}
            <Box marginTop={1}>
                <Text dimColor>[Enter] Crear  [Tab] Siguiente campo  [Esc] Cancelar</Text>
            </Box>
        </Box>
    );
}

// ── App ───────────────────────────────────────────────────────────────────────

type View = 'list' | 'new-run' | 'reject-notes' | 'project-select' | 'project-create';

interface AppProps {
    configPath: string;
    config:     OrchestratorConfig;
    store:      RunStore;
    rag:        { search: (q: string) => Promise<string> } | null;
}

function App({ configPath, config, store, rag }: AppProps) {
    const { exit } = useApp();

    const [runs,          setRuns]          = useState<RunState[]>([]);
    const [selectedIdx,   setSelectedIdx]   = useState(0);
    const [view,          setView]          = useState<View>('list');
    const [taskInput,     setTaskInput]     = useState('');
    const [flowInput,     setFlowInput]     = useState('');
    const [activeField,   setActiveField]   = useState<'task' | 'flow'>('task');
    const [rejectNotes,   setRejectNotes]   = useState('');
    const [progressLines, setProgressLines] = useState<string[]>([]);
    const [executingId,   setExecutingId]   = useState<string | null>(null);
    const [error,         setError]         = useState('');

    // ── Workspace-manager project state ───────────────────────────────────────
    const wm = useRef(new WorkspaceManager()).current;
    const [activeProject,  setActiveProject]  = useState<{ name: string; root: string } | null>(null);
    const [projects,       setProjects]       = useState<ProjectItem[]>([]);
    const [projSelIdx,     setProjSelIdx]     = useState(0);

    // project-create form
    const [projNameInput,  setProjNameInput]  = useState('');
    const [projRootInput,  setProjRootInput]  = useState('');
    const [projDescInput,  setProjDescInput]  = useState('');
    const [projCreateFld,  setProjCreateFld]  = useState<CreateField>('name');
    const [projCreateErr,  setProjCreateErr]  = useState('');

    const loadProject = useCallback(() => {
        try {
            const { projects: list } = wm.list();
            setProjects(list.map(p => ({ id: p.id, name: p.name, root: p.root, active: p.active })));
            try {
                const cur = wm.current();
                setActiveProject({ name: cur.name, root: cur.root });
            } catch {
                setActiveProject(null);
            }
        } catch {
            setActiveProject(null);
        }
    }, [wm]);

    useEffect(() => { loadProject(); }, [loadProject]);

    const progressBuf = useRef<string[]>([]);

    // ── Poll runs every 2s ────────────────────────────────────────────────────
    const pollRuns = useCallback(async () => {
        const all = await store.list();
        setRuns(all);
        setSelectedIdx(i => (all.length > 0 ? Math.min(i, all.length - 1) : 0));
    }, [store]);

    useEffect(() => {
        pollRuns();
        const t = setInterval(pollRuns, 2000);
        return () => clearInterval(t);
    }, [pollRuns]);

    // ── Flush progress buffer every 300ms ─────────────────────────────────────
    useEffect(() => {
        const t = setInterval(() => {
            if (progressBuf.current.length > 0) {
                setProgressLines(prev => [...prev, ...progressBuf.current].slice(-30));
                progressBuf.current = [];
            }
        }, 300);
        return () => clearInterval(t);
    }, []);

    // ── Core executor ─────────────────────────────────────────────────────────
    const runExecutor = useCallback(async (runId: string, plan: TaskPlan, priorResults: ExecutionResult[]) => {
        setExecutingId(runId);
        setProgressLines([]);
        progressBuf.current = [];
        setError('');

        const executor = new PlanExecutor({
            config,
            ragSearchFn:  rag?.search,
            projectRoot:  activeProject?.root,
            onProgress: (msg) => { progressBuf.current.push(msg); },
        });

        try {
            const result = await executor.execute(plan, priorResults);
            const state  = await store.load(runId);
            if (!state) return;

            if ('gateRequired' in result) {
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
            } else {
                await store.save({
                    ...state,
                    status:         'complete',
                    completedAt:    ts(),
                    completedSteps: result.results.map(toStepResult),
                    finalReport:    result.summary,
                    waitingGate:    undefined,
                });
            }
        } catch (err) {
            const state = await store.load(runId);
            if (state) await store.save({ ...state, status: 'failed', error: err instanceof Error ? err.message : String(err) });
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setExecutingId(null);
            pollRuns();
        }
    }, [config, rag, store, pollRuns]);

    // ── Start new run ─────────────────────────────────────────────────────────
    const startRun = useCallback(async (task: string, flowId: string) => {
        setError('');
        let plan: TaskPlan;
        try {
            plan = await buildPlan(config, configPath, rag, task, flowId);
        } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
            return;
        }

        const runId = store.newRunId();
        await store.save({ runId, task, configPath, status: 'running', startedAt: ts(), updatedAt: ts(), plan, completedSteps: [] });
        await pollRuns();

        // Select the new run
        const all = await store.list();
        const idx = all.findIndex(r => r.runId === runId);
        if (idx !== -1) setSelectedIdx(idx);

        runExecutor(runId, plan, []);
    }, [config, configPath, rag, store, pollRuns, runExecutor]);

    // ── Approve gate ──────────────────────────────────────────────────────────
    const approveGate = useCallback(async (run: RunState) => {
        if (!run.waitingGate || !run.plan) return;
        const priorResults: ExecutionResult[] = run.completedSteps.map(s => ({
            subtask_id: s.stepId, agent_id: s.agentId, task: s.task,
            result: s.output, success: s.success, duration_ms: s.durationMs,
        }));
        await store.save({ ...run, status: 'running', waitingGate: undefined });
        await pollRuns();
        runExecutor(run.runId, run.plan as TaskPlan, priorResults);
    }, [store, pollRuns, runExecutor]);

    // ── Reject gate ───────────────────────────────────────────────────────────
    const rejectGate = useCallback(async (run: RunState, notes: string) => {
        await store.save({
            ...run,
            status:      'failed',
            completedAt: ts(),
            error:       `Gate rechazado. Step: ${run.waitingGate!.stepId}. Notas: ${notes || '(ninguna)'}`,
            waitingGate: undefined,
        });
        await pollRuns();
    }, [store, pollRuns]);

    // ── Keyboard ──────────────────────────────────────────────────────────────
    useInput((input, key) => {
        if (view === 'new-run') {
            if (key.escape) {
                setView('list');
                setTaskInput(''); setFlowInput(''); setActiveField('task');
            } else if (key.tab) {
                setActiveField(f => f === 'task' ? 'flow' : 'task');
            } else if (key.return && taskInput.trim()) {
                const task = taskInput.trim();
                const flow = flowInput.trim();
                setView('list');
                setTaskInput(''); setFlowInput(''); setActiveField('task');
                startRun(task, flow);
            }
            return;
        }

        if (view === 'reject-notes') {
            if (key.escape) {
                setView('list'); setRejectNotes('');
            } else if (key.return) {
                const run   = runs[selectedIdx];
                const notes = rejectNotes;
                setView('list'); setRejectNotes('');
                if (run?.status === 'waiting_gate') rejectGate(run, notes);
            }
            return;
        }

        // ── project-select view ───────────────────────────────────────────────
        if (view === 'project-select') {
            if (key.escape) { setView('list'); return; }
            if (key.upArrow)   { setProjSelIdx(i => Math.max(0, i - 1)); return; }
            if (key.downArrow) { setProjSelIdx(i => Math.min(projects.length, i + 1)); return; }
            if (key.return) {
                if (projSelIdx === projects.length) {
                    // opción "crear nuevo"
                    setProjNameInput(''); setProjRootInput(''); setProjDescInput('');
                    setProjCreateFld('name'); setProjCreateErr('');
                    setView('project-create');
                } else {
                    const proj = projects[projSelIdx];
                    if (proj) {
                        try { wm.switch(proj.id); loadProject(); }
                        catch (err) { setError(err instanceof Error ? err.message : String(err)); }
                    }
                    setView('list');
                }
            }
            return;
        }

        // ── project-create view ───────────────────────────────────────────────
        if (view === 'project-create') {
            if (key.escape) { setView('project-select'); setProjCreateErr(''); return; }
            if (key.tab) {
                setProjCreateFld(f => f === 'name' ? 'root' : f === 'root' ? 'desc' : 'name');
                return;
            }
            if (key.return) {
                const name = projNameInput.trim();
                const root = projRootInput.trim();
                if (!name) { setProjCreateErr('El nombre es obligatorio'); return; }
                if (!root) { setProjCreateErr('El root es obligatorio'); return; }
                try {
                    const absRoot = pathSync.resolve(root);
                    const dirs = [
                        absRoot,
                        pathSync.join(absRoot, 'src'),
                        pathSync.join(absRoot, '.specs'),
                        pathSync.join(absRoot, '.qa'),
                        pathSync.join(absRoot, '.security'),
                    ];
                    for (const dir of dirs) fsSync.mkdirSync(dir, { recursive: true });
                    wm.create(name, absRoot, projDescInput.trim() || undefined);
                    wm.switch(name);
                    loadProject();
                    setView('list');
                    setProjNameInput(''); setProjRootInput(''); setProjDescInput('');
                } catch (err) {
                    setProjCreateErr(err instanceof Error ? err.message : String(err));
                }
            }
            return;
        }

        // ── list view ─────────────────────────────────────────────────────────
        if (key.upArrow)   setSelectedIdx(i => Math.max(0, i - 1));
        if (key.downArrow) setSelectedIdx(i => Math.min(runs.length - 1, i + 1));
        if ((input === 'q' || input === 'Q') || (key.ctrl && input === 'c')) exit();
        if ((input === 'n' || input === 'N') && !executingId) {
            setView('new-run'); setActiveField('task');
        }
        if (input === 'p' || input === 'P') {
            const activeIdx = projects.findIndex(p => p.active);
            setProjSelIdx(activeIdx >= 0 ? activeIdx : 0);
            setView('project-select');
        }
        if ((input === 'a' || input === 'A') && !executingId) {
            const run = runs[selectedIdx];
            if (run?.status === 'waiting_gate') approveGate(run);
        }
        if (input === 'x' || input === 'X') {
            const run = runs[selectedIdx];
            if (run?.status === 'waiting_gate') { setView('reject-notes'); setRejectNotes(''); }
        }
        if (input === 'r' || input === 'R') { pollRuns(); loadProject(); }
    });

    const selected = runs[selectedIdx];

    // ── Stable terminal dimensions ─────────────────────────────────────────────
    const [termCols, termRows] = useTerminalSize();

    // Layout constants
    const HEADER_H = 3;
    const LIST_W   = 38;

    const dialogH = view === 'new-run'         ? 7
                  : view === 'reject-notes'    ? 6
                  : view === 'project-select'  ? Math.min(projects.length + 6, 13)
                  : view === 'project-create'  ? 9
                  : 0;
    const bodyH = termRows - HEADER_H - dialogH;

    // How many list items fit (bodyH minus 2 borders minus 3 header lines in panel)
    const maxListItems = Math.max(1, bodyH - 4);

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <Box flexDirection="column" height={termRows} width={termCols}>

            {/* ── Header — fixed 3 lines ──────────────────────────────────── */}
            <Box borderStyle="single" paddingX={1} gap={2}>
                <Text bold color="cyan">🎯</Text>
                {activeProject
                    ? <><Text bold color="white">{activeProject.name}</Text><Text dimColor> {activeProject.root.slice(0, 30)}</Text></>
                    : <Text dimColor>(sin proyecto)</Text>
                }
                <Text dimColor>│</Text>
                {!executingId
                    ? <Text color="yellow">[N] Nueva</Text>
                    : <Text color="yellow">⏳ ejecutando...</Text>
                }
                <Text color="yellow">[P] Proyecto  [R] Refresh  [Q] Salir</Text>
                {error && <Text color="red"> ⚠ {error.slice(0, 30)}</Text>}
            </Box>

            {/* ── Body — fixed height, clips overflow ─────────────────────── */}
            <Box height={bodyH}>

                {/* Left: run list */}
                <Box
                    flexDirection="column"
                    width={LIST_W}
                    height={bodyH}
                    overflow="hidden"
                    borderStyle="single"
                    borderTop={false}
                    paddingX={1}
                >
                    <Text bold>Runs ({runs.length})</Text>
                    <Text dimColor>↑↓ navegar</Text>
                    <Box flexDirection="column" marginTop={1}>
                        {runs.length === 0 ? (
                            <Text dimColor>Sin runs — [N] para crear</Text>
                        ) : (
                            // Show a window of items around selectedIdx
                            (() => {
                                const start = Math.max(0, Math.min(selectedIdx - Math.floor(maxListItems / 2), runs.length - maxListItems));
                                return runs.slice(start, start + maxListItems).map((r, i) => {
                                    const realIdx = start + i;
                                    const active  = realIdx === selectedIdx;
                                    return (
                                        <Text
                                            key={r.runId}
                                            bold={active}
                                            color={active ? 'white' : (STATUS_COLOR[r.status] ?? 'gray')}
                                            backgroundColor={active ? 'blue' : undefined}
                                        >
                                            {active ? '▶' : ' '}
                                            {' '}{STATUS_ICON[r.status] ?? '?'}{' '}
                                            {r.task.slice(0, 18).padEnd(18)}
                                            {'  '}{timeAgo(r.startedAt)}
                                        </Text>
                                    );
                                });
                            })()
                        )}
                    </Box>
                </Box>

                {/* Right: detail — clips to bodyH, never causes distortion */}
                <Box
                    flexDirection="column"
                    flexGrow={1}
                    height={bodyH}
                    overflow="hidden"
                    borderStyle="single"
                    borderTop={false}
                    borderLeft={false}
                    paddingX={1}
                >
                    {!selected ? (
                        <Text dimColor>Seleccioná un run con ↑↓</Text>
                    ) : (
                        <RunDetail
                            run={selected}
                            isExecuting={executingId === selected.runId}
                            progressLines={progressLines}
                            maxLines={bodyH - 2}
                        />
                    )}
                </Box>
            </Box>

            {/* ── Dialogs — shown below body, total stays within termRows ─── */}
            {view === 'new-run' && (
                <NewRunDialog
                    taskValue={taskInput}
                    flowValue={flowInput}
                    activeField={activeField}
                    onTaskChange={setTaskInput}
                    onFlowChange={setFlowInput}
                    project={activeProject}
                />
            )}
            {view === 'reject-notes' && (
                <RejectDialog value={rejectNotes} onChange={setRejectNotes} />
            )}
            {view === 'project-select' && (
                <ProjectSelector projects={projects} selectedIdx={projSelIdx} />
            )}
            {view === 'project-create' && (
                <ProjectCreateDialog
                    nameValue={projNameInput}   onNameChange={setProjNameInput}
                    rootValue={projRootInput}   onRootChange={setProjRootInput}
                    descValue={projDescInput}   onDescChange={setProjDescInput}
                    activeField={projCreateFld} error={projCreateErr}
                />
            )}
        </Box>
    );
}

// ── Entry point ───────────────────────────────────────────────────────────────

async function main() {
    const configPath = process.argv[2];
    if (!configPath) {
        process.stderr.write('Uso: orchestrator-tui <config.yaml>\n');
        process.exit(1);
    }

    let config: OrchestratorConfig;
    try { config = loadConfig(configPath); }
    catch (err) {
        process.stderr.write(`Config: ${err instanceof Error ? err.message : String(err)}\n`);
        process.exit(1);
    }

    const store = new RunStore(path.join(resolveDataDir(configPath, config), 'runs'));
    const rag   = await buildRAG(config, resolveDataDir(configPath, config)).catch(() => null);

    render(<App configPath={configPath} config={config} store={store} rag={rag} />, { exitOnCtrlC: true });
}

main().catch(err => {
    process.stderr.write(`Fatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
});
