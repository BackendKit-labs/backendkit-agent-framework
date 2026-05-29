// ── Types ─────────────────────────────────────────────────────────────────────

export interface CommandAgentInfo {
    id: string;
    name: string;
    description: string;
}

export interface CommandSkillInfo {
    name: string;
    description: string;
    triggers: string[];
}

export interface CommandContext {
    /** Full original input string (e.g. "/agent coder"). */
    rawInput: string;
    /** Everything after the command name, trimmed. */
    args: string;
    /** Send text output back to the user. */
    emit: (text: string) => void;
    agents?: CommandAgentInfo[];
    skills?: CommandSkillInfo[];
    effectiveAgentId?: string;
    model?: string;
    /** Absolute path to the active project memory directory (for checkpoint commands). */
    projectDir?: string;
    /** Current content of memory/session.md (snapshotted into checkpoints). */
    sessionContent?: string;
    /** Inject a message into the agent's active context window. */
    injectContext?: (message: string) => void;
}

export type SlashCommandHandler = (ctx: CommandContext) => Promise<void>;

export interface SlashCommand {
    name: string;
    description: string;
    handler: SlashCommandHandler;
}

// ── Registry ──────────────────────────────────────────────────────────────────

export class SlashCommandRegistry {
    private readonly commands = new Map<string, SlashCommand>();

    register(name: string, description: string, handler: SlashCommandHandler): this {
        this.commands.set(name, { name, description, handler });
        return this;
    }

    unregister(name: string): this {
        this.commands.delete(name);
        return this;
    }

    /** Returns true if the input starts with a registered command name. */
    isCommand(input: string): boolean {
        return this.commands.has(this.parseName(input));
    }

    /**
     * Dispatches the input to the matching command handler.
     * Returns true if a command was found and executed, false otherwise.
     */
    async dispatch(
        input: string,
        ctx: Omit<CommandContext, 'args' | 'rawInput'>,
    ): Promise<boolean> {
        const name = this.parseName(input);
        const cmd = this.commands.get(name);
        if (!cmd) return false;
        const args = input.slice(name.length).trim();
        await cmd.handler({ ...ctx, rawInput: input, args });
        return true;
    }

    getAll(): SlashCommand[] {
        return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    private parseName(input: string): string {
        return input.trim().split(/\s+/)[0];
    }
}
