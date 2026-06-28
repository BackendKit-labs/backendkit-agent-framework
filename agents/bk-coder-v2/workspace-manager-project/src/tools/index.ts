import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WorkspaceManager } from '../WorkspaceManager.js';
import { listInputSchema, listHandler } from './list.js';
import { currentInputSchema, currentHandler } from './current.js';
import { switchInputSchema, switchHandler } from './switch.js';
import { createInputSchema, createHandler } from './create.js';
import { deleteInputSchema, deleteHandler } from './delete.js';
import { getAgentConfigInputSchema, getAgentConfigHandler } from './getAgentConfig.js';
import { getRootInputSchema, getRootHandler } from './getRoot.js';
import { duplicateInputSchema, duplicateHandler } from './duplicate.js';
import { updateInputSchema, updateHandler } from './update.js';
import { agentExistsInputSchema, agentExistsHandler } from './agentExists.js';
import { policiesInputSchema, policiesHandler } from './policies.js';
import { gateConfigInputSchema, gateConfigHandler } from './gateConfig.js';
import { memoryConfigInputSchema, memoryConfigHandler } from './memoryConfig.js';
import { writeSpecsInputSchema, writeSpecsHandler } from './writeSpecs.js';

// ── Tool registration ─────────────────────────────────────────────────────────

export function registerTools(server: McpServer, wm: WorkspaceManager): void {
  // Helper to register a tool with error handling
  function register(
    name: string,
    description: string,
    schema: Record<string, unknown>,
    handler: (args: any) => Promise<string>,
  ): void {
    server.tool(name, description, schema, async (args: any) => {
      try {
        const text = await handler(args);
        return { content: [{ type: 'text' as const, text }] };
      } catch (err: any) {
        const errorText = JSON.stringify({ error: err.message || String(err) });
        return { content: [{ type: 'text' as const, text: errorText }], isError: true };
      }
    });
  }

  register('project_list', 'Lista todos los proyectos disponibles', listInputSchema.shape, (args) =>
    listHandler(args, wm),
  );

  register('project_current', 'Devuelve el proyecto activo completo', currentInputSchema.shape, (args) =>
    currentHandler(args, wm),
  );

  register('project_switch', 'Cambia el proyecto activo', switchInputSchema.shape, (args) =>
    switchHandler(args, wm),
  );

  register('project_create', 'Crea un nuevo proyecto', createInputSchema.shape, (args) =>
    createHandler(args, wm),
  );

  register('project_delete', 'Elimina un proyecto (no el activo)', deleteInputSchema.shape, (args) =>
    deleteHandler(args, wm),
  );

  register(
    'project_get_agent_config',
    'Devuelve la configuración de un agente en el proyecto activo o especificado',
    getAgentConfigInputSchema.shape,
    (args) => getAgentConfigHandler(args, wm),
  );

  register('project_get_root', 'Devuelve el root del proyecto activo o especificado', getRootInputSchema.shape, (args) =>
    getRootHandler(args, wm),
  );

  register('project_duplicate', 'Duplica un proyecto como template', duplicateInputSchema.shape, (args) =>
    duplicateHandler(args, wm),
  );

  register(
    'project_update',
    'Actualiza configuración parcial de un proyecto (merge con notación de path)',
    updateInputSchema.shape,
    (args) => updateHandler(args, wm),
  );

  register(
    'project_agent_exists',
    'Verifica si un agente existe en el proyecto activo o especificado',
    agentExistsInputSchema.shape,
    (args) => agentExistsHandler(args, wm),
  );

  register(
    'workspace_policies',
    'Devuelve las políticas activas, opcionalmente filtradas por dominio o keywords',
    policiesInputSchema.shape,
    (args) => policiesHandler(args, wm),
  );

  register('workspace_gate_config', 'Devuelve la configuración de gates del proyecto activo', gateConfigInputSchema.shape, (args) =>
    gateConfigHandler(args, wm),
  );

  register(
    'workspace_memory_config',
    'Devuelve el namespace de memoria del proyecto activo',
    memoryConfigInputSchema.shape,
    (args) => memoryConfigHandler(args, wm),
  );

  register(
    'project_write_specs',
    'Escribe los artefactos de diseño (specification.md / design.md / ROADMAP.md) autorados por el director ' +
    'en <root>/.specs/ del proyecto bindeado. El director (que tiene el contexto humano) AUTORA el contenido; ' +
    'el coder luego ejecuta orchestrator_sdd leyendo .specs SIN re-generar el diseño. Pasá projectId explícito ' +
    'con múltiples proyectos. El ROADMAP debe declarar "**Domain:**" por fase y design.md una "## Project Structure".',
    writeSpecsInputSchema.shape,
    (args) => writeSpecsHandler(args, wm),
  );
}
