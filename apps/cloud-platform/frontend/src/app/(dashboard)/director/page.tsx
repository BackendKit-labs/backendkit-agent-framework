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
} from 'lucide-react';
import Button from '@/components/ui/button';
import Card from '@/components/ui/card';
import MetricCard from '@/components/ui/metric-card';

interface DirectorHealth {
  status: 'healthy' | 'degraded' | 'down';
  uptime: number;
  version: string;
}

interface DirectorAgent {
  id: string;
  agentName: string;
  agentType: string;
  projectId: string;
  status: 'running' | 'stopped' | 'error';
  startedAt: string;
}

interface DirectorMetrics {
  totalAgents: number;
  activeAgents: number;
  totalProjects: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export default function DirectorPage() {
  const { token } = useAuth();

  // State
  const [health, setHealth] = useState<DirectorHealth | null>(null);
  const [agents, setAgents] = useState<DirectorAgent[]>([]);
  const [metrics, setMetrics] = useState<DirectorMetrics | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
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
  const [deployError, setDeployError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Fetch health status
  const fetchHealth = useCallback(async () => {
    setLoading((prev) => ({ ...prev, health: true }));
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/director/health`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Error fetching health: ${res.statusText}`);
      }
      const data: DirectorHealth = await res.json();
      setHealth(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch health status';
      setError(message);
      setHealth(null);
    } finally {
      setLoading((prev) => ({ ...prev, health: false }));
    }
  }, [token]);

