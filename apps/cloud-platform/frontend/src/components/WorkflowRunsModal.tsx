'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Play, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { workflowService } from '@/services/workflow-service';
import { Workflow, WorkflowRun, WorkflowRunStatus } from '@/lib/types';

interface WorkflowRunsModalProps {
  workflow: Workflow;
  onClose: () => void;
}

const RUN_STATUS_STYLES: Record<WorkflowRunStatus, string> = {
  pending: 'bg-blue-100 text-blue-800',
  running: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-gray-100 text-gray-800',
};

export default function WorkflowRunsModal({ workflow, onClose }: WorkflowRunsModalProps) {
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showInput, setShowInput] = useState(false);
  const [inputJson, setInputJson] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const loadRuns = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRuns(await workflowService.listRuns(workflow.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar las ejecuciones');
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [workflow.id]);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const handleRun = async () => {
    let input: Record<string, unknown> | undefined;
    if (inputJson.trim()) {
      try {
        const parsed = JSON.parse(inputJson);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          setInputError('El input debe ser un objeto JSON');
          return;
        }
        input = parsed;
      } catch {
        setInputError('El input no es JSON válido');
        return;
      }
    }
    setInputError(null);
    setIsRunning(true);
    setError(null);
    try {
      await workflowService.run(workflow.id, input);
      setInputJson('');
      setShowInput(false);
      await loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al lanzar la ejecución');
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="relative w-full max-w-xl bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Ejecuciones</h2>
            <p className="text-sm text-gray-500">{workflow.name}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button size="sm" onClick={() => setShowInput((v) => !v)} disabled={isRunning}>
              <Play className="w-4 h-4 mr-2" />
              Nueva ejecución
            </Button>
          </div>

          {showInput && (
            <div className="rounded-lg border border-gray-200 p-3 space-y-2">
              <label className="block text-sm font-medium text-gray-700">Input (JSON, opcional)</label>
              <textarea
                value={inputJson}
                onChange={(e) => {
                  setInputJson(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder='{"key": "value"}'
                rows={3}
                disabled={isRunning}
                className={`w-full px-3 py-2 border rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${
                  inputError ? 'border-red-500' : 'border-gray-300'
                }`}
              />
              {inputError && <p className="text-xs text-red-500">{inputError}</p>}
              <div className="flex justify-end">
                <Button size="sm" onClick={handleRun} disabled={isRunning}>
                  {isRunning ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Lanzando...
                    </span>
                  ) : (
                    'Lanzar'
                  )}
                </Button>
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              No hay ejecuciones todavía.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
              {runs.map((run) => (
                <li key={run.id} className="flex items-center justify-between px-4 py-3">
                  <div className="min-w-0">
                    <p className="font-mono text-xs text-gray-700 truncate">{run.id.slice(0, 8)}…</p>
                    <p className="text-xs text-gray-400">
                      {new Date(run.startedAt || run.createdAt).toLocaleString()}
                    </p>
                    {run.error && <p className="text-xs text-red-500 truncate">{run.error}</p>}
                  </div>
                  <span
                    className={`shrink-0 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                      RUN_STATUS_STYLES[run.status] ?? 'bg-gray-100 text-gray-800'
                    }`}
                  >
                    {run.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-gray-400">
            La ejecución de los steps la realiza un orquestador externo; aquí se registra y consulta
            el estado de cada run.
          </p>
        </div>
      </div>
    </div>
  );
}
