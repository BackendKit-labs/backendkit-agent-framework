'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Edit2, Trash2, Rocket, KeyRound, Package } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import CatalogModal from '@/components/CatalogModal';
import DeployableModal, { DeployableTemplateDefaults } from '@/components/DeployableModal';
import { catalogService } from '@/services/catalog-service';
import { departmentService } from '@/services/department-service';
import { deployableService } from '@/services/deployable-service';
import {
  CatalogEntry,
  CatalogEntryPayload,
  DeployablePayload,
  DepartmentRef,
} from '@/lib/types';

export default function CatalogPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [entries, setEntries] = useState<CatalogEntry[]>([]);
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Catalog CRUD modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleting, setDeleting] = useState<CatalogEntry | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Deploy-from-template modal
  const [templateDefaults, setTemplateDefaults] = useState<DeployableTemplateDefaults | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  const fetchEntries = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setEntries(await catalogService.list());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar el catálogo');
      setEntries([]);
    } finally {
      setIsLoading(false);
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    if (authLoading || !user) return;
    departmentService
      .list()
      .then(setDepartments)
      .catch(() => setDepartments([]));
  }, [authLoading, user]);

  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const grouped = useMemo(() => {
    const map = new Map<string, CatalogEntry[]>();
    for (const e of entries) {
      const list = map.get(e.category) ?? [];
      list.push(e);
      map.set(e.category, list);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [entries]);

  const handleSubmit = useCallback(
    async (payload: CatalogEntryPayload) => {
      setIsSubmitting(true);
      try {
        if (editing) {
          await catalogService.update(editing.id, payload);
        } else {
          await catalogService.create(payload);
        }
        setIsModalOpen(false);
        setEditing(null);
        await fetchEntries();
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Error al guardar el template');
      } finally {
        setIsSubmitting(false);
      }
    },
    [editing, fetchEntries],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await catalogService.remove(deleting.id);
      setDeleting(null);
      await fetchEntries();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el template');
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, fetchEntries]);

  // Crea un Deployable a partir del template (el director resuelve imagen/env al desplegar).
  const handleDeployFromTemplate = useCallback(
    async (payload: DeployablePayload) => {
      setIsDeploying(true);
      try {
        const created = await deployableService.create(payload);
        setTemplateDefaults(null);
        setSuccessMessage(
          `Deployable "${created.name}" creado. Desplegalo desde el panel Director.`,
        );
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Error al crear el deployable');
      } finally {
        setIsDeploying(false);
      }
    },
    [],
  );

  const openTemplate = useCallback((entry: CatalogEntry) => {
    setTemplateDefaults({
      kind: entry.kind,
      catalogKey: entry.key,
      runtime: entry.runtime,
      model: entry.defaultModel ?? undefined,
      name: entry.displayName,
    });
  }, []);

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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Catálogo</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Templates reutilizables para crear deployables
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={fetchEntries} disabled={isLoading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            Actualizar
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setIsModalOpen(true);
            }}
          >
            <Plus className="w-4 h-4 mr-2" />
            Nuevo Template
          </Button>
        </div>
      </div>

      {successMessage && (
        <div className="rounded-md bg-green-50 dark:bg-green-900/20 p-4 border border-green-200 dark:border-green-800">
          <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
        </div>
      )}
      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : entries.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <Package className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-gray-500 dark:text-gray-400">
              No hay templates en el catálogo aún
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => {
                setEditing(null);
                setIsModalOpen(true);
              }}
            >
              <Plus className="w-4 h-4 mr-2" />
              Crear primer template
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-8">
          {grouped.map(([category, items]) => (
            <div key={category}>
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                {category}
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {items.map((entry) => (
                  <Card key={entry.id} className="flex flex-col p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                          {entry.displayName}
                        </h3>
                        <p className="font-mono text-xs text-gray-400 truncate">{entry.key}</p>
                      </div>
                      <span
                        className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          entry.kind === 'agent'
                            ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200'
                            : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'
                        }`}
                      >
                        {entry.kind}
                      </span>
                    </div>

                    {entry.description && (
                      <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                        {entry.description}
                      </p>
                    )}

                    <p className="mt-2 font-mono text-xs text-gray-400 truncate" title={entry.image}>
                      {entry.image}
                    </p>

                    {entry.requiredSecrets && entry.requiredSecrets.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-1">
                        {entry.requiredSecrets.map((s) => (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-mono text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
                          >
                            <KeyRound className="h-3 w-3" />
                            {s}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                      <Button size="sm" onClick={() => openTemplate(entry)}>
                        <Rocket className="h-4 w-4 mr-2" />
                        Usar template
                      </Button>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => {
                            setEditing(entry);
                            setIsModalOpen(true);
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                          title="Editar template"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setDeleting(entry)}
                          className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                          title="Eliminar template"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Catalog CRUD modal */}
      {isModalOpen && (
        <CatalogModal
          entry={editing}
          isSubmitting={isSubmitting}
          onClose={() => {
            setIsModalOpen(false);
            setEditing(null);
          }}
          onSubmit={handleSubmit}
        />
      )}

      {/* Deploy from template (reusa el modal de Deployable) */}
      {templateDefaults && (
        <DeployableModal
          departments={departments}
          templateDefaults={templateDefaults}
          isSubmitting={isDeploying}
          onClose={() => setTemplateDefaults(null)}
          onSubmit={handleDeployFromTemplate}
        />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Eliminar template
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Eliminar{' '}
              <span className="font-medium text-gray-900 dark:text-white">
                {deleting.displayName}
              </span>
              ? Los deployables ya creados con este template no se ven afectados, pero no podrás
              crear nuevos a partir de él.
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
