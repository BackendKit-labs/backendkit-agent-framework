'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Edit2, Trash2, RefreshCw, KeyRound } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import DataTable from '@/components/ui/data-table';
import DepartmentModal from '@/components/DepartmentModal';
import SecretsModal from '@/components/SecretsModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { departmentService } from '@/services/department-service';
import { Department, DepartmentPayload } from '@/lib/types';

export default function DepartmentsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [departments, setDepartments] = useState<Department[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalPages, setTotalPages] = useState(0);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleting, setDeleting] = useState<Department | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [secretsFor, setSecretsFor] = useState<Department | null>(null);

  const fetchDepartments = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await departmentService.paged({ page, limit, search: search || undefined });
      setDepartments(res.data);
      setTotal(res.total);
      setTotalPages(res.totalPages);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al cargar departamentos';
      setError(message);
      setDepartments([]);
      setTotal(0);
      setTotalPages(0);
    } finally {
      setIsLoading(false);
    }
  }, [page, limit, search, user, authLoading, router]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setPage(1);
      setSearch(searchInput);
    },
    [searchInput],
  );

  const handleOpenCreate = useCallback(() => {
    setEditing(null);
    setIsModalOpen(true);
  }, []);

  const handleOpenEdit = useCallback((d: Department) => {
    setEditing(d);
    setIsModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setIsModalOpen(false);
    setEditing(null);
  }, []);

  const handleSubmit = useCallback(
    async (payload: DepartmentPayload) => {
      setIsSubmitting(true);
      try {
        if (editing) {
          await departmentService.update(editing.id, payload);
        } else {
          await departmentService.create(payload);
        }
        handleCloseModal();
        await fetchDepartments();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error al guardar departamento';
        throw new Error(message);
      } finally {
        setIsSubmitting(false);
      }
    },
    [editing, fetchDepartments, handleCloseModal],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await departmentService.remove(deleting.id);
      setDeleting(null);
      await fetchDepartments();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Error al eliminar departamento';
      setError(message);
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, fetchDepartments]);

  const columns = [
    {
      key: 'name',
      header: 'Nombre',
      render: (d: Department) => (
        <div className="flex items-center gap-2">
          {d.color && (
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: d.color }}
            />
          )}
          <span className="font-medium text-gray-900 dark:text-white">
            {d.icon ? `${d.icon} ` : ''}
            {d.name}
          </span>
        </div>
      ),
    },
    {
      key: 'slug',
      header: 'Slug',
      render: (d: Department) => (
        <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{d.slug}</span>
      ),
    },
    {
      key: 'description',
      header: 'Descripción',
      render: (d: Department) => (
        <span className="text-sm text-gray-500 dark:text-gray-400 line-clamp-1">
          {d.description || '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Acciones',
      render: (d: Department) => (
        <div className="flex items-center gap-2">
          <button
            onClick={() => setSecretsFor(d)}
            className="p-1 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
            title="Gestionar secrets"
          >
            <KeyRound className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleOpenEdit(d)}
            className="p-1 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
            title="Editar departamento"
          >
            <Edit2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setDeleting(d)}
            className="p-1 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
            title="Eliminar departamento"
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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Departamentos</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Unidades organizativas que agrupan deployables y almacenan secrets
          </p>
        </div>
        <div className="flex items-center gap-3">
          <form onSubmit={handleSearch} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar..."
              className="w-44 pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </form>
          <Button variant="outline" size="sm" onClick={fetchDepartments} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button onClick={handleOpenCreate}>
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Departamento
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Table */}
      <Card>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          </div>
        ) : departments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500 dark:text-gray-400">
              {search
                ? 'No se encontraron departamentos con esa búsqueda'
                : 'No hay departamentos creados aún'}
            </p>
            {!search && (
              <Button variant="outline" className="mt-4" onClick={handleOpenCreate}>
                <Plus className="w-4 h-4 mr-2" />
                Crear primer departamento
              </Button>
            )}
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={departments}
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
        <DepartmentModal
          department={editing}
          onClose={handleCloseModal}
          onSubmit={handleSubmit}
          isSubmitting={isSubmitting}
        />
      )}

      {/* Secrets Modal */}
      {secretsFor && (
        <SecretsModal department={secretsFor} onClose={() => setSecretsFor(null)} />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Eliminar departamento
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Estás seguro de que deseas eliminar{' '}
              <span className="font-medium text-gray-900 dark:text-white">{deleting.name}</span>?
              Los deployables asociados quedarán sin departamento. Esta acción no se puede deshacer.
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
