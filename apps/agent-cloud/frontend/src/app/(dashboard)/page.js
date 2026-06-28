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
exports.default = DashboardPage;
const react_1 = __importStar(require("react"));
const auth_context_1 = require("@/lib/auth-context");
const api_1 = require("@/lib/api");
const metric_card_1 = __importDefault(require("@/components/ui/metric-card"));
const lucide_react_1 = require("lucide-react");
function DashboardPage() {
    const { user } = (0, auth_context_1.useAuth)();
    const [metrics, setMetrics] = (0, react_1.useState)(null);
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    const fetchMetrics = (0, react_1.useCallback)(async () => {
        try {
            setLoading(true);
            setError(null);
            const [directorMetricsResponse, projectsResponse] = await Promise.allSettled([
                api_1.api.get('/api/director/metrics'),
                api_1.api.get('/api/projects', { params: { page: 1, limit: 1 } }),
            ]);
            let totalAgents = 0;
            let activeAgents = 0;
            let totalProjects = 0;
            let uptime;
            let memoryUsage;
            let cpuUsage;
            if (directorMetricsResponse.status === 'fulfilled') {
                const directorData = directorMetricsResponse.value.data;
                totalAgents = directorData.totalAgents ?? 0;
                activeAgents = directorData.activeAgents ?? 0;
                totalProjects = directorData.totalProjects ?? 0;
                uptime = directorData.uptime;
                memoryUsage = directorData.memoryUsage;
                cpuUsage = directorData.cpuUsage;
            }
            if (projectsResponse.status === 'fulfilled') {
                const projectsData = projectsResponse.value.data;
                totalProjects = projectsData.total ?? projectsData.length ?? totalProjects;
            }
            setMetrics({
                totalAgents,
                activeAgents,
                totalProjects,
                uptime,
                memoryUsage,
                cpuUsage,
            });
        }
        catch (err) {
            console.error('Error fetching dashboard metrics:', err);
            setError('Error al cargar las métricas del dashboard. Intente nuevamente.');
        }
        finally {
            setLoading(false);
        }
    }, []);
    (0, react_1.useEffect)(() => {
        fetchMetrics();
    }, [fetchMetrics]);
    const formatUptime = (seconds) => {
        if (!seconds)
            return 'N/A';
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
    if (loading) {
        return (<div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4">
          <lucide_react_1.Loader2 className="h-10 w-10 animate-spin text-blue-600"/>
          <p className="text-gray-500 text-sm">Cargando métricas del dashboard...</p>
        </div>
      </div>);
    }
    if (error) {
        return (<div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <lucide_react_1.AlertCircle className="h-12 w-12 text-red-500"/>
          <h2 className="text-xl font-semibold text-gray-800">Error al cargar</h2>
          <p className="text-gray-500">{error}</p>
          <button onClick={fetchMetrics} className="mt-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
            Reintentar
          </button>
        </div>
      </div>);
    }
    return (<div className="space-y-8">
      
      <div>
        <h1 className="text-3xl font-bold text-gray-900">
          Dashboard
        </h1>
        <p className="mt-2 text-gray-500">
          Bienvenido{user?.name ? `, ${user.name}` : ''}. Resumen general del sistema Agent-Cloud.
        </p>
      </div>

      
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        <metric_card_1.default title="Total de Agentes" value={metrics?.totalAgents ?? 0} icon={<lucide_react_1.Users className="h-6 w-6 text-blue-600"/>} description="Agentes registrados en el sistema" trend={metrics?.totalAgents ? `${metrics.totalAgents} en total` : undefined}/>
        <metric_card_1.default title="Agentes Activos" value={metrics?.activeAgents ?? 0} icon={<lucide_react_1.Activity className="h-6 w-6 text-green-600"/>} description="Agentes actualmente en ejecución" trend={metrics?.totalAgents && metrics.totalAgents > 0
            ? `${Math.round((metrics.activeAgents / metrics.totalAgents) * 100)}% activos`
            : undefined}/>
        <metric_card_1.default title="Total de Proyectos" value={metrics?.totalProjects ?? 0} icon={<lucide_react_1.FolderOpen className="h-6 w-6 text-purple-600"/>} description="Proyectos creados en la plataforma" trend={metrics?.totalProjects ? `${metrics.totalProjects} proyectos` : undefined}/>
      </div>

      
      {(metrics?.uptime !== undefined || metrics?.memoryUsage !== undefined || metrics?.cpuUsage !== undefined) && (<div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-2 mb-6">
            <lucide_react_1.TrendingUp className="h-5 w-5 text-gray-600"/>
            <h2 className="text-lg font-semibold text-gray-900">Estado del Sistema</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {metrics.uptime !== undefined && (<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Tiempo de actividad</span>
                <span className="text-2xl font-bold text-gray-900">{formatUptime(metrics.uptime)}</span>
              </div>)}
            {metrics.memoryUsage !== undefined && (<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Uso de memoria</span>
                <span className="text-2xl font-bold text-gray-900">{metrics.memoryUsage}%</span>
              </div>)}
            {metrics.cpuUsage !== undefined && (<div className="flex flex-col items-center p-4 bg-gray-50 rounded-lg">
                <span className="text-sm text-gray-500 mb-1">Uso de CPU</span>
                <span className="text-2xl font-bold text-gray-900">{metrics.cpuUsage}%</span>
              </div>)}
          </div>
        </div>)}

      
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Acciones rápidas</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <a href="/dashboard/projects" className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-all group">
            <lucide_react_1.FolderOpen className="h-8 w-8 text-blue-600 group-hover:scale-110 transition-transform"/>
            <div>
              <p className="font-medium text-gray-900">Gestionar Proyectos</p>
              <p className="text-sm text-gray-500">Crear y administrar proyectos</p>
            </div>
          </a>
          <a href="/dashboard/agents" className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-all group">
            <lucide_react_1.Users className="h-8 w-8 text-green-600 group-hover:scale-110 transition-transform"/>
            <div>
              <p className="font-medium text-gray-900">Gestionar Agentes</p>
              <p className="text-sm text-gray-500">Configurar y monitorear agentes</p>
            </div>
          </a>
          <a href="/dashboard/director" className="flex items-center gap-3 p-4 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-all group">
            <lucide_react_1.Activity className="h-8 w-8 text-purple-600 group-hover:scale-110 transition-transform"/>
            <div>
              <p className="font-medium text-gray-900">Panel del Director</p>
              <p className="text-sm text-gray-500">Desplegar y controlar agentes</p>
            </div>
          </a>
        </div>
      </div>
    </div>);
}
//# sourceMappingURL=page.js.map