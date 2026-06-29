import { api } from '@/lib/api';
import { AbacAuthResponse } from '@/lib/types';

export const authService = {
  async login(email: string, password: string): Promise<AbacAuthResponse> {
    return api.post<AbacAuthResponse>('/auth/admin/login', { email, password }, { skipAuth: true });
  },
};
