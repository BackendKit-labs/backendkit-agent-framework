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
exports.default = AgentsPage;
const react_1 = __importStar(require("react"));
const navigation_1 = require("next/navigation");
const lucide_react_1 = require("lucide-react");
const auth_context_1 = require("@/lib/auth-context");
const data_table_1 = __importDefault(require("@/components/ui/data-table"));
const AgentModal_1 = __importDefault(require("@/components/AgentModal"));
const AgentStatusBadge_1 = __importDefault(require("@/components/AgentStatusBadge"));
const button_1 = __importDefault(require("@/components/ui/button"));
const card_1 = __importDefault(require("@/components/ui/card"));
const api_1 = require("@/lib/api");
const AGENT_TYPES = ['chat', 'task', 'monitor', 'custom'];
const AGENT_STATUSES = ['idle', 'active', 'error', 'stopped'];
function AgentsPage() {
    const router = (0, navigation_1.useRouter)();
    const { user, isLoading: authLoading } = (0, auth_context_1.useAuth)();
    const [agents, setAgents] = (0, react_1.useState)([]);
    const [total, setTotal] = (0, react_1.useState)(0);
    const [page, setPage] = (0, react_1.useState)(1);
    const [limit] = (0, react_1.useState)(10);
    const [totalPages, setTotalPages] = (0, react_1.useState)(0);
    const [search, setSearch] = (0, react_1.useState)('');
    const [searchInput, setSearchInput] = (0, react_1.useState)('');
    const [typeFilter, setTypeFilter] = (0, react_1.useState)('');
    const [statusFilter, setStatusFilter] = (0, react_1.useState)('');
    const [isLoading, setIsLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    const [isModalOpen, setIsModalOpen] = (0, react_1.useState)(false);
    const [editingAgent, setEditingAgent] = (0, react_1.useState)(null);
    const [isSubmitting, setIsSubmitting] = (0, react_1.useState)(false);
    const [deletingAgent, setDeletingAgent] = (0, react_1.useState)(null);
    const [isDeleting, setIsDeleting] = (0, react_1.useState)(false);
    const [showFilters, setShowFilters] = (0, react_1.useState)(false);
    const fetchAgents = (0, react_1.useCallback)(async () => {
        if (authLoading)
            return;
        if (!user) {
            router.push('/login');
            return;
        }
        setIsLoading(true);
        setError(null);
        try {
            const params = new URLSearchParams();
            params.set('page', String(page));
            params.set('limit', String(limit));
            if (search)
                params.set('search', search);
            if (typeFilter)
                params.set('type', typeFilter);
            if (statusFilter)
                params.set('status', statusFilter);
            const response = await api_1.api.get(`/api/agents?${params.toString()}`);
            setAgents(response.data.data);
            setTotal(response.data.total);
            setTotalPages(response.data.totalPages);
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Error al cargar agentes';
            setError(message);
            setAgents([]);
            setTotal(0);
            setTotalPages(0);
        }
        finally {
            setIsLoading(false);
        }
    }, [page, limit, search, typeFilter, statusFilter, user, authLoading, router]);
    (0, react_1.useEffect)(() => {
        fetchAgents();
    }, [fetchAgents]);
    const handleSearch = (0, react_1.useCallback)((e) => {
        e.preventDefault();
        setPage(1);
        setSearch(searchInput);
    }, [searchInput]);
    const handleClearSearch = (0, react_1.useCallback)(() => {
        setSearchInput('');
        setSearch('');
        setPage(1);
    }, []);
    const handleTypeFilterChange = (0, react_1.useCallback)((type) => {
        setTypeFilter(type);
        setPage(1);
    }, []);
    const handleStatusFilterChange = (0, react_1.useCallback)((status) => {
        setStatusFilter(status);
        setPage(1);
    }, []);
    const handleClearFilters = (0, react_1.useCallback)(() => {
        setTypeFilter('');
        setStatusFilter('');
        setSearchInput('');
        setSearch('');
        setPage(1);
    }, []);
    const handleOpenCreate = (0, react_1.useCallback)(() => {
        setEditingAgent(null);
        setIsModalOpen(true);
    }, []);
    const handleOpenEdit = (0, react_1.useCallback)((agent) => {
        setEditingAgent(agent);
        setIsModalOpen(true);
    }, []);
    const handleCloseModal = (0, react_1.useCallback)(() => {
        setIsModalOpen(false);
        setEditingAgent(null);
    }, []);
    const handleSubmit = (0, react_1.useCallback)(async (data) => {
        setIsSubmitting(true);
        try {
            if (editingAgent) {
                await api_1.api.patch(`/api/agents/${editingAgent.id}`, data);
            }
            else {
                await api_1.api.post('/api/agents', data);
            }
            handleCloseModal();
            await fetchAgents();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Error al guardar agente';
            throw new Error(message);
        }
        finally {
            setIsSubmitting(false);
        }
    }, [editingAgent, fetchAgents, handleCloseModal]);
    const handleDeleteClick = (0, react_1.useCallback)((agent) => {
        setDeletingAgent(agent);
    }, []);
    const handleConfirmDelete = (0, react_1.useCallback)(async () => {
        if (!deletingAgent)
            return;
        setIsDeleting(true);
        try {
            await api_1.api.delete(`/api/agents/${deletingAgent.id}`);
            setDeletingAgent(null);
            await fetchAgents();
        }
        catch (err) {
            const message = err instanceof Error ? err.message : 'Error al eliminar agente';
            setError(message);
        }
        finally {
            setIsDeleting(false);
        }
    }, [deletingAgent, fetchAgents]);
    const handleCancelDelete = (0, react_1.useCallback)(() => {
        setDeletingAgent(null);
    }, []);
    const handlePageChange = (0, react_1.useCallback)((newPage) => {
        setPage(newPage);
    }, []);
    const columns = [
        {
            key: 'name',
            header: 'Nombre',
            render: (agent) => (<span className="font-medium text-gray-900 dark:text-white">
          {agent.name}
        </span>),
        },
        {
            key: 'type',
            header: 'Tipo',
            render: (agent) => (<span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          {agent.type}
        </span>),
        },
        {
            key: 'status',
            header: 'Estado',
            render: (agent) => <AgentStatusBadge_1.default status={agent.status}/>,
        },
        {
            key: 'projectId',
            header: 'Proyecto',
            render: (agent) => (<span className="text-sm text-gray-500 dark:text-gray-400">
          {agent.projectId ? agent.projectId.substring(0, 8) + '...' : '-'}
        </span>),
        },
        {
            key: 'model',
            header: 'Modelo',
            render: (agent) => (<span className="text-sm text-gray-500 dark:text-gray-400">
          {agent.model || '-'}
        </span>),
        },
        {
            key: 'createdAt',
            header: 'Creado',
            render: (agent) => (<span className="text-sm text-gray-500 dark:text-gray-400">
          {new Date(agent.createdAt).toLocaleDateString('es-ES', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                })}
        </span>),
        },
        {
            key: 'actions',
            header: 'Acciones',
            render: (agent) => (<div className="flex items-center gap-2">
          <button onClick={() => handleOpenEdit(agent)} className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors" title="Editar agente">
            <lucide_react_1.Edit2 className="w-4 h-4"/>
          </button>
          <button onClick={() => handleDeleteClick(agent)} className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors" title="Eliminar agente">
            <lucide_react_1.Trash2 className="w-4 h-4"/>
          </button>
        </div>),
        },
    ];
    if (authLoading) {
        return (<div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/>
      </div>);
    }
    if (!user) {
        return null;
    }
    return (<div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            Agentes
          </h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Gestiona los agentes de IA de tus proyectos
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button_1.default variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <lucide_react_1.Filter className="w-4 h-4 mr-2"/>
            Filtros
            {(typeFilter || statusFilter) && (<span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-600 rounded-full">
                {(typeFilter ? 1 : 0) + (statusFilter ? 1 : 0)}
              </span>)}
          </button_1.default>
          <button_1.default variant="outline" size="sm" onClick={fetchAgents} disabled={isLoading}>
            <lucide_react_1.RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`}/>
            Actualizar
          </button_1.default>
          <button_1.default onClick={handleOpenCreate}>
            <lucide_react_1.Plus className="w-4 h-4 mr-2"/>
            Nuevo Agente
          </button_1.default>
        </div>
      </div>

      
      {showFilters && (<card_1.default className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <lucide_react_1.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"/>
                <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="Buscar por nombre..." className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"/>
                {searchInput && (<button type="button" onClick={() => setSearchInput('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    <lucide_react_1.X className="w-4 h-4"/>
                  </button>)}
              </div>
            </form>

            
            <div className="flex-1">
              <select value={typeFilter} onChange={(e) => handleTypeFilterChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="">Todos los tipos</option>
                {AGENT_TYPES.map((type) => (<option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>))}
              </select>
            </div>

            
            <div className="flex-1">
              <select value={statusFilter} onChange={(e) => handleStatusFilterChange(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                <option value="">Todos los estados</option>
                {AGENT_STATUSES.map((status) => (<option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>))}
              </select>
            </div>

            
            {(typeFilter || statusFilter || search) && (<div className="flex items-end">
                <button_1.default variant="ghost" size="sm" onClick={handleClearFilters}>
                  <lucide_react_1.X className="w-4 h-4 mr-1"/>
                  Limpiar
                </button_1.default>
              </div>)}
          </div>
        </card_1.default>)}

      
      {error && (<div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <lucide_react_1.X className="w-5 h-5 text-red-500"/>
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>)}

      
      <card_1.default>
        {isLoading ? (<div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"/>
          </div>) : agents.length === 0 ? (<div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              {search || typeFilter || statusFilter
                ? 'No se encontraron agentes con los filtros aplicados'
                : 'No hay agentes creados aún'}
            </p>
            {!search && !typeFilter && !statusFilter && (<button_1.default variant="outline" className="mt-4" onClick={handleOpenCreate}>
                <lucide_react_1.Plus className="w-4 h-4 mr-2"/>
                Crear primer agente
              </button_1.default>)}
          </div>) : (<data_table_1.default columns={columns} data={agents} page={page} totalPages={totalPages} total={total} onPageChange={handlePageChange}/>)}
      </card_1.default>

      
      {isModalOpen && (<AgentModal_1.default agent={editingAgent} onClose={handleCloseModal} onSubmit={handleSubmit} isSubmitting={isSubmitting}/>)}

      
      {deletingAgent && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Eliminar agente
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Estás seguro de que deseas eliminar el agente{' '}
              <span className="font-medium text-gray-900 dark:text-white">
                {deletingAgent.name}
              </span>
              ? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <button_1.default variant="outline" onClick={handleCancelDelete} disabled={isDeleting}>
                Cancelar
              </button_1.default>
              <button_1.default variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
                {isDeleting ? (<>
                    <lucide_react_1.RefreshCw className="w-4 h-4 mr-2 animate-spin"/>
                    Eliminando...
                  </>) : (<>
                    <lucide_react_1.Trash2 className="w-4 h-4 mr-2"/>
                    Eliminar
                  </>)}
              </button_1.default>
            </div>
          </div>
        </div>)}
    </div>);
}
//# sourceMappingURL=page.js.map