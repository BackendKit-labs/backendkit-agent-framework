'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { X, Loader2 } from 'lucide-react';
import Button from '@/components/ui/button';
import Input from '@/components/ui/input';

interface AgentFormData {
  name: string;
  description: string;
  type: 'chat' | 'task' | 'monitor' | 'custom';
  status: 'idle' | 'active' | 'error' | 'stopped';
  config: string;
  projectId: string;
  model: string;
}

interface Agent {
  id: string;
  name: string;
  description?: string;
  type: 'chat' | 'task' | 'monitor' | 'custom';
  status: 'idle' | 'active' | 'error' | 'stopped';
  config?: Record<string, unknown>;
  projectId?: string;
  model?: string;
  createdAt: string;
  updatedAt: string;
}

interface Project {
  id: string;
  name: string;
}

interface AgentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: AgentFormData) => Promise<void>;
  agent?: Agent | null;
  projects: Project[];
}

const initialFormData: AgentFormData = {
  name: '',
  description: '',
  type: 'chat',
  status: 'idle',
  config: '',
  projectId: '',
  model: '',
};

const AGENT_TYPES: { value: AgentFormData['type']; label: string }[] = [
  { value: 'chat', label: 'Chat' },
  { value: 'task', label: 'Task' },
  { value: 'monitor', label: 'Monitor' },
  { value: 'custom', label: 'Custom' },
];

const AGENT_STATUSES: { value: AgentFormData['status']; label: string }[] = [
  { value: 'idle', label: 'Idle' },
  { value: 'active', label: 'Active' },
  { value: 'error', label: 'Error' },
  { value: 'stopped', label: 'Stopped' },
];

export default function AgentModal({
  isOpen,
  onClose,
  onSave,
  agent,
  projects,
}: AgentModalProps) {
  const [formData, setFormData] = useState<AgentFormData>(initialFormData);
  const [errors, setErrors] = useState<Partial<Record<keyof AgentFormData, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isEditing = !!agent;

  const resetForm = useCallback(() => {
    if (agent) {
      setFormData({
        name: agent.name || '',
        description: agent.description || '',
        type: agent.type || 'chat',
        status: agent.status || 'idle',
        config: agent.config ? JSON.stringify(agent.config, null, 2) : '',
        projectId: agent.projectId || '',
        model: agent.model || '',
      });
    } else {
      setFormData(initialFormData);
    }
    setErrors({});
    setSubmitError(null);
  }, [agent]);

  useEffect(() => {
    if (isOpen) {
      resetForm();
    }
  }, [isOpen, resetForm]);

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof AgentFormData, string>> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    } else if (formData.name.trim().length < 2) {
      newErrors.name = 'Name must be at least 2 characters';
    }

    if (formData.config) {
      try {
        JSON.parse(formData.config);
      } catch {
        newErrors.config = 'Config must be valid JSON';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name as keyof AgentFormData]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const dataToSend: AgentFormData = {
        ...formData,
        config: formData.config ? JSON.parse(formData.config) : undefined,
      };
      await onSave(dataToSend);
      onClose();
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : 'Failed to save agent'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <Input
              id="name"
              name="name"
              type="text"
              value={formData.name}
              onChange={handleChange}
              placeholder="Agent name"
              error={errors.name}
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={handleChange}
              placeholder="Agent description (optional)"
              rows={3}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"
            />
          </div>

          {/* Type */}
          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select
              id="type"
              name="type"
              value={formData.type}
              onChange={handleChange}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              {AGENT_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Status */}
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select
              id="status"
              name="status"
              value={formData.status}
              onChange={handleChange}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              {AGENT_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </div>

          {/* Project */}
          <div>
            <label htmlFor="projectId" className="block text-sm font-medium text-gray-700 mb-1">
              Project
            </label>
            <select
              id="projectId"
              name="projectId"
              value={formData.projectId}
              onChange={handleChange}
              disabled={isSubmitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white"
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          <div>
            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <Input
              id="model"
              name="model"
              type="text"
              value={formData.model}
              onChange={handleChange}
              placeholder="e.g. gpt-4, claude-3"
              disabled={isSubmitting}
            />
          </div>

          {/* Config (JSON) */}
          <div>
            <label htmlFor="config" className="block text-sm font-medium text-gray-700 mb-1">
              Config (JSON)
            </label>
            <textarea
              id="config"
              name="config"
              value={formData.config}
              onChange={handleChange}
              placeholder='{"key": "value"}'
              rows={4}
              disabled={isSubmitting}
              className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none ${
                errors.config ? 'border-red-500' : 'border-gray-300'
              }`}
            />
            {errors.config && (
              <p className="mt-1 text-xs text-red-500">{errors.config}</p>
            )}
          </div>

          {/* Submit error */}
          {submitError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{submitError}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {isEditing ? 'Updating...' : 'Creating...'}
                </span>
              ) : (
                isEditing ? 'Update Agent' : 'Create Agent'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}