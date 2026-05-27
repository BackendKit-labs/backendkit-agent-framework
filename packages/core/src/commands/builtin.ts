import { SlashCommandRegistry } from './SlashCommandRegistry';
import { createCheckpoint, listCheckpoints, readCheckpoint } from '../checkpoint';
import { listWorkspaces, ensureWorkspace, readWorkspaceMemory } from '../workspace';

/**
 * Registers the framework's built-in slash commands into the given registry.
 * Call this once when bootstrapping the app — before registering app-specific commands.
 */
export function registerBuiltinCommands(registry: SlashCommandRegistry): void {
    registry.register('/help', 'List all available commands', async (ctx) => {
        const cmds = registry.getAll();
        const lines = cmds.map(c => `  ${c.name.padEnd(22)} ${c.description}`);
        ctx.emit('Commands:\n' + lines.join('\n'));
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

    registry.register('/switch', 'List or switch workspace within the project', async (ctx) => {
        const { args, emit, projectBaseDir, injectContext } = ctx;
        if (!projectBaseDir) { emit('No active project directory.'); return; }

        if (!args || args === 'list') {
            const workspaces = await listWorkspaces(projectBaseDir);
            emit(workspaces.map((w, i) =>
                `  ${i + 1}. ${w.name}${w.isDefault ? ' (default)' : ''}`,
            ).join('\n'));
            return;
        }

        const workspace = await ensureWorkspace(projectBaseDir, args);
        const { sessionContent } = await readWorkspaceMemory(projectBaseDir, args);
        injectContext?.(`## Workspace: ${args}\n\n${sessionContent || '*(empty)*'}`);
        emit(`Workspace: ${args}\n${workspace.memoryDir}`);
    });

    registry.register('/checkpoint', 'Create / list / load session checkpoints', async (ctx) => {
        const { args, emit, projectDir, sessionContent, injectContext } = ctx;
        if (!projectDir) { emit('No active project directory.'); return; }

        if (!args) {
            emit('Usage:\n  /checkpoint <name>        create checkpoint\n  /checkpoint list          list checkpoints\n  /checkpoint load <name>   load checkpoint into context');
            return;
        }

        if (args === 'list') {
            const cps = await listCheckpoints(projectDir);
            if (!cps.length) { emit('No checkpoints saved.'); return; }
            emit(cps.map((cp, i) => `  ${i + 1}. ${cp.date} — ${cp.feature}`).join('\n'));
            return;
        }

        if (args.startsWith('load ')) {
            const target = args.slice(5).trim();
            const cps = await listCheckpoints(projectDir);
            const match = cps.find(cp => cp.feature.includes(target) || cp.filename.includes(target));
            if (!match) { emit(`Checkpoint not found: ${target}`); return; }
            const content = await readCheckpoint(projectDir, match.filename);
            if (content) {
                injectContext?.(`## Checkpoint: ${match.feature} (${match.date})\n\n${content}`);
                emit(`Checkpoint loaded: ${match.feature}`);
            }
            return;
        }

        const cpPath = await createCheckpoint(projectDir, args, '', sessionContent ?? '');
        emit(`Checkpoint created: ${args}\n${cpPath}`);
    });
}
