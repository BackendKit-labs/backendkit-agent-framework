// ---------------------------------------------------------------------------
// Tools — Schemas Zod + buildPrompt para AgentMCPServer
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const tools = [
  {
    name: 'system_health',
    description: 'Reporte completo de salud del ecosistema BackendKit',
    schema: {},
    buildPrompt: () =>
      'Ejecuta system_health: reporte completo de salud del ecosistema BackendKit',
  },
  {
    name: 'check_agent',
    description: 'Verifica el estado de un agente específico del ecosistema',
    schema: { agent_id: z.string() },
    buildPrompt: (args: { agent_id: string }) =>
      `Ejecuta check_agent para el agente: ${args.agent_id}`,
  },
  {
    name: 'check_environment',
    description:
      'Obtiene métricas del sistema local (CPU, RAM, disco, procesos)',
    schema: {},
    buildPrompt: () =>
      'Ejecuta check_environment: métricas del sistema local',
  },
  {
    name: 'check_messaging',
    description: 'Verifica la conectividad al broker de mensajería',
    schema: {},
    buildPrompt: () =>
      'Ejecuta check_messaging: verificar conectividad al broker',
  },
  {
    name: 'check_scheduler',
    description:
      'Lee las tareas del scheduler-agent y reporta su estado',
    schema: {},
    buildPrompt: () =>
      'Ejecuta check_scheduler: leer tareas del scheduler-agent',
  },
  {
    name: 'check_vault',
    description: 'Verifica el estado del vault de codex (notas indexadas)',
    schema: {},
    buildPrompt: () => 'Ejecuta check_vault: verificar vault de codex',
  },
  {
    name: 'end_to_end_test',
    description:
      'Ejecuta un test de integración end-to-end creando y ejecutando un flow de prueba',
    schema: { flow_id: z.string().optional() },
    buildPrompt: (args: { flow_id?: string }) =>
      `Ejecuta end_to_end_test${
        args.flow_id ? ' para flow: ' + args.flow_id : ''
      }`,
  },
];
