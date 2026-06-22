import 'server-only';
import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';
import path from 'path';
import os from 'os';
import fs from 'fs';

const DB_FILE = process.env.DATABASE_URL?.replace('file:', '')
    ?? path.join(os.homedir(), '.backendkit', 'data', 'vault-manager.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });

const client = createClient({ url: `file:${DB_FILE}` });

export const db     = drizzle(client, { schema });
export { schema };
