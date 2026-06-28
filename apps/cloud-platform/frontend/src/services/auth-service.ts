import { api } from '@/lib/api';
import { AuthResponse, User } from '@/lib/types';

export const authService = {
  async login(email: string, password: string): Promise<AuthResponse> {
    return api.post<AuthResponse>('/auth/login', { email, password }, { skipAuth: true });
  },

  async register(name: string, email: string, password: string): Promise<AuthResponse> {
    return api.post<AuthResponse>('/auth/register', { name, email, password }, { skipAuth: true });
  },

  async getProfile(): Promise<User> {
    return api.get<User>('/auth/profile');
  },
};