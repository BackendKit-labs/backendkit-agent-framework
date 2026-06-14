import type { NextAuthConfig } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';

export const authConfig = {
    providers: [Credentials({})],
    callbacks: {
        jwt({ token, user }) {
            if (user) token.role = (user as { role?: string }).role;
            return token;
        },
        session({ session, token }) {
            if (session.user) (session.user as { role?: unknown }).role = token.role;
            return session;
        },
        authorized({ auth }) {
            return !!auth?.user;
        },
    },
    pages: { signIn: '/login' },
    session: { strategy: 'jwt' },
} satisfies NextAuthConfig;
