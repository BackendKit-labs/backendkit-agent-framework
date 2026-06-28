// ---------------------------------------------------------------------------
// Check: Environment — métricas del sistema local
// ---------------------------------------------------------------------------

import { execSync } from 'child_process';
import * as os from 'os';
import type { EnvironmentCheck, BackendKitProcess } from '../types.js';

function getCpuUsage(): number {
  try {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;
    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += cpu.times[type as keyof typeof cpu.times];
      }
      idle += cpu.times.idle;
    }
    const idlePercent = (idle / total) * 100;
    return Math.round((100 - idlePercent) * 100) / 100;
  } catch {
    return 0;
  }
}

function getMemoryUsage(): number {
  try {
    const total = os.totalmem();
    const free = os.freemem();
    return Math.round(((total - free) / total) * 10000) / 100;
  } catch {
    return 0;
  }
}

function getDiskUsage(): number {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      const output = execSync(
        'wmic logicaldisk where DeviceID="C:" get Size,FreeSpace /format:csv',
        { timeout: 5000, encoding: 'utf-8' }
      );
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(',');
        if (parts.length >= 3) {
          const free = parseInt(parts[1], 10);
          const total = parseInt(parts[2], 10);
          if (total > 0) return Math.round(((total - free) / total) * 10000) / 100;
        }
      }
    } else {
      const output = execSync('df -h /', { timeout: 5000, encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          const usedPercent = parseInt(parts[4].replace('%', ''), 10);
          if (!isNaN(usedPercent)) return usedPercent;
        }
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 || parts.length === 0) parts.push(`${minutes}m`);
  return parts.join(' ');
}

function getProcessCount(): number {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      const output = execSync('tasklist /FO CSV /NH', {
        timeout: 5000,
        encoding: 'utf-8',
      });
      return output.trim().split('\n').length;
    } else {
      const output = execSync('ps aux | wc -l', {
        timeout: 5000,
        encoding: 'utf-8',
      });
      return parseInt(output.trim(), 10) - 1;
    }
  } catch {
    return 0;
  }
}

function getBackendKitProcesses(): BackendKitProcess[] {
  try {
    const platform = os.platform();
    if (platform === 'win32') {
      const output = execSync('tasklist /FO CSV /NH', {
        timeout: 5000,
        encoding: 'utf-8',
      });
      return output
        .trim()
        .split('\n')
        .filter((line) => line.includes('node') || line.includes('docker'))
        .map((line) => {
          const parts = line.split('","');
          return {
            agent_id: parts[0]?.replace(/"/g, '') || 'unknown',
            pid: parseInt(parts[1]?.replace(/"/g, ''), 10) || 0,
            cpu: 0,
            mem: 0,
          };
        });
    } else {
      const output = execSync(
        'ps aux | grep -E "node|docker" | grep -v grep',
        { timeout: 5000, encoding: 'utf-8' }
      );
      return output
        .trim()
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            agent_id: parts[parts.length - 1]?.split('/').pop() || 'unknown',
            pid: parseInt(parts[1], 10) || 0,
            cpu: parseFloat(parts[2]) || 0,
            mem: parseFloat(parts[3]) || 0,
          };
        });
    }
  } catch {
    return [];
  }
}

export function collectEnvironment(): EnvironmentCheck {
  return {
    cpu_percent: getCpuUsage(),
    memory_percent: getMemoryUsage(),
    disk_percent: getDiskUsage(),
    uptime: formatUptime(os.uptime()),
    process_count: getProcessCount(),
    backendkit_processes: getBackendKitProcesses(),
  };
}
