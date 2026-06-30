'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Department, DepartmentPayload } from '@/lib/types';

interface DepartmentFormData {
  name: string;
  slug: string;
  description: string;
  icon: string;
  color: string;
}

interface DepartmentModalProps {
  department?: Department | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: DepartmentPayload) => Promise<void>;
}

const initialFormData: DepartmentFormData = {
  name: '',
  slug: '',
  description: '',
  icon: '',
  color: '',
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export default function DepartmentModal({
  department,
  isSubmitting = false,
  onClose,
  onSubmit,
}: DepartmentModalProps) {
  const [formData, setFormData] = useState<DepartmentFormData>(initialFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof DepartmentFormData, string>>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  // El slug se autogenera del nombre hasta que el usuario lo edita manualmente.
  const [slugTouched, setSlugTouched] = useState(false);

  const isEditing = !!department;

  const resetForm = useCallback(() => {
    if (department) {
      setFormData({
        name: department.name || '',
        slug: department.slug || '',
        description: department.description || '',
        icon: department.icon || '',
        color: department.color || '',
      });
      setSlugTouched(true);
    } else {
      setFormData(initialFormData);
      setSlugTouched(false);
    }
    setErrors({});
    setSubmitError(null);
  }, [department]);

  useEffect(() => {
    resetForm();
  }, [resetForm]);

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof DepartmentFormData, string>> = {};
    if (!formData.name.trim()) {
      newErrors.name = 'El nombre es obligatorio';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Mínimo 2 caracteres';
    }
    if (formData.slug && !/^[a-z0-9-]+$/.test(formData.slug)) {
      newErrors.slug = 'Solo minúsculas, números y guiones';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setFormData((prev) => ({
      ...prev,
      name: value,
      slug: slugTouched ? prev.slug : slugify(value),
    }));
    if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    if (name === 'slug') setSlugTouched(true);
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof DepartmentFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitError(null);
    try {
      const payload: DepartmentPayload = {
        name: formData.name.trim(),
        slug: formData.slug.trim() || undefined,
        description: formData.description || undefined,
        icon: formData.icon || undefined,
        color: formData.color || undefined,
      };
      await onSubmit(payload);
      onClose();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'No se pudo guardar el departamento');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Editar Departamento' : 'Nuevo Departamento'}
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
              onChange={handleNameChange}
              placeholder="ej. Recursos Humanos"
              error={errors.name}
              disabled={isSubmitting}
            />
          </div>

          <div>
            <label htmlFor="slug" className="block text-sm font-medium text-gray-700 mb-1">
              Slug
            </label>
            <Input
              id="slug"
              name="slug"
              type="text"
              value={formData.slug}
              onChange={handleChange}
              placeholder="recursos-humanos"
              error={errors.slug}
              disabled={isSubmitting}
            />
            <p className="mt-1 text-xs text-gray-400">
              Se autogenera del nombre. Solo minúsculas, números y guiones.
            </p>
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
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="icon" className="block text-sm font-medium text-gray-700 mb-1">
                Icono
              </label>
              <Input
                id="icon"
                name="icon"
                type="text"
                value={formData.icon}
                onChange={handleChange}
                placeholder="ej. 🧑‍💼 o nombre"
                disabled={isSubmitting}
              />
            </div>
            <div>
              <label htmlFor="color" className="block text-sm font-medium text-gray-700 mb-1">
                Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={/^#[0-9a-fA-F]{6}$/.test(formData.color) ? formData.color : '#3b82f6'}
                  onChange={(e) => setFormData((prev) => ({ ...prev, color: e.target.value }))}
                  disabled={isSubmitting}
                  className="h-9 w-10 shrink-0 rounded border border-gray-300 bg-white p-0.5 disabled:opacity-50"
                  aria-label="Selector de color"
                />
                <Input
                  id="color"
                  name="color"
                  type="text"
                  value={formData.color}
                  onChange={handleChange}
                  placeholder="#3b82f6"
                  disabled={isSubmitting}
                />
              </div>
            </div>
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
                'Crear Departamento'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
