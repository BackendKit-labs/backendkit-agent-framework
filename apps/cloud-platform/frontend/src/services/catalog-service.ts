import { api } from '@/lib/api';
import { CatalogEntry, CatalogEntryPayload } from '@/lib/types';

export const catalogService = {
  list(category?: string): Promise<CatalogEntry[]> {
    return api.get<CatalogEntry[]>('/catalog', {
      params: category ? { category } : undefined,
    });
  },

  get(id: string): Promise<CatalogEntry> {
    return api.get<CatalogEntry>(`/catalog/${id}`);
  },

  create(payload: CatalogEntryPayload): Promise<CatalogEntry> {
    return api.post<CatalogEntry>('/catalog', payload);
  },

  update(id: string, payload: Partial<CatalogEntryPayload>): Promise<CatalogEntry> {
    return api.patch<CatalogEntry>(`/catalog/${id}`, payload);
  },

  remove(id: string): Promise<void> {
    return api.delete<void>(`/catalog/${id}`);
  },
};
