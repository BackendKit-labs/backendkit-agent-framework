import { defineTool } from '@backendkit-labs/agent-core';
import { z } from 'zod';
import { getConfig } from './tools/getConfig.js';
import { listConfigs } from './tools/listConfigs.js';
import { diffConfig } from './tools/diffConfig.js';
import { getConfigSchema } from './tools/getConfigSchema.js';
import { setConfig } from './tools/setConfig.js';
import { setSecret } from './tools/setSecret.js';
import { importConfig } from './tools/importConfig.js';
import { restoreConfig } from './tools/restoreConfig.js';
import { commitConfig } from './tools/commitConfig.js';
import { validateConfig } from './tools/validateConfig.js';
import { reloadConfig } from './tools/reloadConfig.js';
import { detectEnv } from './tools/detectEnv.js';
import { serveConfigUi } from './web/server.js';

export const tools = [
  // Tools de lectura (Fase 4)
  defineTool({
    name: 'get_config',
    description: 'Obtener configuración de un agente',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      key: z.string().optional().describe('Clave específica (opcional)'),
      version: z.string().optional().describe('Versión específica (opcional, default: current)'),
      includeSecrets: z.boolean().optional().describe('Incluir secrets desencriptados'),
    }),
    execute: async (input) => JSON.stringify(await getConfig(input)),
  }),
  defineTool({
    name: 'list_configs',
    description: 'Listar configuración de un agente con metadata',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
    }),
    execute: async (input) => JSON.stringify(await listConfigs(input)),
  }),
  defineTool({
    name: 'diff_config',
    description: 'Comparar dos versiones de configuración',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      version_a: z.string().describe('Primera versión'),
      version_b: z.string().describe('Segunda versión'),
      format: z.enum(['structured', 'text']).optional().describe('Formato del diff'),
    }),
    execute: async (input) => JSON.stringify(await diffConfig(input)),
  }),
  defineTool({
    name: 'get_config_schema',
    description: 'Obtener schema de configuración de un agente',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
    }),
    execute: async (input) => JSON.stringify(await getConfigSchema(input)),
  }),

  // Tools de escritura (Fase 5)
  defineTool({
    name: 'set_config',
    description: 'Establecer un valor de configuración',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      key: z.string().describe('Clave a configurar'),
      value: z.any().describe('Valor a establecer'),
      message: z.string().optional().describe('Mensaje para el changelog'),
      reload: z.boolean().optional().describe('Recargar config en el agente'),
    }),
    execute: async (input) => JSON.stringify(await setConfig(input)),
  }),
  defineTool({
    name: 'set_secret',
    description: 'Guardar un secreto encriptado',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      key: z.string().describe('Clave del secreto'),
      value: z.string().describe('Valor del secreto (se encripta automáticamente)'),
      message: z.string().optional().describe('Mensaje para el changelog'),
      reload: z.boolean().optional().describe('Recargar config en el agente'),
    }),
    execute: async (input) => JSON.stringify(await setSecret(input)),
  }),
  defineTool({
    name: 'import_config',
    description: 'Importar configuración batch',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      format: z.enum(['json', 'env']).describe('Formato del contenido'),
      content: z.string().describe('Contenido a importar'),
      mode: z.enum(['merge', 'overwrite', 'dry-run']).describe('Modo de importación'),
      message: z.string().optional().describe('Mensaje para el changelog'),
      reload: z.boolean().optional().describe('Recargar config en el agente'),
    }),
    execute: async (input) => JSON.stringify(await importConfig(input)),
  }),
  defineTool({
    name: 'restore_config',
    description: 'Restaurar una versión anterior (crea nueva versión, no muta)',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      version: z.string().describe('Versión a restaurar (ej: v2)'),
      reload: z.boolean().optional().describe('Recargar config en el agente'),
    }),
    execute: async (input) => JSON.stringify(await restoreConfig(input)),
  }),
  defineTool({
    name: 'commit_config',
    description: 'Versionar explícitamente con mensaje',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      message: z.string().describe('Mensaje del commit'),
    }),
    execute: async (input) => JSON.stringify(await commitConfig(input)),
  }),

  // Tools de operación (Fase 6)
  defineTool({
    name: 'validate_config',
    description: 'Validar configuración de un agente contra su schema',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      version: z.string().optional().describe('Versión a validar (opcional, default: current)'),
    }),
    execute: async (input) => JSON.stringify(await validateConfig(input)),
  }),
  defineTool({
    name: 'reload_config',
    description: 'Notificar a un agente que recargue su configuración',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
    }),
    execute: async (input) => JSON.stringify(await reloadConfig(input)),
  }),
  defineTool({
    name: 'detect_env',
    description: 'Detectar variables de entorno y guardarlas como configuración',
    input: z.object({
      agent_id: z.string().describe('ID del agente'),
      prefix: z.string().optional().describe('Prefijo para filtrar env vars'),
      save: z.boolean().optional().describe('Guardar cambios (default: true)'),
      mode: z.enum(['merge', 'overwrite']).optional().describe('Modo de guardado (default: merge)'),
    }),
    execute: async (input) => JSON.stringify(await detectEnv(input)),
  }),

  // Tools de interfaz web (Fase 7)
  defineTool({
    name: 'serve_config_ui',
    description: 'Iniciar interfaz web de configuración',
    input: z.object({
      agent_id: z.string().optional().describe('Agente específico (opcional, muestra todos)'),
      port: z.number().optional().describe('Puerto (default: 3456)'),
      theme: z.enum(['light', 'dark']).optional().describe('Tema visual'),
      autoOpen: z.boolean().optional().describe('Abrir navegador automáticamente'),
    }),
    execute: async (input) => JSON.stringify(await serveConfigUi(input)),
  }),
];
