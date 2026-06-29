'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  CatalogEntry,
  CatalogEntryPayload,
  DeployableKind,
  DeployableRuntime,
} from '@/lib/types';

interface CatalogFormData {
  key: string;
  displayName: string;
  description: string;
  category: string;
  kind: DeployableKind;
  image: string;
  runtime: DeployableRuntime;
  defaultModel: string;
  command: string; // separado por espacios
  requiredSecrets: string; // separado por comas
  env: string; // JSON
  isPublic: boolean;
}

interface CatalogModalProps {
  entry?: CatalogEntry | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: CatalogEntryPayload) => Promise<void>;
}

const initialFormData: CatalogFormData = {
  key: '',
  displayName: '',
  description: '',
  category: 'custom',
  kind: 'agent',
  image: '',
  runtime: 'docker',
  defaultModel: '',
  command: '',
  requiredSecrets: '',
  env: '',
  isPublic: true,
};

const KINDS: DeployableKind[] = ['agent', 'app'];
const RUNTIMES: DeployableRuntime[] = ['docker', 'k8s', 'process'];
const CATEGORIES = ['dev', 'knowledge', 'hr', 'finance', 'ops', 'infra', 'custom'];

export default function CatalogModal({
  entry,
  isSubmitting = false,
  onClose,
  onSubmit,
}: CatalogModalProps) {
  const [formData, setFormData] = useState<CatalogFormData>(initialFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof CatalogFormData, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!entry;

  const resetForm = useCallback(() => {
    if (entry) {
      setFormData({
        key: entry.key || '',
        displayName: entry.displayName || '',
        description: entry.description || '',
        category: entry.category || 'custom',
        kind: entry.kind || 'agent',
        image: entry.image || '',
        runtime: entry.runtime || 'docker',
        defaultModel: entry.defaultModel || '',
        command: entry.command?.join(' ') || '',
        requiredSecrets: entry.requiredSecrets?.join(', ') || '',
        env: entry.env ? JSON.stringify(entry.env, null, 2) : '',
        isPublic: entry.isPublic ?? true,
      });
    } else {
      setFormData(initialFormData);
    }
    setErrors({});
    setSubmitError(null);
  }, [entry]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof CatalogFormData, string>> = {};
    if (!formData.key.trim()) {
      newErrors.key = 'La key es obligatoria';
    } else if (!/^[a-z0-9][a-z0-9-]*$/.test(formData.key.trim())) {
      newErrors.key = 'Formato kebab-case (a-z, 0-9, guiones)';
    }
    if (!formData.displayName.trim()) newErrors.displayName = 'El nombre es obligatorio';
    if (!formData.image.trim()) newErrors.image = 'La imagen es obligatoria';

    const secrets = formData.requiredSecrets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (secrets.some((s) => !/^[A-Z][A-Z0-9_]*$/.test(s))) {
      newErrors.requiredSecrets = 'Cada secret debe ser UPPER_SNAKE_CASE';
    }

    if (formData.env.trim()) {
      try {
        const parsed = JSON.parse(formData.env);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          newErrors.env = 'env debe ser un objeto JSON';
        }
      } catch {
        newErrors.env = 'env debe ser JSON válido';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value, type } = e.target;
    const next = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
    setFormData((prev) => ({ ...prev, [name]: next }));
    if (errors[name as keyof CatalogFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);

    const command = formData.command.trim() ? formData.command.trim().split(/\s+/) : undefined;
    const requiredSecrets = formData.requiredSecrets
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const env = formData.env.trim()
      ? (JSON.parse(formData.env) as Record<string, string>)
      : undefined;

    try {
      const payload: CatalogEntryPayload = {
        key: formData.key.trim(),
        displayName: formData.displayName.trim(),
        description: formData.description || undefined,
        category: formData.category || undefined,
        kind: formData.kind,
        image: formData.image.trim(),
        runtime: formData.runtime,
        defaultModel: formData.defaultModel || undefined,
        command,
        requiredSecrets: requiredSecrets.length ? requiredSecrets : undefined,
        env,
        isPublic: formData.isPublic,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el template');
    }
  };

  const selectClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 my-8 bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Editar Template' : 'Nuevo Template'}
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="key" className="block text-sm font-medium text-gray-700 mb-1">
                Key <span className="text-red-500">*</span>
              </label>
              <Input
                id="key"
                name="key"
                type="text"
                value={formData.key}
                onChange={handleChange}
                placeholder="hr-onboarding"
                error={errors.key}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="displayName" className="block text-sm font-medium text-gray-700 mb-1">
                Nombre <span className="text-red-500">*</span>
              </label>
              <Input
                id="displayName"
                name="displayName"
                type="text"
                value={formData.displayName}
                onChange={handleChange}
                placeholder="HR Onboarding"
                error={errors.displayName}
                disabled={isSubmitting}
              />
            </div>
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
              <label htmlFor="category" className="block text-sm font-medium text-gray-700 mb-1">
                Categoría
              </label>
              <select
                id="category"
                name="category"
                value={formData.category}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="kind" className="block text-sm font-medium text-gray-700 mb-1">
                Tipo
              </label>
              <select
                id="kind"
                name="kind"
                value={formData.kind}
                onChange={handleChange}
                disabled={isSubmitting}
                className={selectClass}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
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
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="image" className="block text-sm font-medium text-gray-700 mb-1">
                Imagen <span className="text-red-500">*</span>
              </label>
              <Input
                id="image"
                name="image"
                type="text"
                value={formData.image}
                onChange={handleChange}
                placeholder="ghcr.io/org/img:tag"
                error={errors.image}
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="defaultModel" className="block text-sm font-medium text-gray-700 mb-1">
                Modelo por defecto
              </label>
              <Input
                id="defaultModel"
                name="defaultModel"
                type="text"
                value={formData.defaultModel}
                onChange={handleChange}
                placeholder="ej. claude-opus-4-8"
                disabled={isSubmitting}
              />
            </div>
          </div>

          <div>
            <label htmlFor="command" className="block text-sm font-medium text-gray-700 mb-1">
              Command (separado por espacios)
            </label>
            <Input
              id="command"
              name="command"
              type="text"
              value={formData.command}
              onChange={handleChange}
              placeholder="node dist/server.js"
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="requiredSecrets" className="block text-sm font-medium text-gray-700 mb-1">
              Required secrets (separados por comas)
            </label>
            <Input
              id="requiredSecrets"
              name="requiredSecrets"
              type="text"
              value={formData.requiredSecrets}
              onChange={handleChange}
              placeholder="OPENAI_API_KEY, SLACK_TOKEN"
              error={errors.requiredSecrets}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="env" className="block text-sm font-medium text-gray-700 mb-1">
              Env por defecto (JSON)
            </label>
            <textarea
              id="env"
              name="env"
              value={formData.env}
              onChange={handleChange}
              placeholder='{"LOG_LEVEL": "info"}'
              rows={3}
              disabled={isSubmitting}
              className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 resize-none ${
                errors.env ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.env && <p className="mt-1 text-xs text-red-500">{errors.env}</p>}
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              name="isPublic"
              checked={formData.isPublic}
              onChange={handleChange}
              disabled={isSubmitting}
              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Público (visible para no-admins)
          </label>

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
                'Crear Template'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
