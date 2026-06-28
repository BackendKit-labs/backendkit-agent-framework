"use strict";
"use client";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = ProjectsPage;
const react_1 = require("react");
const AuthContext_1 = require("@/contexts/AuthContext");
const navigation_1 = require("next/navigation");
const DashboardLayout_1 = __importDefault(require("@/components/layout/DashboardLayout"));
const Button_1 = require("@/components/ui/Button");
const Input_1 = require("@/components/ui/Input");
const Card_1 = require("@/components/ui/Card");
const Modal_1 = require("@/components/ui/Modal");
const Pagination_1 = require("@/components/ui/Pagination");
const project_service_1 = require("@/services/project.service");
const lucide_react_1 = require("lucide-react");
const react_hook_form_1 = require("react-hook-form");
const zod_1 = require("@hookform/resolvers/zod");
const zod_2 = require("zod");
const projectSchema = zod_2.z.object({
    name: zod_2.z.string().min(2, "El nombre debe tener al menos 2 caracteres").max(100),
    description: zod_2.z.string().optional(),
    root: zod_2.z.string().min(1, "El root es requerido"),
    agents: zod_2.z.array(zod_2.z.string()).optional(),
    policies: zod_2.z.array(zod_2.z.string()).optional(),
    gates: zod_2.z.array(zod_2.z.string()).optional(),
});
function ProjectsPage() {
    const { user, isLoading } = (0, AuthContext_1.useAuth)();
    const router = (0, navigation_1.useRouter)();
    const [projects, setProjects] = (0, react_1.useState)({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 });
    const [loading, setLoading] = (0, react_1.useState)(true);
    const [search, setSearch] = (0, react_1.useState)("");
    const [page, setPage] = (0, react_1.useState)(1);
    const [showModal, setShowModal] = (0, react_1.useState)(false);
    const [editingProject, setEditingProject] = (0, react_1.useState)(null);
    const [deleteConfirm, setDeleteConfirm] = (0, react_1.useState)(null);
    const [error, setError] = (0, react_1.useState)(null);
    const { register, handleSubmit, reset, formState: { errors }, } = (0, react_hook_form_1.useForm)({
        resolver: (0, zod_1.zodResolver)(projectSchema),
    });
    const fetchProjects = (0, react_1.useCallback)(async () => {
        try {
            setLoading(true);
            const result = await project_service_1.projectService.getAll({ page, limit: 10, search });
            setProjects(result);
        }
        catch (err) {
            setError("Error al cargar proyectos");
            console.error(err);
        }
        finally {
            setLoading(false);
        }
    }, [page, search]);
    (0, react_1.useEffect)(() => {
        if (!isLoading && !user) {
            router.push("/login");
        }
    }, [user, isLoading, router]);
    (0, react_1.useEffect)(() => {
        if (user) {
            fetchProjects();
        }
    }, [user, fetchProjects]);
    const handleCreate = async (data) => {
        try {
            await project_service_1.projectService.create(data);
            setShowModal(false);
            reset();
            fetchProjects();
        }
        catch (err) {
            setError("Error al crear proyecto");
            console.error(err);
        }
    };
    const handleUpdate = async (data) => {
        if (!editingProject)
            return;
        try {
            await project_service_1.projectService.update(editingProject.id, data);
            setShowModal(false);
            setEditingProject(null);
            reset();
            fetchProjects();
        }
        catch (err) {
            setError("Error al actualizar proyecto");
            console.error(err);
        }
    };
    const handleDelete = async (id) => {
        try {
            await project_service_1.projectService.remove(id);
            setDeleteConfirm(null);
            fetchProjects();
        }
        catch (err) {
            setError("Error al eliminar proyecto");
            console.error(err);
        }
    };
    const openEditModal = (project) => {
        setEditingProject(project);
        reset({
            name: project.name,
            description: project.description,
            root: project.root || "",
            agents: project.agents,
            policies: project.policies,
            gates: project.gates,
        });
        setShowModal(true);
    };
    const openCreateModal = () => {
        setEditingProject(null);
        reset({
            name: "",
            description: "",
            root: "",
            agents: [],
            policies: [],
            gates: [],
        });
        setShowModal(true);
    };
    if (isLoading) {
        return (<DashboardLayout_1.default>
        <div className="flex items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary-500"></div>
        </div>
      </DashboardLayout_1.default>);
    }
    if (!user)
        return null;
    return (<DashboardLayout_1.default>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Proyectos</h1>
            <p className="text-gray-500 mt-1">Gestiona tus proyectos de agentes</p>
          </div>
          <Button_1.Button onClick={openCreateModal}>
            <lucide_react_1.Plus className="h-4 w-4 mr-2"/>
            Nuevo Proyecto
          </Button_1.Button>
        </div>

        {error && (<div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-md text-sm">
            {error}
          </div>)}

        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-md">
            <lucide_react_1.Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400"/>
            <Input_1.Input placeholder="Buscar proyectos..." value={search} onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
        }} className="pl-10"/>
          </div>
        </div>

        <Card_1.Card>
          <Card_1.CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Nombre</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Descripción</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Root</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Agentes</th>
                    <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Creado</th>
                    <th className="text-right px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {loading ? (<tr>
                      <td colSpan={6} className="px-6 py-12 text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-primary-500 mx-auto"></div>
                      </td>
                    </tr>) : projects.data.length === 0 ? (<tr>
                      <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                        No se encontraron proyectos
                      </td>
                    </tr>) : (projects.data.map((project) => (<tr key={project.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium text-gray-900">{project.name}</span>
                        </td>
                        <td className="px-6 py-4">
                          <span className="text-sm text-gray-500 line-clamp-1">{project.description || "-"}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-500">{project.root || "-"}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-500">{project.agents?.length || 0}</span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-500">
                            {new Date(project.createdAt).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button_1.Button variant="ghost" size="sm" onClick={() => router.push(`/projects/${project.id}`)}>
                              <lucide_react_1.Eye className="h-4 w-4"/>
                            </Button_1.Button>
                            <Button_1.Button variant="ghost" size="sm" onClick={() => openEditModal(project)}>
                              <lucide_react_1.Edit className="h-4 w-4"/>
                            </Button_1.Button>
                            <Button_1.Button variant="ghost" size="sm" onClick={() => setDeleteConfirm(project.id)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                              <lucide_react_1.Trash2 className="h-4 w-4"/>
                            </Button_1.Button>
                          </div>
                        </td>
                      </tr>)))}
                </tbody>
              </table>
            </div>
          </Card_1.CardContent>
        </Card_1.Card>

        {projects.totalPages > 1 && (<Pagination_1.Pagination currentPage={projects.page} totalPages={projects.totalPages} onPageChange={setPage}/>)}

        <Modal_1.Modal isOpen={showModal} onClose={() => {
            setShowModal(false);
            setEditingProject(null);
        }} title={editingProject ? "Editar Proyecto" : "Nuevo Proyecto"}>
          <form onSubmit={handleSubmit(editingProject ? handleUpdate : handleCreate)} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nombre</label>
              <Input_1.Input {...register("name")} error={errors.name?.message}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Descripción</label>
              <textarea {...register("description")} className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500" rows={3}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Root</label>
              <Input_1.Input {...register("root")} error={errors.root?.message}/>
            </div>
            <div className="flex justify-end gap-3 pt-4">
              <Button_1.Button type="button" variant="outline" onClick={() => {
            setShowModal(false);
            setEditingProject(null);
        }}>
                Cancelar
              </Button_1.Button>
              <Button_1.Button type="submit">
                {editingProject ? "Actualizar" : "Crear"}
              </Button_1.Button>
            </div>
          </form>
        </Modal_1.Modal>

        <Modal_1.Modal isOpen={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Confirmar Eliminación">
          <div className="space-y-4">
            <p className="text-gray-600">
              ¿Estás seguro de que deseas eliminar este proyecto? Esta acción no se puede deshacer.
            </p>
            <div className="flex justify-end gap-3">
              <Button_1.Button variant="outline" onClick={() => setDeleteConfirm(null)}>
                Cancelar
              </Button_1.Button>
              <Button_1.Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>
                Eliminar
              </Button_1.Button>
            </div>
          </div>
        </Modal_1.Modal>
      </div>
    </DashboardLayout_1.default>);
}
//# sourceMappingURL=page.js.map