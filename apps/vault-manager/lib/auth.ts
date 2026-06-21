import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';

// hashPassword y verifyPassword eliminados — auth delegada al auth-service.

const AUTH_SERVICE_URL = process.env['AUTH_SERVICE_URL'] ?? 'http://localhost:4000';

interface AuthServiceUser {
    id:             string;
    username:       string;
    name?:          string;
    email?:         string;
    role:           string;
    department?:    string;
    active:         boolean;
    canUseVault:    boolean;
    canUseDirector: boolean;
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                email:    { label: 'Usuario', type: 'text' },
                password: { label: 'Contraseña', type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;

                try {
                    const res = await fetch(`${AUTH_SERVICE_URL}/api/auth/login`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            username: credentials.email,   // el form usa 'email' como campo
                            password: credentials.password,
                        }),
                        signal: AbortSignal.timeout(5_000),
                    });

                    if (!res.ok) return null;

                    const data = await res.json() as { token?: string; user?: AuthServiceUser; error?: string };
                    if (!data.token || !data.user) return null;

                    // Solo permitir acceso si el usuario tiene habilitado Vault Manager
                    if (!data.user.canUseVault) return null;
                    if (!data.user.active) return null;

                    return {
                        id:         data.user.username,
                        email:      data.user.email ?? data.user.username,
                        name:       data.user.name  ?? data.user.username,
                        role:       data.user.role,
                        department: data.user.department,
                        authToken:  data.token,   // JWT del auth-service para llamadas API
                    };
                } catch {
                    return null;
                }
            },
        }),
    ],
});

declare module 'next-auth' {
    interface Session {
        user: {
            id:          string;
            email:       string;
            name:        string;
            role:        string;
            department?: string;
            authToken?:  string;
        };
    }
}
