'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Deployable,
  DeployablePayload,
  DeployableKind,
  DeployableRuntime,
  AppFramework,
  DepartmentRef,
} from '@/lib/types';

interface DeployableFormData {
  name: string;
  description: string;
  kind: DeployableKind;
  departmentId: string;
  catalogKey: string;
  image: string;
  runtime: DeployableRuntime;
  model: string;
  mcpPort: string;
  publicPort: string;
  publicUrl: string;
  framework: AppFramework | '';
}

// Valores prellenados al crear desde una entrada de catálogo.
export interface DeployableTemplateDefaults {
  kind?: DeployableKind;
  catalogKey?: string;
  image?: string;
  model?: string;
  runtime?: DeployableRuntime;
  framework?: AppFramework;
  name?: string;
}

interface DeployableModalProps {
  deployable?: Deployable | null;
  departments?: DepartmentRef[];
  templateDefaults?: DeployableTemplateDefaults;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: DeployablePayload) => Promise<void>;
}

const initialFormData: DeployableFormData = {
  name: '',
  description: '',
  kind: 'agent',
  departmentId: '',
  catalogKey: '',
  image: '',
  runtime: 'docker',
  model: '',
  mcpPort: '',
  publicPort: '',
  publicUrl: '',
  framework: '',
};

const KINDS: { value: DeployableKind; label: string }[] = [
  { value: 'agent', label: 'Agent' },
  { value: 'app', label: 'App' },
];

const RUNTIMES: { value: DeployableRuntime; label: string }[] = [
  { value: 'docker', label: 'Docker' },
  { value: 'k8s', label: 'Kubernetes' },
  { value: 'process', label: 'Process' },
];

const FRAMEWORKS: { value: AppFramework; label: string }[] = [
  { value: 'nextjs', label: 'Next.js' },
  { value: 'fastapi', label: 'FastAPI' },
  { value: 'express', label: 'Express' },
  { value: 'custom', label: 'Custom' },
];

