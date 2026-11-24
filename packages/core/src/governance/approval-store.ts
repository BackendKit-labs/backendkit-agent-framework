import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdir, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ApprovalOutcome, ApprovalRequest, ApprovalStatus, ApprovalStore, StoredApproval } from './types';

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/**
 * Durable approvals in a directory (SPEC-0014 §6, option A). Three files per request:
 *
 * - `<id>.request.json` — the request, written once.
 * - `<id>.outcome.json` — the decision, written once: a second decision for the same id fails.
 * - `<id>.executed` — the approved action ran, written once: `markExecuted` answers true exactly once.
 *
 * Each file is written to a temporary name and then published with a hard link, which fails if the target exists.
 * That makes every step atomic and exclusive without locks, also across processes sharing the directory, and a
 * crash never leaves a half-written file under the final name. Tool definitions are stored as data (their facts
 * and parameters); whoever resumes the call looks the tool up again by name.
 */
export class FileApprovalStore implements ApprovalStore {
    private ready?: Promise<unknown>;

    constructor(private readonly dir: string) {}

    async put(req: ApprovalRequest): Promise<void> {
        await this.publish(req.id, 'request.json', JSON.stringify(req), `approval "${req.id}" already exists`);
    }

    async get(id: string): Promise<StoredApproval | undefined> {
        this.checkId(id);
        const request = await this.readJson<ApprovalRequest>(this.file(id, 'request.json'));
        if (!request) return undefined;
        const outcome = await this.readJson<ApprovalOutcome>(this.file(id, 'outcome.json'));
        const executedAt = await readFile(this.file(id, 'executed'), 'utf8').catch(() => undefined);
        const status: ApprovalStatus = executedAt !== undefined ? 'executed'
            : !outcome ? 'pending'
            : outcome.decision === 'approve' ? 'approved' : 'rejected';
        return { ...request, status, ...(outcome ? { outcome } : {}), ...(executedAt ? { executedAt } : {}) };
    }

    async resolve(id: string, outcome: ApprovalOutcome): Promise<StoredApproval> {
        this.checkId(id);
        if (!existsSync(this.file(id, 'request.json'))) throw new Error(`approval "${id}" does not exist`);
        await this.publish(id, 'outcome.json', JSON.stringify(outcome), `approval "${id}" was already decided`);
        return (await this.get(id))!;
    }

    async markExecuted(id: string): Promise<boolean> {
        const item = await this.get(id);
        if (!item) throw new Error(`approval "${id}" does not exist`);
        if (item.status === 'executed') return false;
        if (item.status !== 'approved') throw new Error(`approval "${id}" is ${item.status}, not approved`);
        try {
            await this.publish(id, 'executed', new Date().toISOString(), '');
            return true;
        } catch (err) {
            if ((err as { alreadyExists?: boolean }).alreadyExists) return false;
            throw err;
        }
    }

    async list(filter: { status?: ApprovalStatus; agentId?: string } = {}): Promise<StoredApproval[]> {
        let names: string[];
        try { names = await readdir(this.dir); } catch { return []; }
        const out: StoredApproval[] = [];
        for (const name of names) {
            if (!name.endsWith('.request.json')) continue;
            let item: StoredApproval | undefined;
            try { item = await this.get(name.slice(0, -'.request.json'.length)); } catch { continue; }     // one corrupt file does not hide the rest
            if (!item) continue;
            if (filter.status && item.status !== filter.status) continue;
            if (filter.agentId && item.principal.agentId !== filter.agentId) continue;
            out.push(item);
        }
        // Oldest first. `createdAt` has millisecond precision, so two requests made in the same millisecond tie: the id breaks the tie, so the order
        // is the same on every call and on every file system (`readdir` gives no order of its own).
        return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    }

    // ── internals ────────────────────────────────────────────────────────────

    private checkId(id: string): void {
        if (!ID.test(id)) throw new Error(`invalid approval id "${id}"`);
    }

    private file(id: string, suffix: string): string {
        return join(this.dir, `${id}.${suffix}`);
    }

    private async readJson<T>(path: string): Promise<T | undefined> {
        let text: string;
        try { text = await readFile(path, 'utf8'); } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
            throw err;
        }
        try { return JSON.parse(text) as T; } catch { throw new Error(`approval file ${path} is corrupt (not valid JSON)`); }
    }

    /** A crash between the write and the link leaves a temporary file: remove the ones nobody can still be using (over an hour old). */
    private async sweepTemp(): Promise<void> {
        try {
            for (const name of await readdir(this.dir)) {
                if (!name.startsWith('.') || !name.endsWith('.tmp')) continue;
                const path = join(this.dir, name);
                const info = await stat(path).catch(() => undefined);
                if (info && Date.now() - info.mtimeMs > 3_600_000) await unlink(path).catch(() => undefined);
            }
        } catch { /* a sweep that fails costs nothing: the files stay */ }
    }

    /** Write to a unique temporary file, then hard-link it under the final name (fails if it exists). */
    private async publish(id: string, suffix: string, content: string, existsMessage: string): Promise<void> {
        this.checkId(id);
        this.ready ??= mkdir(this.dir, { recursive: true }).then(() => this.sweepTemp());
        await this.ready;
        const target = this.file(id, suffix);
        const tmp = join(this.dir, `.${id}.${suffix}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`);
        await writeFile(tmp, content, { flag: 'wx' });
        try {
            await link(tmp, target);
        } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
                throw Object.assign(new Error(existsMessage), { alreadyExists: true });
            }
            throw err;
        } finally {
            await unlink(tmp).catch(() => undefined);
        }
    }
}

/** Approvals kept in memory, for tests and for processes that do not need them to outlive the run. */
export class MemoryApprovalStore implements ApprovalStore {
    private readonly items = new Map<string, StoredApproval>();

    async put(req: ApprovalRequest): Promise<void> {
        if (this.items.has(req.id)) throw new Error(`approval "${req.id}" already exists`);
        this.items.set(req.id, { ...req, status: 'pending' });
    }

    async get(id: string): Promise<StoredApproval | undefined> {
        const item = this.items.get(id);
        return item ? { ...item } : undefined;
    }

    async resolve(id: string, outcome: ApprovalOutcome): Promise<StoredApproval> {
        const item = this.items.get(id);
        if (!item) throw new Error(`approval "${id}" not found`);
        if (item.outcome) throw new Error(`approval "${id}" already has a decision`);
        const next: StoredApproval = { ...item, outcome, status: outcome.decision === 'approve' ? 'approved' : 'rejected' };
        this.items.set(id, next);
        return { ...next };
    }

    async markExecuted(id: string): Promise<boolean> {
        const item = this.items.get(id);
        if (!item || item.status !== 'approved') return false;
        this.items.set(id, { ...item, status: 'executed', executedAt: new Date().toISOString() });
        return true;
    }

    async list(filter: { status?: ApprovalStatus; agentId?: string } = {}): Promise<StoredApproval[]> {
        return [...this.items.values()]
            .filter(a => (!filter.status || a.status === filter.status) && (!filter.agentId || a.principal.agentId === filter.agentId))
            .map(a => ({ ...a }));
    }
}
