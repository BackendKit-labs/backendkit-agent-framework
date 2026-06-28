"use strict";
'use client';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = DirectorPage;
const react_1 = __importStar(require("react"));
const auth_context_1 = require("@/lib/auth-context");
const lucide_react_1 = require("lucide-react");
const button_1 = __importDefault(require("@/components/ui/button"));
const card_1 = __importDefault(require("@/components/ui/card"));
const metric_card_1 = __importDefault(require("@/components/ui/metric-card"));
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
function DirectorPage() {
    const { token } = (0, auth_context_1.useAuth)();
    const [health, setHealth] = (0, react_1.useState)(null);
    const [agents, setAgents] = (0, react_1.useState)([]);
    const [metrics, setMetrics] = (0, react_1.useState)(null);
    const [logs, setLogs] = (0, react_1.useState)([]);
    const [selectedAgentId, setSelectedAgentId] = (0, react_1.useState)(null);
    const [loading, setLoading] = (0, react_1.useState)({
        health: true,
        agents: true,
        metrics: true,
        deploy: false,
        stop: false,
        logs: false,
    });
    const [error, setError] = (0, react_1.useState)(null);
    const [deployError, setDeployError] = (0, react_1.useState)(null);
    const [successMessage, setSuccessMessage] = (0, react_1.useState)(null);
    const fetchHealth = (0, react_1.useCallback)(async () => {
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
            const data = await res.json();
            setHealth(data);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch health status';
            setError(message);
            setHealth(null);
        }
        finally {
            setLoading((prev) => ({ ...prev, health: false }));
        }
    }, [token]);
    const fetchAgents = (0, react_1.useCallback)(async () => {
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
            const data = await res.json();
            setAgents(data);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch agents';
            setError(message);
            setAgents([]);
        }
        finally {
            setLoading((prev) => ({ ...prev, agents: false }));
        }
    }, [token]);
    const fetchMetrics = (0, react_1.useCallback)(async () => {
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
            const data = await res.json();
            setMetrics(data);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch metrics';
            setError(message);
            setMetrics(null);
        }
        finally {
            setLoading((prev) => ({ ...prev, metrics: false }));
        }
    }, [token]);
    const fetchLogs = (0, react_1.useCallback)(async (agentId) => {
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
            const data = await res.json();
            setLogs(data);
            setSelectedAgentId(agentId);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to fetch logs';
            setError(message);
            setLogs([]);
        }
        finally {
            setLoading((prev) => ({ ...prev, logs: false }));
        }
    }, [token]);
    const handleDeploy = (0, react_1.useCallback)(async () => {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to deploy agent';
            setDeployError(message);
        }
        finally {
            setLoading((prev) => ({ ...prev, deploy: false }));
        }
    }, [token, fetchAgents, fetchMetrics]);
    const handleStop = (0, react_1.useCallback)(async (agentId) => {
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
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to stop agent';
            setDeployError(message);
        }
        finally {
            setLoading((prev) => ({ ...prev, stop: false }));
        }
    }, [token, fetchAgents, fetchMetrics]);
    (0, react_1.useEffect)(() => {
        fetchHealth();
        fetchAgents();
        fetchMetrics();
    }, [fetchHealth, fetchAgents, fetchMetrics]);
    (0, react_1.useEffect)(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);
    (0, react_1.useEffect)(() => {
        if (deployError) {
            const timer = setTimeout(() => setDeployError(null), 5000);
            return () => clearTimeout(timer);
        }
    }, [deployError]);
    const formatUptime = (seconds) => {
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor((seconds % 86400) / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const parts = [];
        if (days > 0)
            parts.push(`${days}d`);
        if (hours > 0)
            parts.push(`${hours}h`);
        if (minutes > 0)
            parts.push(`${minutes}m`);
        return parts.join(' ') || '< 1m';
    };
    const getHealthIcon = (status) => {
        switch (status) {
            case 'healthy':
                return <lucide_react_1.CheckCircle className="h-5 w-5 text-green-500"/>;
            case 'degraded':
                return <lucide_react_1.AlertCircle className="h-5 w-5 text-yellow-500"/>;
            case 'down':
                return <lucide_react_1.XCircle className="h-5 w-5 text-red-500"/>;
            default:
                return <lucide_react_1.AlertCircle className="h-5 w-5 text-gray-500"/>;
        }
    };
    const getStatusBadge = (status) => {
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
    return (<div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Director Panel</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Manage and monitor your agent director
          </p>
        </div>
        <div className="flex gap-2">
          <button_1.default variant="outline" size="sm" onClick={() => {
            fetchHealth();
            fetchAgents();
            fetchMetrics();
        }} disabled={loading.health || loading.agents || loading.metrics}>
            <lucide_react_1.RefreshCw className={`h-4 w-4 mr-2 ${loading.health || loading.agents || loading.metrics ? 'animate-spin' : ''}`}/>
            Refresh
          </button_1.default>
          <button_1.default size="sm" onClick={handleDeploy} disabled={loading.deploy}>
            {loading.deploy ? (<lucide_react_1.Loader2 className="h-4 w-4 mr-2 animate-spin"/>) : (<lucide_react_1.Play className="h-4 w-4 mr-2"/>)}
            Deploy Agent
          </button_1.default>
        </div>
      </div>

      
      {successMessage && (<div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
          <div className="flex items-center">
            <lucide_react_1.CheckCircle className="h-5 w-5 text-green-500 mr-2"/>
            <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
          </div>
        </div>)}
      {deployError && (<div className="rounded-md bg-red-50 dark:bg-red-900/20 p-4 border border-red-200 dark:border-red-800">
          <div className="flex items-center">
            <lucide_react_1.XCircle className="h-5 w-5 text-red-500 mr-2"/>
            <p className="text-sm text-red-800 dark:text-red-200">{deployError}</p>
          </div>
        </div>)}

      
      <card_1.default>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <lucide_react_1.Activity className="h-5 w-5 text-blue-500"/>
              Director Health
            </h2>
            {loading.health && <lucide_react_1.Loader2 className="h-4 w-4 animate-spin text-gray-400"/>}
          </div>
          {health ? (<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                {getHealthIcon(health.status)}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{health.status}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Status</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <lucide_react_1.Server className="h-5 w-5 text-purple-500"/>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{health.version}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Version</p>
                </div>
              </div>
              <div className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <lucide_react_1.Activity className="h-5 w-5 text-indigo-500"/>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{formatUptime(health.uptime)}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">Uptime</p>
                </div>
              </div>
            </div>) : (<p className="text-sm text-gray-500 dark:text-gray-400">
              {error ? `Error: ${error}` : 'No health data available'}
            </p>)}
        </div>
      </card_1.default>

      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <metric_card_1.default title="Total Agents" value={metrics?.totalAgents ?? 0} icon={<lucide_react_1.Server className="h-5 w-5 text-blue-500"/>} loading={loading.metrics}/>
        <metric_card_1.default title="Active Agents" value={metrics?.activeAgents ?? 0} icon={<lucide_react_1.Activity className="h-5 w-5 text-green-500"/>} loading={loading.metrics}/>
        <metric_card_1.default title="Total Projects" value={metrics?.totalProjects ?? 0} icon={<lucide_react_1.HardDrive className="h-5 w-5 text-purple-500"/>} loading={loading.metrics}/>
        <metric_card_1.default title="CPU Usage" value={metrics ? `${metrics.cpuUsage.toFixed(1)}%` : 'N/A'} icon={<lucide_react_1.Cpu className="h-5 w-5 text-orange-500"/>} loading={loading.metrics}/>
      </div>

      
      <card_1.default>
        <div className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <lucide_react_1.Server className="h-5 w-5 text-blue-500"/>
              Deployed Agents
            </h2>
            {loading.agents && <lucide_react_1.Loader2 className="h-4 w-4 animate-spin text-gray-400"/>}
          </div>
          {agents.length === 0 && !loading.agents ? (<p className="text-sm text-gray-500 dark:text-gray-400">No agents deployed yet.</p>) : (<div className="overflow-x-auto">
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
                  {agents.map((agent) => (<tr key={agent.id} className="hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
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
                          <button_1.default variant="outline" size="sm" onClick={() => fetchLogs(agent.id)} disabled={loading.logs && selectedAgentId === agent.id}>
                            <lucide_react_1.Terminal className="h-4 w-4"/>
                          </button_1.default>
                          {agent.status === 'running' && (<button_1.default variant="danger" size="sm" onClick={() => handleStop(agent.id)} disabled={loading.stop}>
                              <lucide_react_1.Square className="h-4 w-4"/>
                            </button_1.default>)}
                        </div>
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>)}
        </div>
      </card_1.default>

      
      {selectedAgentId && (<card_1.default>
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <lucide_react_1.Terminal className="h-5 w-5 text-green-500"/>
                Logs for Agent {selectedAgentId.slice(0, 8)}...
              </h2>
              <div className="flex gap-2">
                <button_1.default variant="outline" size="sm" onClick={() => fetchLogs(selectedAgentId)} disabled={loading.logs}>
                  <lucide_react_1.RefreshCw className={`h-4 w-4 mr-2 ${loading.logs ? 'animate-spin' : ''}`}/>
                  Refresh
                </button_1.default>
                <button_1.default variant="ghost" size="sm" onClick={() => {
                setSelectedAgentId(null);
                setLogs([]);
            }}>
                  Close
                </button_1.default>
              </div>
            </div>
            {loading.logs ? (<div className="flex items-center justify-center py-8">
                <lucide_react_1.Loader2 className="h-6 w-6 animate-spin text-gray-400"/>
              </div>) : logs.length === 0 ? (<p className="text-sm text-gray-500 dark:text-gray-400">No logs available for this agent.</p>) : (<div className="bg-gray-900 dark:bg-black rounded-lg p-4 max-h-96 overflow-y-auto font-mono text-xs">
                {logs.map((log, index) => (<div key={index} className="flex gap-2 py-1 border-b border-gray-800 last:border-b-0">
                    <span className="text-gray-500 shrink-0">
                      {new Date(log.timestamp).toLocaleTimeString()}
                    </span>
                    <span className={`shrink-0 font-semibold ${log.level === 'error'
                        ? 'text-red-400'
                        : log.level === 'warn'
                            ? 'text-yellow-400'
                            : 'text-green-400'}`}>
                      [{log.level.toUpperCase()}]
                    </span>
                    <span className="text-gray-300 break-all">{log.message}</span>
                  </div>))}
              </div>)}
          </div>
        </card_1.default>)}
    </div>);
}
//# sourceMappingURL=page.js.map