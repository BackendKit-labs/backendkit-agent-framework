import { z } from 'zod';
import type { AgentToolDef } from '@backendkit-labs/mcp-server';

export const generateK8sSchema = {
  projectRoot: z.string().describe('Ruta raíz del proyecto'),
  appName: z.string().describe('Nombre de la aplicación'),
  exposePort: z.number().optional().describe('Puerto de la aplicación (default: 3000)'),
  replicas: z.number().optional().describe('Número de réplicas (default: 2)'),
};

export const generateK8sTool: AgentToolDef<typeof generateK8sSchema> = {
  name: 'generate_k8s',
  description: 'Genera manifiestos Kubernetes para el proyecto (opcional)',
  schema: generateK8sSchema,
  buildPrompt: (args: any) => {
    const { projectRoot, appName, exposePort, replicas } = args;
    const port = exposePort || 3000;
    const reps = replicas || 2;

    return `Generate Kubernetes manifests for "${appName}" application.

Requirements:
- Deployment with ${reps} replicas, port ${port}
- Service (ClusterIP) exposing port ${port}
- ConfigMap for environment variables
- Resource limits and requests
- Liveness and readiness probes
- Rolling update strategy
- Labels and selectors

Generate THREE separate manifests:
1. deployment.yaml
2. service.yaml
3. configmap.yaml

Write to: ${projectRoot}/k8s/

Return: { "success": true, "path": "k8s/", "files": ["deployment.yaml", "service.yaml", "configmap.yaml"] }`;
  },
};
