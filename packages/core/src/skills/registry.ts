import type { SkillHandler, SkillExecuteResult } from './types';

/**
 * Instance-based skill handler registry.
 * Not a singleton — each AgentEngine gets its own SkillRegistry,
 * enabling test isolation and multi-tenant deployments.
 */
export class SkillRegistry {
    private readonly handlers = new Map<string, SkillHandler>();

    register(name: string, fn: SkillHandler): void {
        this.handlers.set(this.sanitizeName(name), fn);
    }

    get(name: string): SkillHandler | undefined {
        return this.handlers.get(this.sanitizeName(name));
    }

    has(name: string): boolean {
        return this.handlers.has(this.sanitizeName(name));
    }

    async execute(name: string, args: unknown): Promise<SkillExecuteResult> {
        const handler = this.get(name);
        if (!handler) return { ok: false, error: `Handler not registered: ${name}` };
        try {
            const data = await handler(args);
            return { ok: true, data };
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            return { ok: false, error: `Error in handler '${name}': ${error}` };
        }
    }

    /** Removes characters that could be used for injection via handler name */
    sanitizeName(name: string): string {
        return name.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    registeredNames(): string[] {
        return [...this.handlers.keys()];
    }

    clear(): void {
        this.handlers.clear();
    }
}
