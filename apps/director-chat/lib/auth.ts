import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';

const ABAC_URL = process.env.ABAC_URL ?? 'http://localhost:3005';

interface AbacLoginResponse {
    accessToken: string;
    user: {
        id:          string;
        email:       string;
        firstName:   string;
        lastName:    string;
        roles:       string[];
        department?: string | null;
    };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                email:    { label: 'Email',       type: 'text'     },
                password: { label: 'Contraseña',  type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;
                try {
                    const res = await fetch(`${ABAC_URL}/auth/admin/login`, {
                        method:  'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body:    JSON.stringify({ email: credentials.email, password: credentials.password }),
                        signal:  AbortSignal.timeout(5_000),
                    });
                    if (!res.ok) return null;
                    const data = await res.json() as AbacLoginResponse;
                    if (!data.accessToken || !data.user) return null;
                    return {
                        id:         data.user.id,
                        email:      data.user.email,
                        name:       `${data.user.firstName} ${data.user.lastName}`.trim(),
                        roles:      data.user.roles,
                        department: data.user.department ?? null,
                        authToken:  data.accessToken,
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
            roles:       string[];
            department:  string | null;
            authToken?:  string;
        };
    }
}
