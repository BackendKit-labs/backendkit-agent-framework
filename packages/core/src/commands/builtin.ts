import { SlashCommandRegistry } from './SlashCommandRegistry';
import {
    createCheckpoint,
    listCheckpoints,
    readCheckpoint,
    getLatestCheckpoints,
    extractSessionFromCheckpoint,
} from '../checkpoint';

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
