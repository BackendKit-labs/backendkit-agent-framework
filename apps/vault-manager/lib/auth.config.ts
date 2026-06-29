import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const authConfig = {
    providers: [Credentials({})],
    callbacks: {
        jwt({ token, user }) {
            if (user) {
                const u = user as { role?: string; authToken?: string };
                token.role      = u.role;
                token.authToken = u.authToken;
            }
            return token;
        },
        session({ session, token }) {
            if (session.user) {
                const s = session.user as { role?: unknown; authToken?: unknown };
                s.role      = token.role;
                s.authToken = token.authToken;
            }
            return session;
        },
        authorized({ auth: session }) {
            return !!session?.user;
        },
    },
    pages: { signIn: '/login' },
    session: { strategy: 'jwt' },
} satisfies NextAuthConfig;
