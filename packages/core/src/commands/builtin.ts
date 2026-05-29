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
    removeProject,
    deleteWorkspace,
    buildWorkspaceContext,
} from '../workspace';

/**
 * Registers the framework's built-in slash commands into the given registry.
 * Call this once when bootstrapping the app — before registering app-specific commands.
 */
export function registerBuiltinCommands(registry: SlashCommandRegistry): void {
    registry.register('/help', 'List commands and get AI guidance on what I can help with', async (ctx) => {
        const cmds = registry.getAll();
        const list = cmds.map(c => `- ${c.name.padEnd(22)} ${c.description}`).join('\n');
        ctx.emit(`Available commands:\n${list}`);

        if (ctx.runEngine) {
            await ctx.runEngine(
                `The user ran /help. Available commands:\n${list}\n\n` +
                `Based on these commands and your capabilities as a coding assistant, ` +
                `briefly tell the user what you can help them with today. ` +
                `Be concise, friendly, and mention specific things you can do for the current project.`
            );
        }
    });

    registry.register('/agents', 'List available agents', async (ctx) => {
        if (!ctx.agents?.length) { ctx.emit('No agents loaded.'); return; }
        const lines = ctx.agents.map(a =>
            `  ${a.id.padEnd(18)} ${a.name} — ${a.description}`,
        );
        ctx.emit('Agents:\n' + lines.join('\n'));
    });

    registry.register('/skills', 'List loaded skills', async (ctx) => {
        if (!ctx.skills?.length) { ctx.emit('No skills loaded.'); return; }
        const lines = ctx.skills.map(s =>
            `  ${s.name.padEnd(24)} ${s.description}`,
        );
        ctx.emit('Skills:\n' + lines.join('\n'));
    });

    registry.register('/status', 'Show current agent and model', async (ctx) => {
        ctx.emit([
            `Agent : ${ctx.effectiveAgentId ?? '—'}`,
            `Model : ${ctx.model ?? '—'}`,
        ].join('\n'));
    });

    registry.register('/workspace', 'Manage multi-project workspaces', async (ctx) => {
        const { args, emit, appName, injectContext, onCwdChange } = ctx;
        if (!appName) { emit('appName not set in CommandContext.'); return; }

        const parts = (args ?? '').split(' ').filter(Boolean);
        const sub = parts[0];

        // /workspace  or  /workspace list
        if (!sub || sub === 'list') {
            const config = await loadWorkspaces(appName);
            const names = Object.keys(config);
            if (!names.length) { emit('No workspaces. Use: /workspace create <name>'); return; }
            const lines = names.map(n => {
                const ws = config[n]!;
                const projects = ws.projects
                    .map(p => p.name === ws.active ? `${p.name}*` : p.name)
                    .join(', ') || '(empty)';
                return `  ${n.padEnd(20)} ${projects}`;
            });
            emit('Workspaces (* = active project):\n' + lines.join('\n'));
            return;
        }

        // /workspace create <name>
        if (sub === 'create') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace create <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (config[name]) { emit(`Workspace "${name}" already exists.`); return; }
            await saveWorkspaces(appName, createWorkspace(config, name));
            emit(`Workspace "${name}" created.`);
            return;
        }

        // /workspace add <workspace> <cwd> [projectName]
        if (sub === 'add') {
            const [, wsName, cwd, projectName] = parts;
            if (!wsName || !cwd) { emit('Usage: /workspace add <workspace> <cwd> [name]'); return; }
            const name = projectName ?? path.basename(cwd);
            let config = await loadWorkspaces(appName);
            if (!config[wsName]) config = createWorkspace(config, wsName);
            config = addProject(config, wsName, { name, cwd: path.resolve(cwd) });
            await saveWorkspaces(appName, config);
            emit(`Added "${name}" to workspace "${wsName}".\n  cwd: ${path.resolve(cwd)}`);
            return;
        }

        // /workspace remove <workspace> <project>
        if (sub === 'remove') {
            const [, wsName, projectName] = parts;
            if (!wsName || !projectName) { emit('Usage: /workspace remove <workspace> <project>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[wsName]) { emit(`Workspace "${wsName}" not found.`); return; }
            await saveWorkspaces(appName, removeProject(config, wsName, projectName));
            emit(`Removed "${projectName}" from workspace "${wsName}".`);
            return;
        }

        // /workspace delete <name>
        if (sub === 'delete') {
            const name = parts[1];
            if (!name) { emit('Usage: /workspace delete <name>'); return; }
            const config = await loadWorkspaces(appName);
            if (!config[name]) { emit(`Workspace "${name}" not found.`); return; }
            await saveWorkspaces(appName, deleteWorkspace(config, name));
            emit(`Workspace "${name}" deleted.`);
            return;
        }

        // /workspace switch <name> [project]
        if (sub === 'switch') {
            const [, wsName, projectName] = parts;
            if (!wsName) { emit('Usage: /workspace switch <name> [project]'); return; }
            const config = await loadWorkspaces(appName);
            const ws = config[wsName];
            if (!ws) { emit(`Workspace "${wsName}" not found.`); return; }
            if (!ws.projects.length) { emit(`Workspace "${wsName}" has no projects.`); return; }

            const context = await buildWorkspaceContext(wsName, ws, appName);
            injectContext?.(context);

            const target = projectName
                ? ws.projects.find(p => p.name === projectName)
                : (ws.projects.find(p => p.name === ws.active) ?? ws.projects[0]);

            if (target && onCwdChange) {
                onCwdChange(target.cwd);
                emit(`Switched to workspace "${wsName}" — active: ${target.name}`);
            } else {
                const note = target ? ` Active project: ${target.name} (${target.cwd})` : '';
                emit(`Workspace "${wsName}" context loaded.${note}`);
            }
            return;
        }

        emit([
            'Usage:',
            '  /workspace list',
            '  /workspace create <name>',
            '  /workspace add <workspace> <cwd> [name]',
            '  /workspace remove <workspace> <project>',
            '  /workspace delete <name>',
            '  /workspace switch <name> [project]',
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
