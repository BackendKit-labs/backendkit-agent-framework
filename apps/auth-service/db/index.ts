import { createClient } from '@libsql/client';
import { drizzle }      from 'drizzle-orm/libsql';
import * as schema      from './schema.js';
import * as path        from 'node:path';
import * as os          from 'node:os';
import * as fs          from 'node:fs';

const dbPath = process.env['AUTH_DB_PATH']
    ?? path.join(os.homedir(), '.backendkit', 'auth', 'enterprise.db');

// Crear directorio si no existe
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const client = createClient({ url: `file:${dbPath}` });
export const db = drizzle(client, { schema });

export { dbPath };
