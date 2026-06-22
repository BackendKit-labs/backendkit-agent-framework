import type { Config } from 'drizzle-kit';
import path from 'path';
import os from 'os';

const DB_FILE = process.env.DATABASE_URL?.replace('file:', '')
    ?? path.join(os.homedir(), '.backendkit', 'data', 'vault-manager.db');

export default {
    schema:  './db/schema.ts',
    out:     './db/migrations',
    dialect: 'sqlite',
    dbCredentials: { url: DB_FILE },
} satisfies Config;
