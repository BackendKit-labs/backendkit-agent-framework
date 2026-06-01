import * as path from 'path';
import { SlashCommandRegistry } from './SlashCommandRegistry';
import {
    createCheckpoint,
    listCheckpoints,
    readCheckpoint,
    getLatestCheckpoints,
    extractSessionFromCheckpoint,
} from '../checkpoint';
import {
    loadWorkspaces,
    saveWorkspaces,
    createWorkspace,
    addProject,
    importProject,
    removeProject,
    deleteWorkspace,
    setActiveProject,
    buildWorkspaceContext,
    deriveProjectName,
} from '../workspace';

// ── Internal helper ───────────────────────────────────────────────────────────

async function doSwitch(
    wsName: string,
    projectName: string,
    config: import('../workspace').WorkspacesConfig,
    appName: string,
    emit: (text: string) => void,
    injectContext?: (message: string) => void,
    onCwdChange?: (cwd: string) => void,
): Promise<void> {
    const ws = config[wsName];
    if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
    const target = ws.projects.find(p => p.name === projectName);
    if (!target) { emit(`Project "${projectName}" not found in workspace "${wsName}".`); return; }

    // Persist the new active state
    const updated = setActiveProject(config, wsName, target.name);
    await saveWorkspaces(appName, updated);

    // Inject workspace context into agent memory
    const context = await buildWorkspaceContext(wsName, updated[wsName]!, appName);
    injectContext?.(context);

    if (onCwdChange) {
        onCwdChange(target.cwd);
        emit(`Switched to workspace "${wsName}" — project: ${target.name}`);
    } else {
        emit(`Workspace "${wsName}" loaded — project: ${target.name} (${target.cwd})`);
    }
}

// ── Registry ──────────────────────────────────────────────────────────────────

/**
 * Registers the framework's built-in slash commands into the given registry.
 * Call this once when bootstrapping the app — before registering app-specific commands.
 */
