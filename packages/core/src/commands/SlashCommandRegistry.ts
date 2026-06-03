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
    language?: string[];
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
    /** App name used to locate ~/.{appName}/ (for workspace commands). */
    appName?: string;
    /** Inject a message into the agent's active context window. */
    injectContext?: (message: string) => void;
    /** Called by /workspace switch when the active project changes. App handles the actual cwd/engine reload. */
    onCwdChange?: (cwd: string) => void;
    /** Run the LLM engine with a given prompt. Used by commands that need AI interpretation (e.g. /help). */
    runEngine?: (prompt: string) => Promise<void>;
    /**
     * Solicita input interactivo al usuario.
     * El agente conecta su propia implementación (Terminal.filteredSelect, web modal, etc.)
     * Cuando no está presente, el comando hace fallback a ctx.emit() con texto plano.
     *
     * @param question  Pregunta a mostrar
     * @param options   Si se proveen, el usuario elige entre estas opciones.
     *                  Si no, es entrada de texto libre.
     * @returns El valor elegido/escrito, o null si el usuario cancela.
     */
    prompt?: (question: string, options?: Array<{ label: string; value: string }>) => Promise<string | null>;
    /** Change the engine's iteration mode at runtime. */
    setIterationMode?: (mode: 'interactive' | 'auto' | 'step-by-step') => void;
    /** Returns the current iteration mode. */
    getIterationMode?: () => 'interactive' | 'auto' | 'step-by-step';
    /** Returns info about configured MCP servers and their connection status. */
    mcpList?: () => Promise<Array<{ name: string; url?: string; connected: boolean; toolCount: number }>>;
    /** Add a new MCP server config at runtime. */
    mcpAdd?: (config: unknown) => Promise<void>;
    /** Remove an MCP server by name at runtime. */
    mcpRemove?: (name: string) => Promise<void>;
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
