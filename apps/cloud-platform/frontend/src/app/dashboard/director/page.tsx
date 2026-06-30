'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import {
  Activity,
  Server,
  Cpu,
  HardDrive,
  Play,
  Square,
  RefreshCw,
  Terminal,
  AlertCircle,
  CheckCircle,
  XCircle,
  Loader2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MetricCard } from '@/components/ui/metric-card';
import { deployableService } from '@/services/deployable-service';
import { Deployable } from '@/lib/types';

interface DirectorHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  runtimes: Array<{ kind: string; reachable: string }>;
}

interface DirectorAgent {
  id: string;
  name: string;
  kind: string;
  department: string | null;
  status: string;
  createdAt: string;
}

interface DirectorMetrics {
  totalDeployables: number;
  activeDeployables: number;
  totalDepartments: number;
  byKind: { agent: number; app: number };
  byStatus: Record<string, number>;
  uptime: number;
  memoryUsageMb: number;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export default function DirectorPage() {
  const { token } = useAuth();

  const [health, setHealth] = useState<DirectorHealth | null>(null);
  const [agents, setAgents] = useState<DirectorAgent[]>([]);
  const [metrics, setMetrics] = useState<DirectorMetrics | null>(null);
  const [logs, setLogs] = useState<string>('');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [loading, setLoading] = useState({
    health: true,
    agents: true,
    metrics: true,
    deploy: false,
    stop: false,
    logs: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Deploy modal
  const [deployOpen, setDeployOpen] = useState(false);
  const [candidates, setCandidates] = useState<Deployable[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedDeployId, setSelectedDeployId] = useState('');

  const authHeaders = useCallback(
    (): Record<string, string> => ({
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [token],
  );

  const fetchHealth = useCallback(async () => {
    setLoading((prev) => ({ ...prev, health: true }));
    try {
      const res = await fetch(`${API_BASE}/director/health`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error fetching health: ${res.statusText}`);
      setHealth(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
      setHealth(null);
    } finally {
      setLoading((prev) => ({ ...prev, health: false }));
    }
  }, [authHeaders]);

  const fetchAgents = useCallback(async () => {
    setLoading((prev) => ({ ...prev, agents: true }));
    try {
      const res = await fetch(`${API_BASE}/director/agents`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error fetching agents: ${res.statusText}`);
      setAgents(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch agents');
      setAgents([]);
    } finally {
      setLoading((prev) => ({ ...prev, agents: false }));
    }
  }, [authHeaders]);

  const fetchMetrics = useCallback(async () => {
    setLoading((prev) => ({ ...prev, metrics: true }));
    try {
      const res = await fetch(`${API_BASE}/director/metrics`, { headers: authHeaders() });
      if (!res.ok) throw new Error(`Error fetching metrics: ${res.statusText}`);
      setMetrics(await res.json());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to fetch metrics');
      setMetrics(null);
    } finally {
      setLoading((prev) => ({ ...prev, metrics: false }));
    }
  }, [authHeaders]);

  // El backend devuelve { logs: string } (no un array de entries).
  const fetchLogs = useCallback(
    async (agentId: string) => {
      setLoading((prev) => ({ ...prev, logs: true }));
      try {
        const res = await fetch(`${API_BASE}/director/agents/${agentId}/logs`, {
          headers: authHeaders(),
        });
        if (!res.ok) throw new Error(`Error fetching logs: ${res.statusText}`);
        const data: { logs?: string; message?: string } = await res.json();
        setLogs(data.logs || data.message || '');
        setSelectedAgentId(agentId);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to fetch logs');
        setLogs('');
      } finally {
        setLoading((prev) => ({ ...prev, logs: false }));
      }
    },
    [authHeaders],
  );

  // Candidatos a desplegar: deployables que no están corriendo.
  const openDeployModal = useCallback(async () => {
    setDeployOpen(true);
    setSelectedDeployId('');
    setLoadingCandidates(true);
    try {
      const res = await deployableService.list({ limit: 100 });
      setCandidates(res.data.filter((d) => d.status !== 'running'));
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }, []);

  // Deploy real: el endpoint espera { agentId } = id del deployable.
  const handleDeploy = useCallback(async () => {
    if (!selectedDeployId) return;
    setLoading((prev) => ({ ...prev, deploy: true }));
    setActionError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/director/deploy`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ agentId: selectedDeployId }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Deploy failed: ${res.statusText}`);
      }
      setDeployOpen(false);
      setSuccessMessage('Deployable desplegado correctamente');
      await Promise.all([fetchAgents(), fetchMetrics()]);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : 'Failed to deploy');
    } finally {
      setLoading((prev) => ({ ...prev, deploy: false }));
    }
  }, [selectedDeployId, authHeaders, fetchAgents, fetchMetrics]);

  const handleStop = useCallback(
    async (agentId: string) => {
      setLoading((prev) => ({ ...prev, stop: true }));
      setActionError(null);
      setSuccessMessage(null);
      try {
        const res = await fetch(`${API_BASE}/director/${agentId}/stop`, {
          method: 'POST',
          headers: authHeaders(),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.message || `Stop failed: ${res.statusText}`);
        }
        setSuccessMessage('Deployable detenido correctamente');
        if (selectedAgentId === agentId) {
          setSelectedAgentId(null);
          setLogs('');
        }
        await Promise.all([fetchAgents(), fetchMetrics()]);
      } catch (err: unknown) {
        setActionError(err instanceof Error ? err.message : 'Failed to stop agent');
      } finally {
        setLoading((prev) => ({ ...prev, stop: false }));
      }
    },
    [authHeaders, fetchAgents, fetchMetrics, selectedAgentId],
  );

  useEffect(() => {
    fetchHealth();
    fetchAgents();
    fetchMetrics();
  }, [fetchHealth, fetchAgents, fetchMetrics]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  useEffect(() => {
    if (actionError) {
      const timer = setTimeout(() => setActionError(null), 6000);
      return () => clearTimeout(timer);
    }
  }, [actionError]);

  const formatUptime = (seconds: number): string => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    return parts.join(' ') || '< 1m';
  };

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'degraded':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'down':
        return <XCircle className="h-5 w-5 text-red-500" />;
      default:
        return <AlertCircle className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const base = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    switch (status) {
      case 'running':
        return <span className={`${base} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>Running</span>;
      case 'stopped':
        return <span className={`${base} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200`}>Stopped</span>;
      case 'error':
        return <span className={`${base} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>Error</span>;
      default:
        return <span className={`${base} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200`}>{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Director Panel</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Despliega y monitorea los deployables en runtime
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchHealth();
              fetchAgents();
              fetchMetrics();
            }}
            disabled={loading.health || loading.agents || loading.metrics}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading.health || loading.agents || loading.metrics ? 'animate-spin' : ''}`} />
            Refrescar
          </Button>
          <Button size="sm" onClick={openDeployModal}>
            <Play className="h-4 w-4 mr-2" />
            Desplegar
          </Button>
        </div>
      </div>

      {/* Messages */}
      {successMessage && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
          <div className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
            <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
          </div>
        </div>
      )}
      {actionError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <div className="flex items-center">
            <XCircle className="h-5 w-5 text-red-500 mr-2" />
            <p className="text-sm text-red-800 dark:text-red-200">{actionError}</p>
          </div>
        </div>
      )}

      {/* Health */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Activity className="h-5 w-5 text-blue-500" />
              Director Health
            </h2>
            {loading.health && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          {health ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                {getHealthIcon(health.status)}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{health.status}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Server className="h-5 w-5 text-purple-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {health.runtimes.filter((r) => r.reachable === 'reachable').length}/{health.runtimes.length}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Runtimes</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <Activity className="h-5 w-5 text-indigo-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{formatUptime(health.uptime)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Uptime</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {error ? `Error: ${error}` : 'No health data available'}
            </p>
          )}
        </div>
      </Card>

      {/* Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Agents"
          value={metrics?.byKind?.agent ?? 0}
          icon={<Server className="h-5 w-5 text-blue-500" />}
          isLoading={loading.metrics}
        />
        <MetricCard
          title="Active Deployables"
          value={metrics?.activeDeployables ?? 0}
          icon={<Activity className="h-5 w-5 text-green-500" />}
          isLoading={loading.metrics}
        />
        <MetricCard
          title="Departments"
          value={metrics?.totalDepartments ?? 0}
          icon={<HardDrive className="h-5 w-5 text-purple-500" />}
          isLoading={loading.metrics}
        />
        <MetricCard
          title="Memory Usage"
          value={metrics ? `${metrics.memoryUsageMb} MB` : 'N/A'}
          icon={<Cpu className="h-5 w-5 text-orange-500" />}
          isLoading={loading.metrics}
        />
      </div>

      {/* Deployed agents */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-500" />
              Deployables en ejecución
            </h2>
            {loading.agents && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          {agents.length === 0 && !loading.agents ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No hay deployables en ejecución.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Nombre</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Tipo</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Estado</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Iniciado</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {agents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">{agent.name}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">{agent.kind}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{getStatusBadge(agent.status)}</td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {new Date(agent.createdAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-right text-sm font-medium">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => fetchLogs(agent.id)}
                            disabled={loading.logs && selectedAgentId === agent.id}
                          >
                            <Terminal className="h-4 w-4" />
                          </Button>
                          {agent.status === 'running' && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => handleStop(agent.id)}
                              disabled={loading.stop}
                            >
                              <Square className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>

      {/* Logs */}
      {selectedAgentId && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Terminal className="h-5 w-5 text-green-500" />
                Logs de {selectedAgentId.slice(0, 8)}...
              </h2>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => fetchLogs(selectedAgentId)} disabled={loading.logs}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading.logs ? 'animate-spin' : ''}`} />
                  Refrescar
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedAgentId(null);
                    setLogs('');
                  }}
                >
                  Cerrar
                </Button>
              </div>
            </div>
            {loading.logs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : !logs ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No hay logs disponibles para este deployable.</p>
            ) : (
              <pre className="bg-gray-900 dark:bg-black rounded-lg p-4 max-h-96 overflow-auto font-mono text-xs text-gray-300 whitespace-pre-wrap break-all">
                {logs}
              </pre>
            )}
          </div>
        </Card>
      )}

      {/* Deploy modal */}
      {deployOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-white dark:bg-gray-800 rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Desplegar deployable</h2>
              <button
                onClick={() => setDeployOpen(false)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                aria-label="Cerrar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="px-6 py-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Deployable
                </label>
                {loadingCandidates ? (
                  <div className="flex items-center gap-2 text-sm text-gray-500 py-2">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Cargando candidatos...
                  </div>
                ) : candidates.length === 0 ? (
                  <p className="text-sm text-gray-500 py-2">
                    No hay deployables disponibles para desplegar. Creá uno en la sección Deployables.
                  </p>
                ) : (
                  <select
                    value={selectedDeployId}
                    onChange={(e) => setSelectedDeployId(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    <option value="">Seleccioná un deployable…</option>
                    {candidates.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} — {d.kind} ({d.status})
                      </option>
                    ))}
                  </select>
                )}
                <p className="mt-2 text-xs text-gray-400">
                  El director valida los secrets requeridos del departamento antes de arrancar el runtime.
                </p>
              </div>

              {actionError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-600">{actionError}</p>
                </div>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <Button variant="secondary" onClick={() => setDeployOpen(false)} disabled={loading.deploy}>
                  Cancelar
                </Button>
                <Button onClick={handleDeploy} disabled={loading.deploy || !selectedDeployId}>
                  {loading.deploy ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Desplegando...
                    </span>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Desplegar
                    </>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
