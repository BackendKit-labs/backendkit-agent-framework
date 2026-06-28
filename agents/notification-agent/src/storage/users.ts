// ---------------------------------------------------------------------------
// Storage: Users — persistencia de usuarios y sus canales
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import type { UserData } from '../types/user.js';

const DATA_DIR = process.env.NOTIFIER_DATA_DIR || resolve(homedir(), '.backendkit', 'notifier');
const USERS_PATH = resolve(DATA_DIR, 'users.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function readUsers(): Record<string, UserData> {
  try {
    ensureDir();
    if (!existsSync(USERS_PATH)) return {};
    return JSON.parse(readFileSync(USERS_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeUsers(users: Record<string, UserData>): void {
  ensureDir();
  writeFileSync(USERS_PATH, JSON.stringify(users, null, 2), 'utf-8');
}

function userKey(userId: string, companyId: string): string {
  return `${companyId}:${userId}`;
}

export function getUser(userId: string, companyId: string): UserData | null {
  const users = readUsers();
  return users[userKey(userId, companyId)] || null;
}

export function saveUser(data: UserData): void {
  const users = readUsers();
  users[userKey(data.userId, data.companyId)] = {
    ...data,
    updatedAt: new Date().toISOString(),
  };
  writeUsers(users);
}

export function getAllUsers(): UserData[] {
  return Object.values(readUsers());
}
