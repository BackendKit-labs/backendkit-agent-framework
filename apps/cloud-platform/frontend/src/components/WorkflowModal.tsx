'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Workflow,
  WorkflowPayload,
  WorkflowStatus,
  WorkflowTrigger,
  Deployable,
  DepartmentRef,
} from '@/lib/types';

interface StepRow {
  deployableId: string;
  config: string; // JSON
}

interface WorkflowFormData {
  name: string;
  description: string;
  status: WorkflowStatus;
  trigger: WorkflowTrigger;
  departmentId: string;
}

interface WorkflowModalProps {
  workflow?: Workflow | null;
  deployables?: Deployable[];
  departments?: DepartmentRef[];
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: WorkflowPayload) => Promise<void>;
}

const STATUSES: WorkflowStatus[] = ['draft', 'active', 'paused'];
const TRIGGERS: WorkflowTrigger[] = ['manual', 'webhook', 'scheduled'];

const initialFormData: WorkflowFormData = {
  name: '',
  description: '',
  status: 'draft',
  trigger: 'manual',
  departmentId: '',
};

export default function WorkflowModal({
  workflow,
  deployables = [],
  departments = [],
  isSubmitting = false,
  onClose,
  onSubmit,
}: WorkflowModalProps) {
  const [formData, setFormData] = useState<WorkflowFormData>(initialFormData);
  const [steps, setSteps] = useState<StepRow[]>([]);
  const [errors, setErrors] = useState<Partial<Record<keyof WorkflowFormData, string>>>({});
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!workflow;

  const resetForm = useCallback(() => {
    if (workflow) {
      setFormData({
        name: workflow.name || '',
        description: workflow.description || '',
        status: workflow.status || 'draft',
        trigger: workflow.trigger || 'manual',
        departmentId: workflow.departmentId || '',
      });
      setSteps(
        [...(workflow.steps ?? [])]
          .sort((a, b) => a.order - b.order)
          .map((s) => ({
            deployableId: s.deployableId || '',
            config: s.config ? JSON.stringify(s.config, null, 2) : '',
          })),
      );
    } else {
      setFormData(initialFormData);
      setSteps([]);
    }
    setErrors({});
    setStepError(null);
    setSubmitError(null);
  }, [workflow]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof WorkflowFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const addStep = () => setSteps((prev) => [...prev, { deployableId: '', config: '' }]);
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i));
  const updateStep = (i: number, patch: Partial<StepRow>) =>
    setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, dir: -1 | 1) =>
    setSteps((prev) => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Partial<Record<keyof WorkflowFormData, string>> = {};
    if (!formData.name.trim()) newErrors.name = 'El nombre es obligatorio';
    setErrors(newErrors);
    if (Object.keys(newErrors).length) return;

    // Validar y construir steps (order 1-based según posición).
    setStepError(null);
    const builtSteps = [];
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      let config: Record<string, unknown> | undefined;
      if (s.config.trim()) {
        try {
          const parsed = JSON.parse(s.config);
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            setStepError(`Step ${i + 1}: config debe ser un objeto JSON`);
            return;
          }
          config = parsed;
        } catch {
          setStepError(`Step ${i + 1}: config no es JSON válido`);
          return;
        }
      }
      builtSteps.push({
        order: i + 1,
        deployableId: s.deployableId || undefined,
        config,
      });
    }

    setSubmitError(null);
    try {
      const payload: WorkflowPayload = {
        name: formData.name.trim(),
        description: formData.description || undefined,
        status: formData.status,
        trigger: formData.trigger,
        departmentId: formData.departmentId || undefined,
        steps: builtSteps,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el workflow');
    }
  };

  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-2xl mx-4 my-8 bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Editar Workflow' : 'Nuevo Workflow'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Nombre <span className="text-red-500">*</span>
            </label>
            <Input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              placeholder="Pipeline de onboarding"
              error={errors.name}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Descripción
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Descripción (opcional)"
              rows={2}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 resize-none"
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
                Estado
              </label>
              <select
                id="status"
                name="status"
                value={formData.status}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="trigger" className="block text-sm font-medium text-gray-700 mb-1">
                Trigger
              </label>
              <select
                id="trigger"
                name="trigger"
                value={formData.trigger}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                {TRIGGERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="departmentId" className="block text-sm font-medium text-gray-700 mb-1">
                Departamento
              </label>
              <select
                id="departmentId"
                name="departmentId"
                value={formData.departmentId}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                <option value="">Sin departamento</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Steps builder */}
          <div className="rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-gray-700">Steps</h3>
              <Button type="button" variant="outline" size="sm" onClick={addStep} disabled={isSubmitting}>
                <Plus className="w-4 h-4 mr-1" />
                Añadir step
              </Button>
            </div>

            {steps.length === 0 ? (
              <p className="text-sm text-gray-400 py-2">
                Sin steps. El orden de ejecución sigue la posición en la lista.
              </p>
            ) : (
              <ul className="space-y-3">
                {steps.map((step, i) => (
                  <li key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-semibold text-gray-600">
                        {i + 1}
                      </span>
                      <div className="flex-1 space-y-2">
                        <select
                          value={step.deployableId}
                          onChange={(e) => updateStep(i, { deployableId: e.target.value })}
                          disabled={isSubmitting}
                          className={selectClass}
                        >
                          <option value="">Sin deployable (placeholder)</option>
                          {deployables.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.name} ({d.kind})
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={step.config}
                          onChange={(e) => updateStep(i, { config: e.target.value })}
                          placeholder='Config JSON (opcional) — {"timeout": 30}'
                          rows={2}
                          disabled={isSubmitting}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 resize-none"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => moveStep(i, -1)}
                          disabled={i === 0 || isSubmitting}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Subir"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moveStep(i, 1)}
                          disabled={i === steps.length - 1 || isSubmitting}
                          className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30"
                          title="Bajar"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeStep(i)}
                          disabled={isSubmitting}
                          className="p-1 text-gray-400 hover:text-red-600"
                          title="Eliminar step"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {stepError && <p className="mt-2 text-xs text-red-500">{stepError}</p>}
          </div>

          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{submitError}</p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancelar
            </Button>
            <Button type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEditing ? 'Guardando...' : 'Creando...'}
                </span>
              ) : isEditing ? (
                'Guardar cambios'
              ) : (
                'Crear Workflow'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
