import { spawnSync } from 'child_process';

export interface PostgresContainer {
    containerId: string;
    containerName: string;
    port: number;
    dbName: string;
    user: string;
    password: string;
    connectionString: string;
}

export interface CreateOptions {
    port?: number;
    dbName?: string;
    user?: string;
    password?: string;
    containerName?: string;
    pgVersion?: string;
}

export function createPostgresContainer(opts: CreateOptions = {}): PostgresContainer {
    const port = opts.port ?? 5432;
    const dbName = opts.dbName ?? 'devdb';
    const user = opts.user ?? 'postgres';
    const password = opts.password ?? 'postgres';
    const containerName = opts.containerName ?? `pg-dev-${Date.now()}`;
    const image = `postgres:${opts.pgVersion ?? '16-alpine'}`;

    // Remove any existing container with the same name
    spawnSync('docker', ['rm', '-f', containerName], { encoding: 'utf-8' });

    const result = spawnSync('docker', [
        'run', '-d',
        '--name', containerName,
        '-e', `POSTGRES_DB=${dbName}`,
        '-e', `POSTGRES_USER=${user}`,
        '-e', `POSTGRES_PASSWORD=${password}`,
        '-p', `${port}:5432`,
        image,
    ], { encoding: 'utf-8' });

    if (result.status !== 0) {
        throw new Error(`docker run failed: ${result.stderr.trim()}`);
    }

    const containerId = result.stdout.trim().slice(0, 12);
    const connectionString = `postgresql://${user}:${password}@localhost:${port}/${dbName}`;

    return { containerId, containerName, port, dbName, user, password, connectionString };
}

export async function waitUntilReady(containerName: string, timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let lastError = '';

    while (Date.now() < deadline) {
        const result = spawnSync('docker', [
            'exec', containerName,
            'pg_isready', '-U', 'postgres',
        ], { encoding: 'utf-8' });

        if (result.status === 0) return;
        lastError = result.stdout.trim() || result.stderr.trim();
        await delay(1000);
    }

    throw new Error(`PostgreSQL not ready after ${timeoutMs}ms. Last status: ${lastError}`);
}

export function runSQL(containerName: string, user: string, dbName: string, sql: string): string {
    const result = spawnSync('docker', [
        'exec', containerName,
        'psql', '-U', user, '-d', dbName,
        '--no-psqlrc', '-c', sql,
    ], { encoding: 'utf-8' });

    if (result.status !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim());
    }
    return result.stdout.trim();
}

export function stopContainer(containerName: string): void {
    spawnSync('docker', ['stop', containerName], { encoding: 'utf-8' });
    spawnSync('docker', ['rm', containerName], { encoding: 'utf-8' });
}

export interface ContainerStatus {
    exists: boolean;
    running: boolean;
    healthy: boolean;
    connectionString?: string;
}

export function getContainerStatus(containerName: string, connectionString?: string): ContainerStatus {
    const inspect = spawnSync('docker', [
        'inspect', '--format', '{{.State.Status}}', containerName,
    ], { encoding: 'utf-8' });

    if (inspect.status !== 0) return { exists: false, running: false, healthy: false };

    const status = inspect.stdout.trim();
    const running = status === 'running';

    let healthy = false;
    if (running) {
        const ready = spawnSync('docker', [
            'exec', containerName,
            'pg_isready', '-U', 'postgres',
        ], { encoding: 'utf-8' });
        healthy = ready.status === 0;
    }

    return { exists: true, running, healthy, connectionString };
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