  // Fetch deployed agents
  const fetchAgents = useCallback(async () => {
    setLoading((prev) => ({ ...prev, agents: true }));
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/director/agents`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Error fetching agents: ${res.statusText}`);
      }
      const data: DirectorAgent[] = await res.json();
      setAgents(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch agents';
      setError(message);
      setAgents([]);
    } finally {
      setLoading((prev) => ({ ...prev, agents: false }));
    }
  }, [token]);

  // Fetch metrics
  const fetchMetrics = useCallback(async () => {
    setLoading((prev) => ({ ...prev, metrics: true }));
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/director/metrics`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Error fetching metrics: ${res.statusText}`);
      }
      const data: DirectorMetrics = await res.json();
      setMetrics(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch metrics';
      setError(message);
      setMetrics(null);
    } finally {
      setLoading((prev) => ({ ...prev, metrics: false }));
    }
  }, [token]);

  // Fetch logs for a specific agent
  const fetchLogs = useCallback(async (agentId: string) => {
    setLoading((prev) => ({ ...prev, logs: true }));
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/director/agents/${agentId}/logs`, {
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        throw new Error(`Error fetching logs: ${res.statusText}`);
      }
      const data: LogEntry[] = await res.json();
      setLogs(data);
      setSelectedAgentId(agentId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to fetch logs';
      setError(message);
      setLogs([]);
    } finally {
      setLoading((prev) => ({ ...prev, logs: false }));
    }
  }, [token]);

  // Deploy a new agent
  const handleDeploy = useCallback(async () => {
    setLoading((prev) => ({ ...prev, deploy: true }));
    setDeployError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/director/deploy`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Deploy failed: ${res.statusText}`);
      }
      setSuccessMessage('Agent deployed successfully');
      await fetchAgents();
      await fetchMetrics();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to deploy agent';
      setDeployError(message);
    } finally {
      setLoading((prev) => ({ ...prev, deploy: false }));
    }
  }, [token, fetchAgents, fetchMetrics]);

  // Stop an agent
  const handleStop = useCallback(async (agentId: string) => {
    setLoading((prev) => ({ ...prev, stop: true }));
    setDeployError(null);
    setSuccessMessage(null);
    try {
      const res = await fetch(`${API_BASE}/director/${agentId}/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.message || `Stop failed: ${res.statusText}`);
      }
      setSuccessMessage(`Agent ${agentId} stopped successfully`);
      await fetchAgents();
      await fetchMetrics();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to stop agent';
      setDeployError(message);
    } finally {
      setLoading((prev) => ({ ...prev, stop: false }));
    }
  }, [token, fetchAgents, fetchMetrics]);

  // Initial load
  useEffect(() => {
    fetchHealth();
    fetchAgents();
    fetchMetrics();
  }, [fetchHealth, fetchAgents, fetchMetrics]);

  // Auto-dismiss success message
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Auto-dismiss error message
  useEffect(() => {
    if (deployError) {
      const timer = setTimeout(() => setDeployError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [deployError]);

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
    const baseClasses = 'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium';
    switch (status) {
      case 'running':
        return <span className={`${baseClasses} bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200`}>Running</span>;
      case 'stopped':
        return <span className={`${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200`}>Stopped</span>;
      case 'error':
        return <span className={`${baseClasses} bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200`}>Error</span>;
      default:
        return <span className={`${baseClasses} bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200`}>{status}</span>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Director Panel</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage and monitor your agent director
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
            Refresh
          </Button>
          <Button
            size="sm"
            onClick={handleDeploy}
            disabled={loading.deploy}
          >
            {loading.deploy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Deploy Agent
          </Button>
        </div>
      </div>

      {/* Success/Error Messages */}
      {successMessage && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
          <div className="flex items-center">
            <CheckCircle className="h-5 w-5 text-green-500 mr-2" />
            <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
          </div>
        </div>
      )}
      {deployError && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <div className="flex items-center">
            <XCircle className="h-5 w-5 text-red-500 mr-2" />
            <p className="text-sm text-red-800 dark:text-red-200">{deployError}</p>
          </div>
        </div>
      )}

      {/* Health Status */}
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
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{health.version}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Version</p>
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

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Total Agents"
          value={metrics?.totalAgents ?? 0}
          icon={<Server className="h-5 w-5 text-blue-500" />}
          loading={loading.metrics}
        />
        <MetricCard
          title="Active Agents"
          value={metrics?.activeAgents ?? 0}
          icon={<Activity className="h-5 w-5 text-green-500" />}
          loading={loading.metrics}
        />
        <MetricCard
          title="Total Projects"
          value={metrics?.totalProjects ?? 0}
          icon={<HardDrive className="h-5 w-5 text-purple-500" />}
          loading={loading.metrics}
        />
        <MetricCard
          title="CPU Usage"
          value={metrics ? `${metrics.cpuUsage.toFixed(1)}%` : 'N/A'}
          icon={<Cpu className="h-5 w-5 text-orange-500" />}
          loading={loading.metrics}
        />
      </div>

      {/* Deployed Agents */}
      <Card>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-500" />
              Deployed Agents
            </h2>
            {loading.agents && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          {agents.length === 0 && !loading.agents ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No agents deployed yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Agent Name
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Type
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Started At
                    </th>
                    <th scope="col" className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white dark:bg-gray-900 divide-y divide-gray-200 dark:divide-gray-700">
                  {agents.map((agent) => (
                    <tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 dark:text-white">
                        {agent.agentName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {agent.agentType}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(agent.status)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500 dark:text-gray-400">
                        {new Date(agent.startedAt).toLocaleString()}
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

      {/* Logs Section */}
      {selectedAgentId && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Terminal className="h-5 w-5 text-green-500" />
                Logs for Agent {selectedAgentId.slice(0, 8)}...
              </h2>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchLogs(selectedAgentId)}
                  disabled={loading.logs}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading.logs ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelectedAgentId(null);
                    setLogs([]);
                  }}
                >
                  Close
                </Button>
              </div>
            </div>
            {loading.logs ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : logs.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">No logs available for this agent.</p>
            ) : (
              <div className="bg-gray-900 dark:bg-black rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs">
                {logs.map((log, index) => (
                  <div key={index} className="flex gap-2 py-1 border-b border-gray-800 last:border-b-0">
                    <span className="text-gray-500 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${
                        log.level === 'error'
                          ? 'text-red-400'
                          : log.level === 'warn'
                          ? 'text-yellow-400'
                          : 'text-green-400'
                      }`}
                    >
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-gray-300 break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}