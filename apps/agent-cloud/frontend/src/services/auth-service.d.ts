import { AuthResponse, User } from '@/lib/types';
export declare const authService: {
    login(email: string, password: string): Promise<AuthResponse>;
    register(name: string, email: string, password: string): Promise<AuthResponse>;
    getProfile(): Promise<User>;
};
