import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { z } from '@backendkit-labs/agent-core';
import { EventPublisher } from '../../events/EventPublisher';
import type { QueueLike } from '../../events/EventPublisher';
import type { EventSchema } from '../../events/types';

// ── Helpers ───────────────────────────────────────────────────────────────────

const ContratacionSchema: EventSchema<{ nombre: string; legajo: string }> = {
    type: 'contratacion',
    version: 1,
    schema: z.object({ nombre: z.string(), legajo: z.string() }),
};

function makeQueue(): { mock: jest.Mock; queue: QueueLike } {
    const mock = jest.fn().mockResolvedValue({ id: 'job-test-123' });
    return {
        mock,
        queue: { name: 'eventos.contratacion', add: mock },
    };
}

async function makePublisher(tmpDir: string, source = 'hr-system') {
    const { mock, queue } = makeQueue();
    const publisher = new EventPublisher({ queue, vaultPath: tmpDir, source });
    return { publisher, queueAdd: mock };
}

// ── Validation ────────────────────────────────────────────────────────────────

describe('EventPublisher — validation', () => {
    let tmpDir: string;
    beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-')); });
    afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    it('publishes successfully when payload matches the schema', async () => {
        const { publisher } = await makePublisher(tmpDir);
        const envelope = await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        expect(envelope.type).toBe('contratacion');
        expect(envelope.payload).toEqual({ nombre: 'Juan', legajo: 'L-001' });
    });

    it('throws ZodError when payload does not match the schema', async () => {
        const { publisher } = await makePublisher(tmpDir);
        await expect(
            publisher.publish(ContratacionSchema, { nombre: 'Juan' } as any),
        ).rejects.toThrow();
    });

    it('does NOT call queue.add when payload is invalid', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        try {
            await publisher.publish(ContratacionSchema, { nombre: 'Juan' } as any);
        } catch { /* expected */ }
        expect(queueAdd).not.toHaveBeenCalled();
    });
});

// ── Envelope ──────────────────────────────────────────────────────────────────

describe('EventPublisher — envelope', () => {
    let tmpDir: string;
    beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-')); });
    afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    it('returns an envelope with correct type, source, version, and ISO timestamp', async () => {
        const { publisher } = await makePublisher(tmpDir, 'hr-system');
        const envelope = await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        expect(envelope.type).toBe('contratacion');
        expect(envelope.source).toBe('hr-system');
        expect(envelope.version).toBe(1);
        expect(envelope.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(typeof envelope.id).toBe('string');
        expect(envelope.id.length).toBeGreaterThan(10);
    });

    it('uses envelope.id as the BullMQ jobId by default', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        const envelope = await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        expect(queueAdd).toHaveBeenCalledWith(
            'contratacion',
            expect.objectContaining({ id: envelope.id }),
            expect.objectContaining({ jobId: envelope.id }),
        );
    });

    it('uses the provided custom jobId', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' }, { jobId: 'custom-123' });
        expect(queueAdd).toHaveBeenCalledWith(
            expect.any(String),
            expect.any(Object),
            expect.objectContaining({ jobId: 'custom-123' }),
        );
    });
});

// ── BullMQ queue call ─────────────────────────────────────────────────────────

describe('EventPublisher — queue.add call', () => {
    let tmpDir: string;
    beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-')); });
    afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    it('calls queue.add with the event type as the job name', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        expect(queueAdd).toHaveBeenCalledWith('contratacion', expect.any(Object), expect.any(Object));
    });

    it('sets removeOnComplete and removeOnFail to false for reconciliation', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        const opts = queueAdd.mock.calls[0][2];
        expect(opts.removeOnComplete).toBe(false);
        expect(opts.removeOnFail).toBe(false);
    });

    it('uses custom attempts when provided', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' }, { attempts: 5 });
        expect(queueAdd.mock.calls[0][2].attempts).toBe(5);
    });

    it('defaults to 3 attempts', async () => {
        const { publisher, queueAdd } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        expect(queueAdd.mock.calls[0][2].attempts).toBe(3);
    });
});

// ── Vault note ────────────────────────────────────────────────────────────────

describe('EventPublisher — vault note', () => {
    let tmpDir: string;
    beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-')); });
    afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

    it('writes a Markdown file under {vaultPath}/eventos/', async () => {
        const { publisher } = await makePublisher(tmpDir);
        await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        const eventsDir = path.join(tmpDir, 'eventos');
        const files = await fs.readdir(eventsDir);
        expect(files.filter(f => f.endsWith('.md'))).toHaveLength(1);
    });

    it('vault note contains the event ID in a table row', async () => {
        const { publisher } = await makePublisher(tmpDir);
        const envelope = await publisher.publish(ContratacionSchema, { nombre: 'Juan', legajo: 'L-001' });
        const eventsDir = path.join(tmpDir, 'eventos');
        const [file] = await fs.readdir(eventsDir);
        const content = await fs.readFile(path.join(eventsDir, file), 'utf-8');
        expect(content).toContain(envelope.id);
        expect(content).toContain('contratacion');
        expect(content).toContain('Juan');
    });
});
