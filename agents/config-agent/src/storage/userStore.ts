import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const scryptAsync = promisify(scrypt);

// ── Path ──────────────────────────────────────────────────────────────────────

const AUTH_DIR  = process.env['CONFIG_AUTH_DIR'] ?? resolve(homedir(), '.backendkit', 'auth');
const USERS_FILE = resolve(AUTH_DIR, 'users.json');

// ── Types ─────────────────────────────────────────────────────────────────────

export type UserRole = 'admin' | 'development' | 'hr' | 'sales' | 'finance' | 'devops' | string;

export interface User {
    id:           string;
    username:     string;
    name?:        string;
    role:         UserRole;
    department?:  string;
    passwordHash: string;
    createdAt:    string;
    active:       boolean;
}

export interface PublicUser extends Omit<User, 'passwordHash'> {}

// ── Persistence ───────────────────────────────────────────────────────────────

function ensureDir(): void {
    if (!existsSync(AUTH_DIR)) mkdirSync(AUTH_DIR, { recursive: true });
}

export function readUsers(): User[] {
    ensureDir();
    if (!existsSync(USERS_FILE)) return [];
    try { return JSON.parse(readFileSync(USERS_FILE, 'utf-8')) as User[]; }
    catch { return []; }
}

function saveUsers(users: User[]): void {
    ensureDir();
    writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

// ── Password ──────────────────────────────────────────────────────────────────

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(password, salt, 64) as Buffer;
    return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    try {
        const [salt, hashHex] = stored.split(':');
        const hash       = await scryptAsync(password, salt!, 64) as Buffer;
        const storedHash = Buffer.from(hashHex!, 'hex');
        return timingSafeEqual(hash, storedHash);
    } catch { return false; }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export async function createUser(data: {
    username:   string;
    password:   string;
    role:       UserRole;
    name?:      string;
    department?: string;
}): Promise<PublicUser> {
    const users = readUsers();
    if (users.find(u => u.username === data.username)) {
        throw new Error(`Usuario "${data.username}" ya existe`);
    }
    const user: User = {
        id:           randomUUID(),
        username:     data.username,
        name:         data.name,
        role:         data.role,
        department:   data.department,
        passwordHash: await hashPassword(data.password),
        createdAt:    new Date().toISOString(),
        active:       true,
    };
    users.push(user);
    saveUsers(users);
    const { passwordHash: _, ...pub } = user;
    return pub;
}

export function listUsers(): PublicUser[] {
    return readUsers().map(({ passwordHash: _, ...pub }) => pub);
}

export function findUser(username: string): User | undefined {
    return readUsers().find(u => u.username === username);
}

export function deleteUser(username: string): boolean {
    const users = readUsers();
    const idx   = users.findIndex(u => u.username === username);
    if (idx === -1) return false;
    users.splice(idx, 1);
    saveUsers(users);
    return true;
}

export function toggleUser(username: string, active: boolean): boolean {
    const users = readUsers();
    const user  = users.find(u => u.username === username);
    if (!user) return false;
    user.active = active;
    saveUsers(users);
    return true;
}

/** Crea el usuario admin inicial desde ADMIN_PASSWORD en .env si no existe ningún admin. */
export async function bootstrapAdmin(): Promise<void> {
    const password = process.env['ADMIN_PASSWORD'];
    if (!password) return;
    const users = readUsers();
    if (users.some(u => u.role === 'admin')) return;
    await createUser({ username: 'admin', password, role: 'admin', name: 'Administrador' });
    console.error('[config-agent] Admin user bootstrapped from ADMIN_PASSWORD');
}
