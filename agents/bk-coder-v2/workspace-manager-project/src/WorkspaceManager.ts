import {
  Project,
  AgentConfig,
  DEFAULT_AGENTS,
  DEFAULT_POLICIES,
  DEFAULT_GATES,
  BUILT_IN_POLICIES,
  PolicyRule,
  ProjectListItem,
  ProjectListOutput,
  SwitchOutput,
  DeleteOutput,
  UpdateOutput,
  AgentExistsOutput,
  RootOutput,
  GateConfigOutput,
  MemoryConfigOutput,
} from './types.js';
import {
  readProjects,
  writeProjects,
  getProject,
  getCurrentProject,
  getCurrentProjectName,
  saveProject,
  deleteProject as storeDeleteProject,
  setCurrent,
  projectExists,
  listProjectNames,
} from './storage/projectStore.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function now(): string {
  return new Date().toISOString();
}

function fillAgentDefaults(agentId: string, overrides: Partial<AgentConfig>, namespace: string): AgentConfig {
  const defaults = DEFAULT_AGENTS[agentId];
  if (!defaults) throw new Error(`Unknown agent type: ${agentId}`);
  return {
    ...defaults,
    ...overrides,
    memoryNamespace: namespace,
  };
}

function buildProject(
  name: string,
  root: string,
  description: string | undefined,
  agentsInput: Record<string, Partial<AgentConfig>> | undefined,
  policiesInput: { enabled?: string[] } | undefined,
  gatesInput: Partial<Project['gates']> | undefined,
): Project {
  const namespace = name;
  const agents: Record<string, AgentConfig> = {};

  // If no agents specified, use all defaults
  if (!agentsInput || Object.keys(agentsInput).length === 0) {
    for (const [id, def] of Object.entries(DEFAULT_AGENTS)) {
      agents[id] = { ...def, memoryNamespace: namespace };
    }
  } else {
    // Merge specified agents with defaults
    for (const [id, def] of Object.entries(DEFAULT_AGENTS)) {
      const overrides = agentsInput[id];
      if (overrides) {
        agents[id] = fillAgentDefaults(id, overrides, namespace);
      }
    }
    // Also add any custom agents not in defaults
    for (const [id, overrides] of Object.entries(agentsInput)) {
      if (!agents[id]) {
        agents[id] = {
          model: overrides.model || 'deepseek-v3',
          temperature: overrides.temperature ?? 0.3,
          maxTokens: overrides.maxTokens ?? 8000,
          srcPath: overrides.srcPath,
          specPath: overrides.specPath,
          memoryNamespace: namespace,
          tools: overrides.tools || [],
        };
      }
    }
  }

  return {
    name,
    root,
    description,
    createdAt: now(),
    updatedAt: now(),
    agents,
    policies: {
      enabled: policiesInput?.enabled ?? [...DEFAULT_POLICIES],
    },
    memory: {
      namespace,
      enabled: true,
    },
    gates: {
      designReview: gatesInput?.designReview ?? DEFAULT_GATES.designReview,
      securityReview: gatesInput?.securityReview ?? DEFAULT_GATES.securityReview,
      qaApproval: gatesInput?.qaApproval ?? DEFAULT_GATES.qaApproval,
    },
  };
}

// ── WorkspaceManager ──────────────────────────────────────────────────────────

export class WorkspaceManager {
  // ── project_list ──────────────────────────────────────────────────────────

  list(): ProjectListOutput {
    const data = readProjects();
    const current = data.current && data.projects[data.current] ? data.current : null;
    const projects: ProjectListItem[] = Object.entries(data.projects).map(([id, p]) => ({
      id,
      name: p.name,
      root: p.root,
      active: id === current,
    }));
    return { current, projects };
  }

  // ── project_current ───────────────────────────────────────────────────────

  current(): Project {
    const project = getCurrentProject();
    if (!project) {
      const names = listProjectNames();
      const hint = names.length > 0
        ? ` Proyectos disponibles: ${names.join(', ')}.`
        : '';
      throw new Error(`No hay proyecto activo. Usá project_switch o project_create.${hint}`);
    }
    return project;
  }

  // ── project_switch ────────────────────────────────────────────────────────

  switch(name: string): SwitchOutput {
    if (!projectExists(name)) {
      const names = listProjectNames();
      const hint = names.length > 0
        ? ` Disponibles: ${names.join(', ')}.`
        : ' No hay proyectos creados.';
      throw new Error(`Proyecto no encontrado.${hint}`);
    }
    const previous = getCurrentProjectName();
    if (previous === name) {
      return { success: true, previous, current: name };
    }
    setCurrent(name);
    return { success: true, previous, current: name };
  }

  // ── project_create ────────────────────────────────────────────────────────

  create(
    name: string,
    root: string,
    description?: string,
    agents?: Record<string, Partial<AgentConfig>>,
    policies?: { enabled?: string[] },
    gates?: Partial<Project['gates']>,
  ): { success: true; project: Project } {
    if (!name || name.trim().length === 0) {
      throw new Error("El campo 'name' es obligatorio.");
    }
    if (!root || root.trim().length === 0) {
      throw new Error("El campo 'root' es obligatorio.");
    }
    if (projectExists(name)) {
      throw new Error(`Ya existe un proyecto con nombre '${name}'.`);
    }

    // Validate at least backend agent
    const hasBackend = !agents || agents.backend !== undefined;
    if (!hasBackend) {
      throw new Error("Se requiere al menos un agente 'backend'.");
    }

    const project = buildProject(name.trim(), root.trim(), description, agents, policies, gates);
    saveProject(name, project);
    return { success: true, project };
  }

  // ── project_delete ────────────────────────────────────────────────────────

