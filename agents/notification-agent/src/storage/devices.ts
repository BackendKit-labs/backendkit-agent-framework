// ---------------------------------------------------------------------------
// Storage: Devices — persistencia de dispositivos push
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import { homedir } from 'os';
import { v4 as uuid } from 'uuid';
import type { DeviceRecord } from '../types/push.js';

const DATA_DIR = process.env.NOTIFIER_DATA_DIR || resolve(homedir(), '.backendkit', 'notifier');
const DEVICES_PATH = resolve(DATA_DIR, 'devices.json');

function ensureDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readDevices(): Record<string, DeviceRecord> {
  try {
    ensureDir();
    if (!existsSync(DEVICES_PATH)) return {};
    return JSON.parse(readFileSync(DEVICES_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

function writeDevices(devices: Record<string, DeviceRecord>): void {
  ensureDir();
  writeFileSync(DEVICES_PATH, JSON.stringify(devices, null, 2), 'utf-8');
}

export function addDevice(device: Omit<DeviceRecord, 'id' | 'registeredAt' | 'lastSeen'>): DeviceRecord {
  const devices = readDevices();
  const id = uuid();
  const now = new Date().toISOString();
  const record: DeviceRecord = {
    ...device,
    id,
    registeredAt: now,
    lastSeen: now,
  };
  const key = `${device.provider}:${device.token}`;
  devices[key] = record;
  writeDevices(devices);
  return record;
}

export function deactivateDevice(token: string, provider?: string): boolean {
  const devices = readDevices();
  // Buscar por token (con o sin provider)
  for (const [key, device] of Object.entries(devices)) {
    if (device.token === token && (!provider || device.provider === provider)) {
      device.active = false;
      devices[key] = device;
      writeDevices(devices);
      return true;
    }
  }
  return false;
}

export function listDevices(filters?: {
  userId?: string;
  companyId?: string;
  provider?: string;
  active?: boolean;
  limit?: number;
}): { total: number; devices: DeviceRecord[] } {
  const devices = Object.values(readDevices());
  let filtered = devices;

  if (filters?.userId) filtered = filtered.filter((d) => d.userId === filters.userId);
  if (filters?.companyId) filtered = filtered.filter((d) => d.companyId === filters.companyId);
  if (filters?.provider) filtered = filtered.filter((d) => d.provider === filters.provider);
  if (filters?.active !== undefined) filtered = filtered.filter((d) => d.active === filters.active);

  const limit = filters?.limit || 50;
  return {
    total: filtered.length,
    devices: filtered.slice(0, limit),
  };
}