export default function DeployableModal({
  deployable,
  departments = [],
  templateDefaults,
  isSubmitting = false,
  onClose,
  onSubmit,
}: DeployableModalProps) {
  const [formData, setFormData] = useState<DeployableFormData>(initialFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof DeployableFormData, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!deployable;

  const resetForm = useCallback(() => {
    if (deployable) {
      setFormData({
        name: deployable.name || '',
        description: deployable.description || '',
        kind: deployable.kind || 'agent',
        departmentId: deployable.departmentId || '',
        catalogKey: deployable.catalogKey || '',
        image: deployable.image || '',
        runtime: deployable.runtime || 'docker',
        model: deployable.model || '',
        mcpPort: deployable.mcpPort != null ? String(deployable.mcpPort) : '',
        publicPort: deployable.publicPort != null ? String(deployable.publicPort) : '',
        publicUrl: deployable.publicUrl || '',
        framework: deployable.framework || '',
      });
    } else {
      setFormData({
        ...initialFormData,
        name: templateDefaults?.name ?? '',
        kind: templateDefaults?.kind ?? initialFormData.kind,
        catalogKey: templateDefaults?.catalogKey ?? '',
        image: templateDefaults?.image ?? '',
        runtime: templateDefaults?.runtime ?? initialFormData.runtime,
        model: templateDefaults?.model ?? '',
        framework: templateDefaults?.framework ?? '',
      });
    }
    setErrors({});
    setSubmitError(null);
  }, [deployable, templateDefaults]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const validatePort = (value: string): string | undefined => {
    if (!value) return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      return 'Puerto entre 1024 y 65535';
    }
    return undefined;
  };

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof DeployableFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'El nombre es obligatorio';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Mínimo 2 caracteres';
    }

    const mcpErr = validatePort(formData.mcpPort);
    if (mcpErr) newErrors.mcpPort = mcpErr;
    const publicErr = validatePort(formData.publicPort);
    if (publicErr) newErrors.publicPort = publicErr;

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof DeployableFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);

    const isAgent = formData.kind === 'agent';
    try {
      const payload: DeployablePayload = {
        name: formData.name.trim(),
        description: formData.description || undefined,
        kind: formData.kind,
        departmentId: formData.departmentId || undefined,
        catalogKey: formData.catalogKey || undefined,
        image: formData.image || undefined,
        runtime: formData.runtime,
        // Agent-specific
        model: isAgent ? formData.model || undefined : undefined,
        mcpPort: isAgent && formData.mcpPort ? Number(formData.mcpPort) : undefined,
        // App-specific
        publicPort: !isAgent && formData.publicPort ? Number(formData.publicPort) : undefined,
        publicUrl: !isAgent ? formData.publicUrl || undefined : undefined,
        framework: !isAgent && formData.framework ? formData.framework : undefined,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el deployable');
    }
  };

  const isAgent = formData.kind === 'agent';
  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 my-8 bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Editar Deployable' : 'Nuevo Deployable'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Name */}
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
              placeholder="Nombre del deployable"
              error={errors.name}
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            />
          </div>

          {/* Kind + Runtime */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="kind" className="block text-sm font-medium text-gray-700 mb-1">
                Tipo
              </label>
              <select
                id="kind"
                name="kind"
                value={formData.kind}
                onChange={handleChange}
                disabled={isSubmitting || isEditing}
                className={selectClass}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="runtime" className="block text-sm font-medium text-gray-700 mb-1">
                Runtime
              </label>
              <select
                id="runtime"
                name="runtime"
                value={formData.runtime}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                {RUNTIMES.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Department */}
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

          {/* Catalog key + Image */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="catalogKey" className="block text-sm font-medium text-gray-700 mb-1">
                Catalog key
              </label>
              <Input
                id="catalogKey"
                name="catalogKey"
                type="text"
                value={formData.catalogKey}
                onChange={handleChange}
                placeholder="ej. hr-onboarding"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-1">
                Imagen (override)
              </label>
              <Input
                id="image"
                name="image"
                type="text"
                value={formData.image}
                onChange={handleChange}
                placeholder="ej. ghcr.io/org/img:tag"
                disabled={isSubmitting}
              />
            </div>
          </div>

          {/* Agent-specific */}
          {isAgent && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
                  Modelo
                </label>
                <Input
                  id="model"
                  name="model"
                  type="text"
                  value={formData.model}
                  onChange={handleChange}
                  placeholder="ej. claude-opus-4-8"
                  disabled={isSubmitting}
                />
              </div>
              <div>
                <label htmlFor="mcpPort" className="block text-sm font-medium text-gray-700 mb-1">
                  MCP port
                </label>
                <Input
                  id="mcpPort"
                  name="mcpPort"
                  type="number"
                  value={formData.mcpPort}
                  onChange={handleChange}
                  placeholder="1024-65535"
                  error={errors.mcpPort}
                  disabled={isSubmitting}
                />
              </div>
            </div>
          )}

          {/* App-specific */}
          {!isAgent && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="framework" className="block text-sm font-medium text-gray-700 mb-1">
                    Framework
                  </label>
                  <select
                    id="framework"
                    name="framework"
                    value={formData.framework}
                    onChange={handleChange}
                    disabled={isSubmitting}
                    className={selectClass}
                  >
                    <option value="">Sin especificar</option>
                    {FRAMEWORKS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="publicPort" className="block text-sm font-medium text-gray-700 mb-1">
                    Public port
                  </label>
                  <Input
                    id="publicPort"
                    name="publicPort"
                    type="number"
                    value={formData.publicPort}
                    onChange={handleChange}
                    placeholder="1024-65535"
                    error={errors.publicPort}
                    disabled={isSubmitting}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="publicUrl" className="block text-sm font-medium text-gray-700 mb-1">
                  Public URL
                </label>
                <Input
                  id="publicUrl"
                  name="publicUrl"
                  type="text"
                  value={formData.publicUrl}
                  onChange={handleChange}
                  placeholder="https://..."
                  disabled={isSubmitting}
                />
              </div>
            </>
          )}

          {/* Submit error */}
          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{submitError}</p>
            </div>
          )}

          {/* Actions */}
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
                'Crear Deployable'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
