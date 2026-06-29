'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, RefreshCw, Edit2, Trash2, History, Workflow as WorkflowIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import WorkflowModal from '@/components/WorkflowModal';
import WorkflowRunsModal from '@/components/WorkflowRunsModal';
import { workflowService } from '@/services/workflow-service';
import { departmentService } from '@/services/department-service';
import { deployableService } from '@/services/deployable-service';
import {
  Workflow,
  WorkflowPayload,
  WorkflowStatus,
  Deployable,
  DepartmentRef,
} from '@/lib/types';

const STATUSES: WorkflowStatus[] = ['draft', 'active', 'paused'];

const STATUS_STYLES: Record<WorkflowStatus, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200',
  active: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  paused: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
};

export default function WorkflowsPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);
  const [deployables, setDeployables] = useState<Deployable[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Workflow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [deleting, setDeleting] = useState<Workflow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [runsFor, setRunsFor] = useState<Workflow | null>(null);

  const fetchWorkflows = useCallback(async () => {
    if (authLoading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      setWorkflows(
        await workflowService.list({
          status: statusFilter || undefined,
          departmentId: departmentFilter || undefined,
        }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al cargar workflows');
      setWorkflows([]);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, departmentFilter, user, authLoading, router]);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  // Departamentos y deployables para los selects del modal (best-effort).
  useEffect(() => {
    if (authLoading || !user) return;
    departmentService.list().then(setDepartments).catch(() => setDepartments([]));
    deployableService
      .list({ limit: 100 })
      .then((res) => setDeployables(res.data))
      .catch(() => setDeployables([]));
  }, [authLoading, user]);

  const departmentName = useCallback(
    (id?: string | null): string => {
      if (!id) return '-';
      return departments.find((d) => d.id === id)?.name ?? '—';
    },
    [departments],
  );

  const handleSubmit = useCallback(
    async (payload: WorkflowPayload) => {
      setIsSubmitting(true);
      try {
        if (editing) {
          await workflowService.update(editing.id, payload);
        } else {
          await workflowService.create(payload);
        }
        setIsModalOpen(false);
        setEditing(null);
        await fetchWorkflows();
      } catch (err: unknown) {
        throw new Error(err instanceof Error ? err.message : 'Error al guardar el workflow');
      } finally {
        setIsSubmitting(false);
      }
    },
    [editing, fetchWorkflows],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await workflowService.remove(deleting.id);
      setDeleting(null);
      await fetchWorkflows();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el workflow');
    } finally {
      setIsDeleting(false);
    }
  }, [deleting, fetchWorkflows]);

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    );
  }

  if (!user) return null;

  const selectClass =
    'px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Workflows</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Pipelines multi-step asociados a un departamento
          </p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">Todos los estados</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className={selectClass}
          >
            <option value="">Todos los departamentos</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={fetchWorkflows} disabled={isLoading}>
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
            Nuevo Workflow
          </Button>
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
        </div>
      ) : workflows.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <WorkflowIcon className="mx-auto h-10 w-10 text-gray-300" />
            <p className="mt-3 text-gray-500 dark:text-gray-400">
              {statusFilter || departmentFilter
                ? 'No hay workflows con los filtros aplicados'
                : 'No hay workflows creados aún'}
            </p>
            {!statusFilter && !departmentFilter && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setEditing(null);
                  setIsModalOpen(true);
                }}
              >
                <Plus className="w-4 h-4 mr-2" />
                Crear primer workflow
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workflows.map((wf) => (
            <Card key={wf.id} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-semibold text-gray-900 dark:text-white truncate">{wf.name}</h3>
                <span
                  className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[wf.status]}`}
                >
                  {wf.status}
                </span>
              </div>

              {wf.description && (
                <p className="mt-2 text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                  {wf.description}
                </p>
              )}

              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
                <span>
                  Trigger: <span className="font-medium">{wf.trigger}</span>
                </span>
                <span>
                  Steps: <span className="font-medium">{wf.steps?.length ?? 0}</span>
                </span>
                <span>
                  Depto: <span className="font-medium">{departmentName(wf.departmentId)}</span>
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-gray-100 dark:border-gray-700">
                <Button size="sm" variant="outline" onClick={() => setRunsFor(wf)}>
                  <History className="h-4 w-4 mr-2" />
                  Ejecuciones
                </Button>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setEditing(wf);
                      setIsModalOpen(true);
                    }}
                    className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Editar workflow"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setDeleting(wf)}
                    className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                    title="Eliminar workflow"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {isModalOpen && (
        <WorkflowModal
          workflow={editing}
          deployables={deployables}
          departments={departments}
          isSubmitting={isSubmitting}
          onClose={() => {
            setIsModalOpen(false);
            setEditing(null);
          }}
          onSubmit={handleSubmit}
        />
      )}

      {/* Runs modal */}
      {runsFor && <WorkflowRunsModal workflow={runsFor} onClose={() => setRunsFor(null)} />}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl max-w-md w-full p-6">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Eliminar workflow
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
              ¿Eliminar{' '}
              <span className="font-medium text-gray-900 dark:text-white">{deleting.name}</span>? Se
              eliminarán también sus steps y ejecuciones. Esta acción no se puede deshacer.
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
