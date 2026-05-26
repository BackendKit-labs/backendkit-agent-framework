import { SlashCommandRegistry } from './SlashCommandRegistry';

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
}
