'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Plus, Trash2, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { departmentService } from '@/services/department-service';
import { Department, SecretRef } from '@/lib/types';

interface SecretsModalProps {
  department: Department;
  onClose: () => void;
}

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export default function SecretsModal({ department, onClose }: SecretsModalProps) {
  const [secrets, setSecrets] = useState<SecretRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingKey, setDeletingKey] = useState<string | null>(null);

  const loadSecrets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await departmentService.listSecrets(department.id);
      setSecrets(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al cargar secrets');
      setSecrets([]);
    } finally {
      setLoading(false);
    }
  }, [department.id]);

  useEffect(() => {
    loadSecrets();
  }, [loadSecrets]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const key = newKey.trim();
    if (!KEY_PATTERN.test(key)) {
      setKeyError('Formato UPPER_SNAKE_CASE (ej. OPENAI_API_KEY)');
      return;
    }
    if (!newValue) {
      setKeyError(null);
      setError('El valor no puede estar vacío');
      return;
    }
    setKeyError(null);
    setError(null);
    setIsSaving(true);
    try {
      await departmentService.setSecret(department.id, key, newValue);
      setNewKey('');
      setNewValue('');
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al guardar el secret');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    setDeletingKey(key);
    setError(null);
    try {
      await departmentService.removeSecret(department.id, key);
      await loadSecrets();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error al eliminar el secret');
    } finally {
      setDeletingKey(null);
    }
  };

  const existingKey = secrets.some((s) => s.key === newKey.trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 my-8 bg-white rounded-xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Secrets</h2>
            <p className="text-sm text-gray-500">{department.name}</p>
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
          {/* Add form */}
          <form onSubmit={handleAdd} className="space-y-3 rounded-lg border border-gray-200 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Key</label>
                <Input
                  name="key"
                  type="text"
                  value={newKey}
                  onChange={(e) => {
                    setNewKey(e.target.value.toUpperCase());
                    if (keyError) setKeyError(null);
                  }}
                  placeholder="OPENAI_API_KEY"
                  error={keyError ?? undefined}
                  disabled={isSaving}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Valor</label>
                <Input
                  name="value"
                  type="password"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="sk-..."
                  disabled={isSaving}
                />
              </div>
            </div>
            {existingKey && newKey && (
              <p className="text-xs text-amber-600">
                Esta key ya existe — se sobrescribirá su valor.
              </p>
            )}
            <Button type="submit" size="sm" disabled={isSaving || !newKey || !newValue}>
              {isSaving ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Plus className="w-4 h-4 mr-2" />
              )}
              {existingKey ? 'Actualizar secret' : 'Añadir secret'}
            </Button>
          </form>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* List */}
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
            </div>
          ) : secrets.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-6">
              No hay secrets configurados en este departamento.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200">
              {secrets.map((s) => (
                <li key={s.key} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <KeyRound className="w-4 h-4 shrink-0 text-gray-400" />
                    <span className="font-mono text-sm text-gray-800 truncate">{s.key}</span>
                  </div>
                  <button
                    onClick={() => handleDelete(s.key)}
                    disabled={deletingKey === s.key}
                    className="p-1 text-gray-400 hover:text-red-600 transition-colors disabled:opacity-50"
                    title="Eliminar secret"
                  >
                    {deletingKey === s.key ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Trash2 className="w-4 h-4" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="text-xs text-gray-400">
            Los valores nunca se muestran: el backend solo devuelve las keys. Se inyectan como
            variables de entorno al desplegar un deployable del departamento.
          </p>
        </div>
      </div>
    </div>
  );
}
