'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Edit2, Trash2, RefreshCw, Filter, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import DataTable from '@/components/ui/data-table';
import DeployableModal from '@/components/DeployableModal';
import DeployableStatusBadge from '@/components/DeployableStatusBadge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { deployableService } from '@/services/deployable-service';
import { departmentService } from '@/services/department-service';
import {
  Deployable,
  DeployablePayload,
  DeployableKind,
  DeployableStatus,
  DepartmentRef,
} from '@/lib/types';

const KINDS: DeployableKind[] = ['agent', 'app'];
const STATUSES: DeployableStatus[] = ['pending', 'starting', 'running', 'stopped', 'error'];

export default function DeployablesPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [deployables, setDeployables] = useState<Deployable[]>([]);
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Deployable | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleting, setDeleting] = useState<Deployable | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [showFilters, setShowFilters] = useState(false);

  const fetchDeployables = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const res = await deployableService.list({
        page,
        limit,
        search: search || undefined,
        kind: kindFilter || undefined,
        status: statusFilter || undefined,
        departmentId: departmentFilter || undefined,
      });
      setDeployables(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al cargar deployables';
      setError(message);
      setDeployables([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search, kindFilter, statusFilter, departmentFilter, user, authLoading, router]);

  useEffect(() => {
    fetchDeployables();
  }, [fetchDeployables]);

  // Departamentos para el filtro y el modal (best-effort; no bloquea la página).
  useEffect(() => {
    if (authLoading || !user) return;
    departmentService
      .list()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [authLoading, user]);

  const departmentName = useCallback(
    (d: Deployable): string => {
      if (d.department?.name) return d.department.name;
      if (!d.departmentId) return '-';
      return departments.find((dep) => dep.id === d.departmentId)?.name ?? '—';
    },
    [departments],
  );

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setPage(1);
      setSearch(searchInput);
    },
    [searchInput],
  );

  const handleClearFilters = useCallback(() => {
    setKindFilter('');
    setStatusFilter('');
    setDepartmentFilter('');
    setSearchInput('');
    setSearch('');
    setPage(1);
  }, []);

  const handleOpenCreate = useCallback(() => {
    setEditing(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((d: Deployable) => {
    setEditing(d);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditing(null);
  }, []);

  const handleSubmit = useCallback(
    async (payload: DeployablePayload) => {
      setIsSubmitting(true);
      try {
        if (editing) {
          await deployableService.update(editing.id, payload);
        } else {
          await deployableService.create(payload);
        }
        handleCloseModal();
        await fetchDeployables();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al guardar deployable';
        throw new Error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [editing, fetchDeployables, handleCloseModal],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await deployableService.remove(deleting.id);
      setDeleting(null);
      await fetchDeployables();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al eliminar deployable';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, fetchDeployables]);

  const activeFilterCount =
    (kindFilter ? 1 : 0) + (statusFilter ? 1 : 0) + (departmentFilter ? 1 : 0);

  const columns = [
    {
      key: 'name',
      header: 'Nombre',
      render: (d: Deployable) => (
        <span className="font-medium text-gray-900 dark:text-white">{d.name}</span>
      ),
    },
    {
      key: 'kind',
      header: 'Tipo',
      render: (d: Deployable) => (
        <span
          className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
            d.kind === 'agent'
              ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
              : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
          }`}
        >
          {d.kind}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Estado',
      render: (d: Deployable) => <DeployableStatusBadge status={d.status} />,
    },
    {
      key: 'department',
      header: 'Departamento',
      render: (d: Deployable) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">{departmentName(d)}</span>
      ),
    },
    {
      key: 'detail',
      header: 'Modelo / Framework',
      render: (d: Deployable) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">
          {d.kind === 'agent' ? d.model || '-' : d.framework || '-'}
        </span>
      ),
    },
    {
      key: 'runtime',
      header: 'Runtime',
      render: (d: Deployable) => (
        <span className="text-sm text-gray-500 dark:text-gray-400">{d.runtime}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (d: Deployable) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => handleOpenEdit(d)}
            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Editar deployable"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDeleting(d)}
            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Eliminar deployable"
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

  if (!user) return null;

  const selectClass =
    'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Deployables</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Agentes y apps desplegables del ecosistema
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="w-4 h-4 mr-2" />
            Filtros
            {activeFilterCount > 0 && (
              <span className="ml-1 inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-600 rounded-full">
                {activeFilterCount}
              </span>
            )}
          </Button>
          <Button variant="outline" size="sm" onClick={fetchDeployables} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Deployable
          </Button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <Card className="p-4">
          <div className="flex flex-col sm:flex-row gap-4">
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
              </div>
            </form>

            <div className="flex-1">
              <select
                value={kindFilter}
                onChange={(e) => {
                  setKindFilter(e.target.value);
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">Todos los tipos</option>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k.charAt(0).toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <select
                value={statusFilter}
                onChange={(e) => {
                  setStatusFilter(e.target.value);
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">Todos los estados</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex-1">
              <select
                value={departmentFilter}
                onChange={(e) => {
                  setDepartmentFilter(e.target.value);
                  setPage(1);
                }}
                className={selectClass}
              >
                <option value="">Todos los departamentos</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {(activeFilterCount > 0 || search) && (
              <div className="flex items-end">
                <Button variant="ghost" size="sm" onClick={handleClearFilters}>
                  <X className="w-4 h-4 mr-1" />
                  Limpiar
                </Button>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <X className="w-5 h-5 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : deployables.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              {search || activeFilterCount > 0
                ? 'No se encontraron deployables con los filtros aplicados'
                : 'No hay deployables creados aún'}
            </p>
            {!search && activeFilterCount === 0 && (
              <Button variant="outline" className="mt-4" onClick={handleOpenCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Crear primer deployable
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={deployables}
            page={page}
            limit={limit}
            totalPages={totalPages}
            total={total}
            onPageChange={setPage}
            keyExtractor={(d) => d.id}
          />
        )}
      </Card>

      {/* Create/Edit Modal */}
      {isModalOpen && (
        <DeployableModal
          deployable={editing}
          departments={departments}
          onClose={handleCloseModal}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Eliminar deployable
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Estás seguro de que deseas eliminar{' '}
              <span className="font-medium text-gray-900 dark:text-white">{deleting.name}</span>?
              Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={() => setDeleting(null)} disabled={isDeleting}>
                Cancelar
              </Button>
              <Button variant="danger" onClick={handleConfirmDelete} disabled={isDeleting}>
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
