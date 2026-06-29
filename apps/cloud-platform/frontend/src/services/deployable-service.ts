import { api } from '@/lib/api';
import { Deployable, DeployablePayload, PaginatedResponse } from '@/lib/types';

export interface DeployableQuery {
  page?: number;
  limit?: number;
  search?: string;
  kind?: string;
  status?: string;
  departmentId?: string;
}

export const deployableService = {
  list(query: DeployableQuery = {}): Promise<PaginatedResponse<Deployable>> {
    return api.get<PaginatedResponse<Deployable>>('/deployables', { params: { ...query } });
  },

  get(id: string): Promise<Deployable> {
    return api.get<Deployable>(`/deployables/${id}`);
  },

  create(payload: DeployablePayload): Promise<Deployable> {
    return api.post<Deployable>('/deployables', payload);
  },

  update(id: string, payload: Partial<DeployablePayload>): Promise<Deployable> {
    return api.patch<Deployable>(`/deployables/${id}`, payload);
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/deployables/${id}`);
  },
};