  delete(name: string): DeleteOutput {
    const current = getCurrentProjectName();
    if (current === name) {
      throw new Error('No se puede eliminar el proyecto activo. Usá project_switch primero.');
    }
    if (!projectExists(name)) {
      throw new Error(`Proyecto '${name}' no encontrado.`);
    }
    storeDeleteProject(name);
    return { success: true, deleted: name };
  }

  // ── project_get_agent_config ──────────────────────────────────────────────

  getAgentConfig(agentId: string, projectId?: string): AgentConfig & { root: string } {
    let project: Project | undefined;
    if (projectId) {
      project = getProject(projectId);
      if (!project) {
        throw new Error(`Proyecto '${projectId}' no encontrado.`);
      }
    } else {
      project = getCurrentProject();
      if (!project) {
        const names = listProjectNames();
        const hint = names.length > 0
          ? ` Proyectos disponibles: ${names.join(', ')}.`
          : '';
        throw new Error(`No hay proyecto activo.${hint} Usá project_switch o project_create, o especificá projectId.`);
      }
    }

    const config = project.agents[agentId];
    if (!config) {
      const available = Object.keys(project.agents).join(', ');
      throw new Error(`Agente '${agentId}' no configurado en este proyecto. Agentes disponibles: ${available}.`);
    }

    return {
      ...config,
      root: project.root,
    };
  }

  // ── project_get_root ──────────────────────────────────────────────────────

  getRoot(projectId?: string): RootOutput {
    let project: Project | undefined;
    if (projectId) {
      project = getProject(projectId);
      if (!project) {
        throw new Error(`Proyecto '${projectId}' no encontrado.`);
      }
    } else {
      project = getCurrentProject();
      if (!project) {
        const names = listProjectNames();
        const hint = names.length > 0
          ? ` Proyectos disponibles: ${names.join(', ')}.`
          : '';
        throw new Error(`No hay proyecto activo.${hint} Usá project_switch o project_create, o especificá projectId.`);
      }
    }
    return { root: project.root, name: project.name };
  }

  // ── project_duplicate ─────────────────────────────────────────────────────

  duplicate(name: string, newName: string, newRoot?: string): { success: true; project: Project } {
    const source = getProject(name);
    if (!source) {
      throw new Error(`Proyecto '${name}' no encontrado.`);
    }
    if (projectExists(newName)) {
      throw new Error(`Ya existe un proyecto con nombre '${newName}'.`);
    }

    const namespace = newName;
    const agents: Record<string, AgentConfig> = {};
    for (const [id, config] of Object.entries(source.agents)) {
      agents[id] = { ...config, memoryNamespace: namespace };
    }

    const project: Project = {
      ...source,
      name: newName,
      root: newRoot ?? source.root,
      createdAt: now(),
      updatedAt: now(),
      agents,
      memory: {
        ...source.memory,
        namespace,
      },
    };

    saveProject(newName, project);
    return { success: true, project };
  }

  // ── project_update ────────────────────────────────────────────────────────

  update(name: string, updates: Record<string, unknown>): UpdateOutput {
    const project = getProject(name);
    if (!project) {
      throw new Error(`Proyecto '${name}' no encontrado.`);
    }

    const changes: string[] = [];
    const keys = Object.keys(updates);

    if (keys.length === 0) {
      return { success: true, changes: [] };
    }

    const projectAny = project as Record<string, any>;
    for (const [path, value] of Object.entries(updates)) {
      const oldValue = getNestedValue(projectAny, path);
      setNestedValue(projectAny, path, value);
      const newValue = getNestedValue(projectAny, path);
      changes.push(`${path}: ${JSON.stringify(oldValue)} → ${JSON.stringify(newValue)}`);
    }

    project.updatedAt = now();
    saveProject(name, project);
    return { success: true, changes };
  }

  // ── project_agent_exists ──────────────────────────────────────────────────

  agentExists(agentId: string, projectId?: string): AgentExistsOutput {
    let project: Project | undefined;
    if (projectId) {
      project = getProject(projectId);
    } else {
      project = getCurrentProject();
    }
    if (!project) {
      return { exists: false };
    }
    const config = project.agents[agentId];
    if (!config) {
      return { exists: false };
    }
    return { exists: true, config };
  }

  // ── workspace_policies ────────────────────────────────────────────────────

  policies(domain?: string, keywords?: string[]): PolicyRule[] {
    const project = getCurrentProject();
    const enabledIds = project?.policies.enabled ?? DEFAULT_POLICIES;

    let rules = BUILT_IN_POLICIES.filter((r) => enabledIds.includes(r.id));

    if (domain) {
      rules = rules.filter((r) => !r.if.domain || r.if.domain.includes(domain));
    }
    if (keywords && keywords.length > 0) {
      rules = rules.filter((r) => {
        if (!r.if.keywords || r.if.keywords.length === 0) return true;
        return keywords.some((kw) => r.if.keywords!.includes(kw));
      });
    }

    return rules;
  }

  // ── workspace_gate_config ─────────────────────────────────────────────────

  gateConfig(): GateConfigOutput {
    const project = getCurrentProject();
    if (!project) {
      return { ...DEFAULT_GATES };
    }
    return { ...project.gates };
  }

  // ── workspace_memory_config ───────────────────────────────────────────────

  memoryConfig(): MemoryConfigOutput {
    const project = getCurrentProject();
    if (!project) {
      return { namespace: '', enabled: true };
    }
    return { ...project.memory };
  }
}

// ── Deep set/get helpers ──────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, any>, path: string): unknown {
  const parts = path.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function setNestedValue(obj: Record<string, any>, path: string, value: unknown): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!(part in current) || typeof current[part] !== 'object' || current[part] === null) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}
