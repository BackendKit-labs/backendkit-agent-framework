'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Edit2, Trash2, RefreshCw, Filter, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import DataTable from '@/components/ui/data-table';
import AgentModal from '@/components/AgentModal';
import AgentStatusBadge from '@/components/AgentStatusBadge';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';
import Card from '@/components/ui/card';
import { api } from '@/lib/api';

interface Agent {
  id: string;
  name: string;
  description?: string;
  type: 'chat' | 'task' | 'monitor' | 'custom';
  status: 'idle' | 'active' | 'error' | 'stopped';
  config?: Record<string, unknown>;
  projectId?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface AgentFormData {
  name: string;
  description?: string;
  type: string;
  config?: Record<string, unknown>;
  projectId?: string;
  model?: string;
  status?: string;
}

const AGENT_TYPES = ['chat', 'task', 'monitor', 'custom'] as const;
const AGENT_STATUSES = ['idle', 'active', 'error', 'stopped'] as const;

export default function AgentsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  // State
  const [agents, setAgents] = useState<Agent[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<Agent | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Delete confirmation
  const [deletingAgent, setDeletingAgent] = useState<Agent | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Filter visibility
  const [showFilters, setShowFilters] = useState(false);

  const fetchAgents = useCallback(async () => {
    if (authLoading) return;
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
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      if (statusFilter) params.set('status', statusFilter);

      const response = await api.get<PaginatedResponse<Agent>>(`/api/agents?${params.toString()}`);
      setAgents(response.data.data);
      setTotal(response.data.total);
      setTotalPages(response.data.totalPages);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al cargar agentes';
      setError(message);
      setAgents([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search, typeFilter, statusFilter, user, authLoading, router]);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput);
  }, [searchInput]);

  const handleClearSearch = useCallback(() => {
    setSearchInput('');
    setSearch('');
    setPage(1);
  }, []);

  const handleTypeFilterChange = useCallback((type: string) => {
    setTypeFilter(type);
    setPage(1);
  }, []);

  const handleStatusFilterChange = useCallback((status: string) => {
    setStatusFilter(status);
    setPage(1);
  }, []);

  const handleClearFilters = useCallback(() => {
    setTypeFilter('');
    setStatusFilter('');
    setSearchInput('');
    setSearch('');
    setPage(1);
  }, []);

  const handleOpenCreate = useCallback(() => {
    setEditingAgent(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((agent: Agent) => {
    setEditingAgent(agent);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditingAgent(null);
  }, []);

  const handleSubmit = useCallback(async (data: AgentFormData) => {
    setIsSubmitting(true);
    try {
      if (editingAgent) {
        await api.patch(`/api/agents/${editingAgent.id}`, data);
      } else {
        await api.post('/api/agents', data);
      }
      handleCloseModal();
      await fetchAgents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al guardar agente';
      throw new Error(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [editingAgent, fetchAgents, handleCloseModal]);

  const handleDeleteClick = useCallback((agent: Agent) => {
    setDeletingAgent(agent);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!deletingAgent) return;
    setIsDeleting(true);
    try {
      await api.delete(`/api/agents/${deletingAgent.id}`);
      setDeletingAgent(null);
      await fetchAgents();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al eliminar agente';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }, [deletingAgent, fetchAgents]);

  const handleCancelDelete = useCallback(() => {
    setDeletingAgent(null);
  }, []);

  const handlePageChange = useCallback((newPage: number) => {
    setPage(newPage);
  }, []);

  const columns = [
    {
      key: 'name',
      header: 'Nombre',
      render: (agent: Agent) => (
        <span className="font-medium text-gray-900 dark:text-white">
          {agent.name}
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Tipo',
      render: (agent: Agent) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
          {agent.type}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (agent: Agent) => <AgentStatusBadge status={agent.status} />,
    },
    {
      key: 'projectId',
      header: 'Proyecto',
      render: (agent: Agent) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {agent.projectId ? agent.projectId.substring(0, 8) + '...' : '-'}
        </span>
      ),
    },
    {
      key: 'model',
      header: 'Modelo',
      render: (agent: Agent) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {agent.model || '-'}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Creado',
      render: (agent: Agent) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {new Date(agent.createdAt).toLocaleDateString('es-ES', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          })}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (agent: Agent) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenEdit(agent)}
            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Editar agente"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleDeleteClick(agent)}
            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Eliminar agente"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
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
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-4 h-4 mr-2" />
            Filtros
            {(typeFilter || statusFilter) && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-600 rounded-full">
                {(typeFilter ? 1 : 0) + (statusFilter ? 1 : 0)}
              </span>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchAgents}
            disabled={isLoading}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Agente
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
            {/* Search */}
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Buscar por nombre..."
                  className="w-full pl-10 pr-10 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                />
                {searchInput && (
                  <button
                    type="button"
                    onClick={() => setSearchInput('')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </form>

            {/* Type filter */}
            <div className="flex-1">
              <select
                value={typeFilter}
                onChange={(e) => handleTypeFilterChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todos los tipos</option>
                {AGENT_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Status filter */}
            <div className="flex-1">
              <select
                value={statusFilter}
                onChange={(e) => handleStatusFilterChange(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              >
                <option value="">Todos los estados</option>
                {AGENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.charAt(0).toUpperCase() + status.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            {/* Clear filters */}
            {(typeFilter || statusFilter || search) && (
              <div className="flex items-end">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFilters}
                >
                  <X className="w-4 h-4 mr-1" />
                  Limpiar
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Error message */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <X className="w-5 h-5 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Agents table */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : agents.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              {search || typeFilter || statusFilter
                ? 'No se encontraron agentes con los filtros aplicados'
                : 'No hay agentes creados aún'}
            </p>
            {!search && !typeFilter && !statusFilter && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={handleOpenCreate}
              >
                <Plus className="w-4 h-4 mr-2" />
                Crear primer agente
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={agents}
            page={page}
            totalPages={totalPages}
            total={total}
            onPageChange={handlePageChange}
          />
        )}
      </Card>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <AgentModal
          agent={editingAgent}
          onClose={handleCloseModal}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Delete Confirmation Modal */}
      {deletingAgent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
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
              <Button
                variant="outline"
                onClick={handleCancelDelete}
                disabled={isDeleting}
              >
                Cancelar
              </Button>
              <Button
                variant="danger"
                onClick={handleConfirmDelete}
                disabled={isDeleting}
              >
                {isDeleting ? (
                  <>
                    <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    Eliminando...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4 mr-2" />
                    Eliminar
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}