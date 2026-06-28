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
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ProjectsPage;
const react_1 = __importStar(require("react"));
const navigation_1 = require("next/navigation");
const lucide_react_1 = require("lucide-react");
const auth_context_1 = require("@/lib/auth-context");
const api_1 = require("@/lib/api");
function ProjectsPage() {
    const { user, isLoading: authLoading } = (0, auth_context_1.useAuth)();
    const router = (0, navigation_1.useRouter)();
    const [projects, setProjects] = (0, react_1.useState)([]);
    const [total, setTotal] = (0, react_1.useState)(0);
    const [totalPages, setTotalPages] = (0, react_1.useState)(0);
    const [page, setPage] = (0, react_1.useState)(1);
    const [limit] = (0, react_1.useState)(10);
    const [search, setSearch] = (0, react_1.useState)('');
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [error, setError] = (0, react_1.useState)(null);
    const [showModal, setShowModal] = (0, react_1.useState)(false);
    const [editingProject, setEditingProject] = (0, react_1.useState)(null);
    const [deletingId, setDeletingId] = (0, react_1.useState)(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = (0, react_1.useState)(null);
    const [saving, setSaving] = (0, react_1.useState)(false);
    const [deleting, setDeleting] = (0, react_1.useState)(false);
    const [formName, setFormName] = (0, react_1.useState)('');
    const [formDescription, setFormDescription] = (0, react_1.useState)('');
    const [formRoot, setFormRoot] = (0, react_1.useState)('');
    const [formAgents, setFormAgents] = (0, react_1.useState)('');
    const [formPolicies, setFormPolicies] = (0, react_1.useState)('');
    const [formGates, setFormGates] = (0, react_1.useState)('');
    const [formErrors, setFormErrors] = (0, react_1.useState)({});
    (0, react_1.useEffect)(() => {
        if (!authLoading && !user) {
            router.push('/login');
        }
    }, [user, authLoading, router]);
    const loadProjects = (0, react_1.useCallback)(async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await api_1.api.get('/projects', {
                params: { page, limit, search },
            });
            setProjects(response.data.data);
            setTotal(response.data.total);
            setTotalPages(response.data.totalPages);
        }
        catch (err) {
            const message = err?.response?.data?.message || err?.message || 'Error al cargar proyectos';
            setError(message);
            setProjects([]);
            setTotal(0);
            setTotalPages(0);
        }
        finally {
            setLoading(false);
        }
    }, [page, limit, search]);
    (0, react_1.useEffect)(() => {
        if (user) {
            loadProjects();
        }
    }, [user, loadProjects]);
    const [searchTimeout, setSearchTimeout] = (0, react_1.useState)(null);
    const handleSearchChange = (value) => {
        setSearch(value);
        if (searchTimeout)
            clearTimeout(searchTimeout);
        const timeout = setTimeout(() => {
            setPage(1);
        }, 500);
        setSearchTimeout(timeout);
    };
    const validateForm = () => {
        const errors = {};
        if (!formName.trim()) {
            errors.name = 'El nombre es requerido';
        }
        else if (formName.trim().length < 2) {
            errors.name = 'El nombre debe tener al menos 2 caracteres';
        }
        setFormErrors(errors);
        return Object.keys(errors).length === 0;
    };
    const handleOpenCreate = () => {
        setEditingProject(null);
        setFormName('');
        setFormDescription('');
        setFormRoot('');
        setFormAgents('');
        setFormPolicies('');
        setFormGates('');
        setFormErrors({});
        setShowModal(true);
    };
    const handleOpenEdit = (project) => {
        setEditingProject(project);
        setFormName(project.name);
        setFormDescription(project.description || '');
        setFormRoot(project.root || '');
        setFormAgents((project.agents || []).join(', '));
        setFormPolicies((project.policies || []).join(', '));
        setFormGates((project.gates || []).join(', '));
        setFormErrors({});
        setShowModal(true);
    };
    const handleSave = async () => {
        if (!validateForm())
            return;
        try {
            setSaving(true);
            setError(null);
            const payload = {
                name: formName.trim(),
                description: formDescription.trim() || undefined,
                root: formRoot.trim() || undefined,
                agents: formAgents.trim() ? formAgents.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
                policies: formPolicies.trim() ? formPolicies.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
                gates: formGates.trim() ? formGates.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
            };
            if (editingProject) {
                await api_1.api.patch(`/projects/${editingProject.id}`, payload);
            }
            else {
                await api_1.api.post('/projects', payload);
            }
            setShowModal(false);
            loadProjects();
        }
        catch (err) {
            const message = err?.response?.data?.message || err?.message || 'Error al guardar proyecto';
            setError(message);
        }
        finally {
            setSaving(false);
        }
    };
    const handleDeleteConfirm = async () => {
        if (!showDeleteConfirm)
            return;
        try {
            setDeleting(true);
            setError(null);
            await api_1.api.delete(`/projects/${showDeleteConfirm}`);
            setShowDeleteConfirm(null);
            loadProjects();
        }
        catch (err) {
            const message = err?.response?.data?.message || err?.message || 'Error al eliminar proyecto';
            setError(message);
        }
        finally {
            setDeleting(false);
        }
    };
    const formatDate = (dateStr) => {
        try {
            return new Date(dateStr).toLocaleDateString('es-ES', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
            });
        }
        catch {
            return dateStr;
        }
    };
    if (authLoading) {
        return (<div className="flex items-center justify-center min-h-[60vh]">
        <lucide_react_1.Loader2 className="w-8 h-8 animate-spin text-blue-600"/>
      </div>);
    }
    if (!user)
        return null;
    return (<div className="space-y-6">
      
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Proyectos</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Gestiona tus proyectos de agentes
          </p>
        </div>
        <button onClick={handleOpenCreate} className="inline-flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium">
          <lucide_react_1.Plus className="w-4 h-4 mr-2"/>
          Nuevo Proyecto
        </button>
      </div>

      
      {error && (<div className="flex items-center gap-2 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400 text-sm">
          <lucide_react_1.AlertCircle className="w-5 h-5 flex-shrink-0"/>
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)} className="hover:text-red-900 dark:hover:text-red-300">
            <lucide_react_1.X className="w-4 h-4"/>
          </button>
        </div>)}

      
      <div className="relative">
        <lucide_react_1.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"/>
        <input type="text" placeholder="Buscar proyectos por nombre..." value={search} onChange={(e) => handleSearchChange(e.target.value)} className="w-full pl-10 pr-4 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors text-sm"/>
      </div>

      
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
        {loading ? (<div className="flex items-center justify-center py-20">
            <lucide_react_1.Loader2 className="w-8 h-8 animate-spin text-blue-600"/>
          </div>) : projects.length === 0 ? (<div className="text-center py-20">
            <p className="text-gray-500 dark:text-gray-400 text-lg">
              {search ? 'No se encontraron proyectos con ese nombre' : 'No hay proyectos aún'}
            </p>
            {!search && (<button onClick={handleOpenCreate} className="mt-4 text-blue-600 hover:text-blue-700 font-medium text-sm">
                Crear tu primer proyecto
              </button>)}
          </div>) : (<div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Nombre
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden md:table-cell">
                    Descripción
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider hidden lg:table-cell">
                    Fecha de creación
                  </th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {projects.map((project) => (<tr key={project.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="text-sm font-medium text-gray-900 dark:text-white">
                        {project.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden md:table-cell">
                      <span className="text-sm text-gray-500 dark:text-gray-400 line-clamp-2">
                        {project.description || '—'}
                      </span>
                    </td>
                    <td className="px-6 py-4 hidden lg:table-cell">
                      <span className="text-sm text-gray-500 dark:text-gray-400">
                        {formatDate(project.createdAt)}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => handleOpenEdit(project)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors" title="Editar proyecto">
                          <lucide_react_1.Edit2 className="w-4 h-4"/>
                        </button>
                        <button onClick={() => setShowDeleteConfirm(project.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title="Eliminar proyecto">
                          <lucide_react_1.Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}

        
        {!loading && totalPages > 1 && (<div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Mostrando {((page - 1) * limit) + 1}–{Math.min(page * limit, total)} de {total} proyectos
            </p>
            <div className="flex items-center gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                Anterior
              </button>
              <span className="text-sm text-gray-500 dark:text-gray-400 px-2">
                {page} / {totalPages}
              </span>
              <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                Siguiente
              </button>
            </div>
          </div>)}
      </div>

      
      {showModal && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {editingProject ? 'Editar Proyecto' : 'Nuevo Proyecto'}
              </h2>
              <button onClick={() => setShowModal(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                <lucide_react_1.X className="w-5 h-5"/>
              </button>
            </div>

            <div className="px-6 py-4 space-y-4">
              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Nombre <span className="text-red-500">*</span>
                </label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={`w-full px-3 py-2 border rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${formErrors.name ? 'border-red-500' : 'border-gray-300 dark:border-gray-600'}`} placeholder="Nombre del proyecto"/>
                {formErrors.name && (<p className="mt-1 text-xs text-red-500">{formErrors.name}</p>)}
              </div>

              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Descripción
                </label>
                <textarea value={formDescription} onChange={(e) => setFormDescription(e.target.value)} rows={3} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors resize-none" placeholder="Descripción del proyecto (opcional)"/>
              </div>

              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Root
                </label>
                <input type="text" value={formRoot} onChange={(e) => setFormRoot(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors" placeholder="Ruta raíz del proyecto (opcional)"/>
              </div>

              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Agentes
                </label>
                <input type="text" value={formAgents} onChange={(e) => setFormAgents(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors" placeholder="IDs de agentes separados por coma (opcional)"/>
              </div>

              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Políticas
                </label>
                <input type="text" value={formPolicies} onChange={(e) => setFormPolicies(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors" placeholder="Políticas separadas por coma (opcional)"/>
              </div>

              
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Gates
                </label>
                <input type="text" value={formGates} onChange={(e) => setFormGates(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors" placeholder="Gates separados por coma (opcional)"/>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                Cancelar
              </button>
              <button onClick={handleSave} disabled={saving} className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {saving && <lucide_react_1.Loader2 className="w-4 h-4 mr-2 animate-spin"/>}
                {editingProject ? 'Guardar Cambios' : 'Crear Proyecto'}
              </button>
            </div>
          </div>
        </div>)}

      
      {showDeleteConfirm && (<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md">
            <div className="px-6 py-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Confirmar eliminación
              </h3>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                ¿Estás seguro de que deseas eliminar este proyecto? Esta acción no se puede deshacer.
              </p>
            </div>
            <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 dark:border-gray-700">
              <button onClick={() => setShowDeleteConfirm(null)} className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 transition-colors">
                Cancelar
              </button>
              <button onClick={handleDeleteConfirm} disabled={deleting} className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                {deleting && <lucide_react_1.Loader2 className="w-4 h-4 mr-2 animate-spin"/>}
                Eliminar
              </button>
            </div>
          </div>
        </div>)}
    </div>);
}
//# sourceMappingURL=page.js.map