export function registerBuiltinCommands(registry: SlashCommandRegistry): void {
    registry.register('/help', 'List available commands', async (ctx) => {
        const cmds = registry.getAll();
        const list = cmds.map(c => `- ${c.name.padEnd(22)} ${c.description}`).join('\n');
        ctx.emit(`Available commands:\n${list}`);
    });

    registry.register('/agents', 'List available agents', async (ctx) => {
        if (!ctx.agents?.length) { ctx.emit('No agents loaded.'); return; }

        if (ctx.prompt) {
            const selected = await ctx.prompt(
                'Agents disponibles:',
                ctx.agents.map(a => ({ label: `${a.id.padEnd(18)} ${a.name} — ${a.description}`, value: a.id })),
            );
            if (selected) ctx.emit(`Agent: ${selected}`);
        } else {
            const lines = ctx.agents.map(a => `  ${a.id.padEnd(18)} ${a.name} — ${a.description}`);
            ctx.emit('Agents:\n' + lines.join('\n'));
        }
    });

    registry.register('/skills', 'List loaded skills', async (ctx) => {
        if (!ctx.skills?.length) { ctx.emit('No skills loaded.'); return; }

        if (ctx.prompt) {
            const options = ctx.skills.map(s => ({
                label: `${s.name.padEnd(24)} ${s.description}`,
                value: s.name,
            }));
            const INSTALL = '__install__';
            const selected = await ctx.prompt('Skills disponibles:', [
                ...options,
                { label: '+ Instalar pack desde URL...', value: INSTALL },
            ]);

            if (!selected || selected === INSTALL) {
                ctx.emit(
                    selected === INSTALL
                        ? 'Para instalar un pack escribí:\n  /skills install https://skills.sh/owner/repo\no pedime que te guíe.'
                        : '',
                );
                return;
            }

            const skill = ctx.skills.find(s => s.name === selected);
            if (skill) {
                ctx.emit([
                    `Skill: ${skill.name}`,
                    `Descripción: ${skill.description}`,
                    skill.triggers.length ? `Triggers: ${skill.triggers.join(', ')}` : '',
                    skill.language?.length ? `Lenguajes: ${skill.language.join(', ')}` : '',
                ].filter(Boolean).join('\n'));
            }
        } else {
            const lines = ctx.skills.map(s => `  ${s.name.padEnd(24)} ${s.description}`);
            ctx.emit('Skills:\n' + lines.join('\n'));
        }
    });

    registry.register('/status', 'Show current agent and model', async (ctx) => {
        ctx.emit([
            `Agent     : ${ctx.effectiveAgentId ?? '—'}`,
            `Model     : ${ctx.model ?? '—'}`,
            `Iteration : ${ctx.getIterationMode?.() ?? '—'}`,
        ].join('\n'));
    });

    registry.register('/iteration', 'Change or show the iteration mode', async (ctx) => {
        type Mode = 'interactive' | 'auto' | 'step-by-step';
        const MODES: Array<{ label: string; value: Mode; description: string }> = [
            { value: 'interactive', label: 'interactive', description: 'Pauses every N iterations — you decide whether to continue' },
            { value: 'auto',        label: 'auto',        description: 'Never pauses — runs until done or global cap (1000)' },
            { value: 'step-by-step',label: 'step-by-step',description: 'Pauses after every single iteration for maximum control' },
        ];

        const current = ctx.getIterationMode?.();

        // Arg directo: /iteration auto | /iteration step-by-step | /iteration interactive
        if (ctx.args) {
            const arg = ctx.args.trim() as Mode;
            if (MODES.some(m => m.value === arg)) {
                ctx.setIterationMode?.(arg);
                ctx.emit(`Iteration mode → ${arg}`);
            } else {
                ctx.emit(`Unknown mode "${arg}". Options: interactive | auto | step-by-step`);
            }
            return;
        }

        // Sin arg: mostrar modo actual y permitir elegir
        if (ctx.prompt) {
            const selected = await ctx.prompt(
                `Iteration mode (current: ${current ?? '—'}):`,
                MODES.map(m => ({
                    label: `${m.value.padEnd(16)} ${m.description}`,
                    value: m.value,
                })),
            );
            if (selected) {
                ctx.setIterationMode?.(selected as Mode);
                ctx.emit(`Iteration mode → ${selected}`);
            }
        } else {
            const lines = MODES.map(m =>
                `  ${(current === m.value ? '▶ ' : '  ')}${m.value.padEnd(16)} ${m.description}`
            );
            ctx.emit(`Iteration mode (current: ${current ?? '—'}):\n${lines.join('\n')}\n\nUse /iteration <mode> to change.`);
        }
    });

    registry.register('/workspace', 'Manage multi-project workspaces', async (ctx) => {
        const { args, emit, appName, injectContext, onCwdChange } = ctx;
        if (!appName) { emit('appName not set in CommandContext.'); return; }

        const parts = (args ?? '').split(' ').filter(Boolean);
        const sub = parts[0];

        // ── /workspace  or  /workspace list ──────────────────────────────────
        if (!sub || sub === 'list') {
            const config = await loadWorkspaces(appName);
            const names = Object.keys(config);
            if (!names.length) { emit('No workspaces. Use: /workspace create <name>'); return; }

            if (ctx.prompt && !sub) {
                // Interactive: let the user pick a workspace+project to switch to directly
                const options = names.flatMap(wsName => {
                    const ws = config[wsName]!;
                    return ws.projects.map(p => ({
                        label: `${wsName.padEnd(18)} ${p.name}${p.name === ws.active ? ' *' : ''}`,
                        value: `${wsName}::${p.name}`,
                    }));
                });
                const selected = await ctx.prompt('Workspaces — select to switch:', options);
                if (!selected) return;
                const [wsName, projectName] = selected.split('::');
                sub === undefined && await doSwitch(wsName, projectName, config, appName, emit, injectContext, onCwdChange);
                return;
            }

            const lines = names.map(n => {
                const ws = config[n]!;
                const projects = ws.projects
                    .map(p => `${p.name}${p.name === ws.active ? '*' : ''}`)
                    .join(', ') || '(empty)';
                return `  ${n.padEnd(20)} ${projects}`;
            });
            emit('Workspaces (* = active project):\n' + lines.join('\n'));
            return;
        }

        // ── /workspace create <name> ──────────────────────────────────────────
        if (sub === 'create') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace create <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (config[name]) { emit(`Workspace "${name}" already exists.`); return; }
            await saveWorkspaces(appName, createWorkspace(config, name));
            emit(`Workspace "${name}" created.`);
            return;
        }

        // ── /workspace add <workspace> <cwd> [name] ──────────────────────────
        if (sub === 'add') {
            const [, wsName, cwd, projectName] = parts;
            if (!wsName || !cwd) { emit('Usage: /workspace add <workspace> <cwd> [name]'); return; }
            const resolvedCwd = path.resolve(cwd);
            const name = projectName ?? deriveProjectName(resolvedCwd);
            try {
                const config = await loadWorkspaces(appName);
                await saveWorkspaces(appName, addProject(
                    config[wsName] ? config : createWorkspace(config, wsName),
                    wsName,
                    { name, cwd: resolvedCwd },
                ));
                emit(`Added "${name}" to workspace "${wsName}".\n  cwd: ${resolvedCwd}`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace import <cwd> [workspace] [name] ───────────────────────
        // Like add but auto-creates the workspace if missing. Useful for quick onboarding.
        if (sub === 'import') {
            const [, cwd, wsName, projectName] = parts;
            if (!cwd) { emit('Usage: /workspace import <cwd> [workspace] [name]'); return; }
            const resolvedCwd = path.resolve(cwd);
            const name = projectName ?? deriveProjectName(resolvedCwd);
            const ws   = wsName ?? name;
            try {
                const config = await loadWorkspaces(appName);
                await saveWorkspaces(appName, importProject(config, ws, { name, cwd: resolvedCwd }));
                emit(`Imported "${name}" into workspace "${ws}".\n  cwd: ${resolvedCwd}`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace remove <workspace> <project> ───────────────────────────
        if (sub === 'remove') {
            const [, wsName, projectName] = parts;
            if (!wsName || !projectName) { emit('Usage: /workspace remove <workspace> <project>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[wsName]) { emit(`Workspace "${wsName}" not found.`); return; }
            try {
                await saveWorkspaces(appName, removeProject(config, wsName, projectName));
                emit(`Removed "${projectName}" from workspace "${wsName}".`);
            } catch (e) { emit(`Error: ${(e as Error).message}`); }
            return;
        }

        // ── /workspace delete <name> ──────────────────────────────────────────
        if (sub === 'delete') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace delete <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[name]) { emit(`Workspace "${name}" not found.`); return; }
            await saveWorkspaces(appName, deleteWorkspace(config, name));
            emit(`Workspace "${name}" deleted.`);
            return;
        }

        // ── /workspace switch <workspace> [project] ───────────────────────────
        if (sub === 'switch') {
            const [, wsName, projectName] = parts;
            const config = await loadWorkspaces(appName);

            // No args after switch → interactive picker
            if (!wsName && ctx.prompt) {
                const names = Object.keys(config);
                if (!names.length) { emit('No workspaces configured.'); return; }
                const options = names.flatMap(wn => {
                    const ws = config[wn]!;
                    return ws.projects.map(p => ({
                        label: `${wn.padEnd(18)} ${p.name}${p.name === ws.active ? ' *' : ''}`,
                        value: `${wn}::${p.name}`,
                    }));
                });
                const selected = await ctx.prompt('Switch to:', options);
                if (!selected) return;
                const [selWs, selProject] = selected.split('::');
                await doSwitch(selWs, selProject, config, appName, emit, injectContext, onCwdChange);
                return;
            }

            if (!wsName) { emit('Usage: /workspace switch <workspace> [project]'); return; }
            const ws = config[wsName];
            if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
            if (!ws.projects.length) { emit(`Workspace "${wsName}" has no projects.`); return; }

            const target = projectName
                ? ws.projects.find(p => p.name === projectName)
                : (ws.projects.find(p => p.name === ws.active) ?? ws.projects[0]);

            if (!target) { emit(`Project "${projectName}" not found in workspace "${wsName}".`); return; }
            await doSwitch(wsName, target.name, config, appName, emit, injectContext, onCwdChange);
            return;
        }

        emit([
            'Usage:',
            '  /workspace list',
            '  /workspace create <name>',
            '  /workspace add <workspace> <cwd> [name]',
            '  /workspace import <cwd> [workspace] [name]',
            '  /workspace remove <workspace> <project>',
            '  /workspace delete <name>',
            '  /workspace switch [workspace] [project]',
        ].join('\n'));
    });

    registry.register('/checkpoint', 'Create / list / load session checkpoints', async (ctx) => {
        const { args, emit, projectDir, sessionContent, injectContext } = ctx;
        if (!projectDir) { emit('No active project directory.'); return; }

        // /checkpoint list
        if (args === 'list') {
            const all = await listCheckpoints(projectDir);
            if (!all.length) { emit('No checkpoints saved.'); return; }
            const latest = getLatestCheckpoints(all);
            const lines = latest.map((cp, i) => {
                const count = all.filter(c => c.feature === cp.feature).length;
                const label = (cp.feature || '(unnamed)').padEnd(24);
                const timeDisplay = cp.time ? `${cp.time.slice(0, 2)}:${cp.time.slice(2)}` : '';
                const versions = count > 1 ? `  (${count} versions)` : '';
                return `  ${i + 1}. ${label} ${cp.date} ${timeDisplay}${versions}`;
            });
            emit(lines.join('\n'));
            return;
        }

        // /checkpoint load [feature]
        if (args === 'load' || args.startsWith('load ')) {
            const target = args.slice(4).trim();
            const all = await listCheckpoints(projectDir);
            if (!all.length) { emit('No checkpoints saved.'); return; }

            let match = target
                ? all.find(cp => cp.feature === target || cp.feature.includes(target))
                : all[0]; // most recent overall

            if (!match) { emit(`Checkpoint not found: ${target}`); return; }

            const raw = await readCheckpoint(projectDir, match.filename);
            if (raw) {
                const session = extractSessionFromCheckpoint(raw);
                const timeDisplay = match.time ? `${match.time.slice(0, 2)}:${match.time.slice(2)}` : '';
                const label = match.feature || 'unnamed';
                injectContext?.(`## Checkpoint: ${label} (${match.date} ${timeDisplay})\n\n${session}`);
                emit(`Checkpoint loaded: ${label}`);
            }
            return;
        }

        // /checkpoint [name] — create (name optional)
        const featureName = args ?? '';
        const cpPath = await createCheckpoint(projectDir, featureName, '', sessionContent ?? '');
        const label = featureName || '(unnamed)';
        emit(`Checkpoint saved: ${label}\n${cpPath}`);
    });
}
