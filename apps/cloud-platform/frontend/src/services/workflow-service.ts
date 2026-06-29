import { api } from '@/lib/api';
import { Workflow, WorkflowPayload, WorkflowRun } from '@/lib/types';

export interface WorkflowQuery {
  departmentId?: string;
  status?: string;
}

export const workflowService = {
  list(query: WorkflowQuery = {}): Promise<Workflow[]> {
    return api.get<Workflow[]>('/workflows', { params: { ...query } });
  },

  get(id: string): Promise<Workflow> {
    return api.get<Workflow>(`/workflows/${id}`);
  },

  create(payload: WorkflowPayload): Promise<Workflow> {
    return api.post<Workflow>('/workflows', payload);
  },

  update(id: string, payload: Partial<WorkflowPayload>): Promise<Workflow> {
    return api.patch<Workflow>(`/workflows/${id}`, payload);
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/workflows/${id}`);
  },

  // ── Runs (la ejecución la hace un orquestador externo; aquí gestionamos estado) ──
  run(id: string, input?: Record<string, unknown>): Promise<WorkflowRun> {
    return api.post<WorkflowRun>(`/workflows/${id}/run`, input ? { input } : {});
  },

  listRuns(id: string): Promise<WorkflowRun[]> {
    return api.get<WorkflowRun[]>(`/workflows/${id}/runs`);
  },
};
