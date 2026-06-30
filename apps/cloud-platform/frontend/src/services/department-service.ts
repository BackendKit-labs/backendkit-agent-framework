import { api } from '@/lib/api';
import {
  Department,
  DepartmentRef,
  DepartmentPayload,
  SecretRef,
  PaginatedResponse,
} from '@/lib/types';

export interface DepartmentQuery {
  page?: number;
  limit?: number;
  search?: string;
}

export const departmentService = {
  // Página de gestión: lista paginada con búsqueda.
  paged(query: DepartmentQuery = {}): Promise<PaginatedResponse<Department>> {
    return api.get<PaginatedResponse<Department>>('/departments', { params: { ...query } });
  },

  // Lista plana (para poblar selects en otras páginas). Normaliza la respuesta paginada.
  async list(): Promise<DepartmentRef[]> {
    const res = await api.get<PaginatedResponse<DepartmentRef> | DepartmentRef[]>(
      '/departments',
      { params: { limit: 100 } },
    );
    if (Array.isArray(res)) return res;
    return res.data ?? [];
  },

  get(id: string): Promise<Department> {
    return api.get<Department>(`/departments/${id}`);
  },

  create(payload: DepartmentPayload): Promise<Department> {
    return api.post<Department>('/departments', payload);
  },

  update(id: string, payload: Partial<DepartmentPayload>): Promise<Department> {
    return api.patch<Department>(`/departments/${id}`, payload);
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/departments/${id}`);
  },

  // ── Secrets (el backend nunca devuelve valores) ──────────────────────────
  listSecrets(id: string): Promise<SecretRef[]> {
    return api.get<SecretRef[]>(`/departments/${id}/secrets`);
  },

  setSecret(id: string, key: string, value: string): Promise<{ id: string; key: string }> {
    return api.post<{ id: string; key: string }>(`/departments/${id}/secrets`, { key, value });
  },

  removeSecret(id: string, key: string): Promise<void> {
    return api.delete<void>(`/departments/${id}/secrets/${key}`);
  },
};
