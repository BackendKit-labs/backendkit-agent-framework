import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';

const ABAC_URL = process.env['ABAC_URL'] ?? 'http://localhost:3005';

// Roles que vault-manager reconoce (source of truth: lib/permissions.ts)
const KNOWN_ROLES = new Set(['admin', 'development', 'devops', 'hr', 'sales', 'finance', 'viewer']);

function primaryRole(roles: string[]): string {
    for (const r of roles) {
        if (KNOWN_ROLES.has(r)) return r;
    }
    return 'viewer';
}

interface AbacLoginResponse {
    accessToken: string;
    user: {
        id:        string;
        email:     string;
        firstName: string;
        lastName:  string;
        roles:     string[];
    };
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
                    const res = await fetch(`${ABAC_URL}/auth/admin/login`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({
                            email:    credentials.email,
                            password: credentials.password,
                        }),
                        signal: AbortSignal.timeout(5_000),
                    });

                    if (!res.ok) return null;

                    const data = await res.json() as AbacLoginResponse;
                    if (!data.accessToken || !data.user) return null;

                    return {
                        id:        data.user.id,
                        email:     data.user.email,
                        name:      `${data.user.firstName} ${data.user.lastName}`.trim(),
                        role:      primaryRole(data.user.roles),
                        authToken: data.accessToken,
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
            id:         string;
            email:      string;
            name:       string;
            role:       string;
            authToken?: string;
        };
    }
}
