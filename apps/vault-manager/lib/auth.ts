import 'server-only';
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { db, schema } from '@/db';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { authConfig } from './auth.config';

function hashPassword(password: string): string {
    return crypto.createHash('sha256').update(password + (process.env.AUTH_SALT ?? 'bk-vault-salt')).digest('hex');
}

export function verifyPassword(password: string, hash: string): boolean {
    return hashPassword(password) === hash;
}

export { hashPassword };

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                email:    { label: 'Email',    type: 'email' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) return null;
                const user = await db.query.users.findFirst({
                    where: eq(schema.users.email, credentials.email as string),
                });
                if (!user || !user.active) return null;
                if (!verifyPassword(credentials.password as string, user.passwordHash)) return null;
                return { id: user.id, email: user.email, name: user.name, role: user.role };
            },
        }),
    ],
});

declare module 'next-auth' {
    interface Session {
        user: { id: string; email: string; name: string; role: string };
    }
}
