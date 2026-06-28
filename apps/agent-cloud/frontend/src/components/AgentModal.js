"use strict";
'use client';
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = AgentModal;
const react_1 = __importStar(require("react"));
const lucide_react_1 = require("lucide-react");
const button_1 = __importDefault(require("@/components/ui/button"));
const input_1 = __importDefault(require("@/components/ui/input"));
const initialFormData = {
    name: '',
    description: '',
    type: 'chat',
    status: 'idle',
    config: '',
    projectId: '',
    model: '',
};
const AGENT_TYPES = [
    { value: 'chat', label: 'Chat' },
    { value: 'task', label: 'Task' },
    { value: 'monitor', label: 'Monitor' },
    { value: 'custom', label: 'Custom' },
];
const AGENT_STATUSES = [
    { value: 'idle', label: 'Idle' },
    { value: 'active', label: 'Active' },
    { value: 'error', label: 'Error' },
    { value: 'stopped', label: 'Stopped' },
];
function AgentModal({ isOpen, onClose, onSave, agent, projects, }) {
    const [formData, setFormData] = (0, react_1.useState)(initialFormData);
    const [errors, setErrors] = (0, react_1.useState)({});
    const [isSubmitting, setIsSubmitting] = (0, react_1.useState)(false);
    const [submitError, setSubmitError] = (0, react_1.useState)(null);
    const isEditing = !!agent;
    const resetForm = (0, react_1.useCallback)(() => {
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
        }
        else {
            setFormData(initialFormData);
        }
        setErrors({});
        setSubmitError(null);
    }, [agent]);
    (0, react_1.useEffect)(() => {
        if (isOpen) {
            resetForm();
        }
    }, [isOpen, resetForm]);
    const validate = () => {
        const newErrors = {};
        if (!formData.name.trim()) {
            newErrors.name = 'Name is required';
        }
        else if (formData.name.trim().length < 2) {
            newErrors.name = 'Name must be at least 2 characters';
        }
        if (formData.config) {
            try {
                JSON.parse(formData.config);
            }
            catch {
                newErrors.config = 'Config must be valid JSON';
            }
        }
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };
    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData((prev) => ({ ...prev, [name]: value }));
        if (errors[name]) {
            setErrors((prev) => ({ ...prev, [name]: undefined }));
        }
    };
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!validate())
            return;
        setIsSubmitting(true);
        setSubmitError(null);
        try {
            const dataToSend = {
                ...formData,
                config: formData.config ? JSON.parse(formData.config) : undefined,
            };
            await onSave(dataToSend);
            onClose();
        }
        catch (err) {
            setSubmitError(err instanceof Error ? err.message : 'Failed to save agent');
        }
        finally {
            setIsSubmitting(false);
        }
    };
    if (!isOpen)
        return null;
    return (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="relative w-full max-w-lg mx-4 bg-white rounded-xl shadow-2xl">
        
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Agent' : 'Create Agent'}
          </h2>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition-colors" aria-label="Close modal">
            <lucide_react_1.X className="w-5 h-5"/>
          </button>
        </div>

        
        <form onSubmit={handleSubmit} className="px-6 py-4 space-y-4">
          
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input_1.default id="name" name="name" type="text" value={formData.name} onChange={handleChange} placeholder="Agent name" error={errors.name} disabled={isSubmitting}/>
          </div>

          
          <div>
            <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea id="description" name="description" value={formData.description} onChange={handleChange} placeholder="Agent description (optional)" rows={3} disabled={isSubmitting} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none"/>
          </div>

          
          <div>
            <label htmlFor="type" className="block text-sm font-medium text-gray-700 mb-1">
              Type
            </label>
            <select id="type" name="type" value={formData.type} onChange={handleChange} disabled={isSubmitting} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white">
              {AGENT_TYPES.map((type) => (<option key={type.value} value={type.value}>
                  {type.label}
                </option>))}
            </select>
          </div>

          
          <div>
            <label htmlFor="status" className="block text-sm font-medium text-gray-700 mb-1">
              Status
            </label>
            <select id="status" name="status" value={formData.status} onChange={handleChange} disabled={isSubmitting} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white">
              {AGENT_STATUSES.map((status) => (<option key={status.value} value={status.value}>
                  {status.label}
                </option>))}
            </select>
          </div>

          
          <div>
            <label htmlFor="projectId" className="block text-sm font-medium text-gray-700 mb-1">
              Project
            </label>
            <select id="projectId" name="projectId" value={formData.projectId} onChange={handleChange} disabled={isSubmitting} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed bg-white">
              <option value="">No project</option>
              {projects.map((project) => (<option key={project.id} value={project.id}>
                  {project.name}
                </option>))}
            </select>
          </div>

          
          <div>
            <label htmlFor="model" className="block text-sm font-medium text-gray-700 mb-1">
              Model
            </label>
            <input_1.default id="model" name="model" type="text" value={formData.model} onChange={handleChange} placeholder="e.g. gpt-4, claude-3" disabled={isSubmitting}/>
          </div>

          
          <div>
            <label htmlFor="config" className="block text-sm font-medium text-gray-700 mb-1">
              Config (JSON)
            </label>
            <textarea id="config" name="config" value={formData.config} onChange={handleChange} placeholder='{"key": "value"}' rows={4} disabled={isSubmitting} className={`w-full px-3 py-2 border rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed resize-none ${errors.config ? 'border-red-500' : 'border-gray-300'}`}/>
            {errors.config && (<p className="mt-1 text-xs text-red-500">{errors.config}</p>)}
          </div>

          
          {submitError && (<div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-sm text-red-600">{submitError}</p>
            </div>)}

          
          <div className="flex justify-end gap-3 pt-2">
            <button_1.default type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </button_1.default>
            <button_1.default type="submit" variant="primary" disabled={isSubmitting}>
              {isSubmitting ? (<span className="flex items-center gap-2">
                  <lucide_react_1.Loader2 className="w-4 h-4 animate-spin"/>
                  {isEditing ? 'Updating...' : 'Creating...'}
                </span>) : (isEditing ? 'Update Agent' : 'Create Agent')}
            </button_1.default>
          </div>
        </form>
      </div>
    </div>);
}
//# sourceMappingURL=AgentModal.js.map