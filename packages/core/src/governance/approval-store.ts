import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { link, mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
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
            const item = await this.get(name.slice(0, -'.request.json'.length));
            if (!item) continue;
            if (filter.status && item.status !== filter.status) continue;
            if (filter.agentId && item.principal.agentId !== filter.agentId) continue;
            out.push(item);
        }
        return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    }

    // ── internals ────────────────────────────────────────────────────────────

    private checkId(id: string): void {
        if (!ID.test(id)) throw new Error(`invalid approval id "${id}"`);
    }

    private file(id: string, suffix: string): string {
        return join(this.dir, `${id}.${suffix}`);
    }

    private async readJson<T>(path: string): Promise<T | undefined> {
        try { return JSON.parse(await readFile(path, 'utf8')) as T; } catch { return undefined; }
    }

    /** Write to a unique temporary file, then hard-link it under the final name (fails if it exists). */
    private async publish(id: string, suffix: string, content: string, existsMessage: string): Promise<void> {
        this.checkId(id);
        this.ready ??= mkdir(this.dir, { recursive: true });
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
