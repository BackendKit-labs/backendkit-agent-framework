/**
 * Integration test: EventPublisher against a real BullMQ / Redis instance.
 * Skipped automatically if Redis is not reachable on localhost:6379.
 */
import * as fs from 'fs/promises';
import * as net from 'net';
import * as path from 'path';
import * as os from 'os';
import { z } from '@backendkit-labs/agent-core';
import { EventPublisher } from '../../events/EventPublisher';
import type { EventSchema } from '../../events/types';

const REDIS_HOST = process.env.REDIS_HOST ?? 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT ?? '6379', 10);

const TestEventSchema: EventSchema<{ nombre: string }> = {
    type: 'test-integracion',
    version: 1,
    schema: z.object({ nombre: z.string() }),
};

/** Fast TCP check — no BullMQ reconnection loop. */
async function checkRedis(host: string, port: number): Promise<boolean> {
    return new Promise(resolve => {
        const socket = new net.Socket();
        socket.setTimeout(1000);
        socket.connect(port, host, () => { socket.destroy(); resolve(true); });
        socket.on('error', () => resolve(false));
        socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
}

let redisAvailable = false;

beforeAll(async () => {
    redisAvailable = await checkRedis(REDIS_HOST, REDIS_PORT);
    if (!redisAvailable) {
        console.warn(
            '\n⚠  EventPublisher integration tests skipped — ' +
            `Redis not available at ${REDIS_HOST}:${REDIS_PORT}.\n` +
            '   To run: start Redis on localhost:6379',
        );
    }
});

describe('EventPublisher integration — BullMQ / Redis', () => {
    let tmpDir: string | undefined;
    let queue: InstanceType<typeof import('bullmq').Queue> | undefined;

    beforeEach(async () => {
        if (!redisAvailable) return;
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-int-'));
    });

    afterEach(async () => {
        if (tmpDir) {
            await fs.rm(tmpDir, { recursive: true, force: true });
            tmpDir = undefined;
        }
        if (queue) {
            try { await queue.obliterate({ force: true }); } catch { /* ignore */ }
            await queue.close();
            queue = undefined;
        }
    });

    it('publishes a job to Redis and writes the vault note', async () => {
        if (!redisAvailable) return;

        const BullMQ = require('bullmq') as typeof import('bullmq');
        queue = new BullMQ.Queue('eventos.test-integracion', {
            connection: { host: REDIS_HOST, port: REDIS_PORT },
        });

        const publisher = new EventPublisher({
            queue,
            vaultPath: tmpDir!,
            source: 'integration-test',
        });

        const envelope = await publisher.publish(TestEventSchema, { nombre: 'Juan' });

        // Job was added to Redis
        const job = await queue.getJob(envelope.id);
        expect(job).not.toBeNull();
        const data = job!.data as Record<string, unknown>;
        expect(data.id).toBe(envelope.id);
        expect(data.type).toBe('test-integracion');

        // Vault note was written
        const eventsDir = path.join(tmpDir!, 'eventos');
        const files = await fs.readdir(eventsDir);
        expect(files.filter(f => f.endsWith('.md'))).toHaveLength(1);
        const content = await fs.readFile(path.join(eventsDir, files[0]), 'utf-8');
        expect(content).toContain(envelope.id);
        expect(content).toContain('test-integracion');
    });
});
