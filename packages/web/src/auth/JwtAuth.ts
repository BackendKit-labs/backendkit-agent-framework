import jwt from 'jsonwebtoken';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthHook } from '../server/AgentServer';

export interface JwtAuthOptions {
    /** Symmetric secret for HS256/HS384/HS512. */
    secret?: string;
    /** PEM public key for RS256/ES256 etc. */
    publicKey?: string;
    algorithms?: jwt.Algorithm[];
    audience?: string | RegExp | string[];
    issuer?: string;
}

export interface AuthUser {
    sub: string;
    email?: string;
    roles?: string[];
    [key: string]: unknown;
}

// Augment FastifyRequest so downstream handlers can read req.user
declare module 'fastify' {
    interface FastifyRequest {
        user?: AuthUser;
    }
}

/**
 * JWT authentication helper.
 *
 * Reads the token from:
 *  1. Authorization: Bearer <token>   header (REST / MCP)
 *  2. ?token=<jwt>                    query param (browser WebSocket — can't set headers)
 *
 * Usage:
 *   const server = new AgentServer({
 *     auth: new JwtAuth({ secret: process.env.JWT_SECRET! }).hook(),
 *     ...
 *   });
 */
export class JwtAuth {
    constructor(private readonly opts: JwtAuthOptions) {
        if (!opts.secret && !opts.publicKey) {
            throw new Error('JwtAuth: provide either secret (HS*) or publicKey (RS*/ES*)');
        }
    }

    hook(): AuthHook {
        return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
            const token = extractToken(req);
            if (!token) {
                reply.code(401).send({ error: 'Missing authentication token' });
                return;
            }
            try {
                req.user = this.verify(token);
            } catch {
                reply.code(401).send({ error: 'Invalid or expired token' });
            }
        };
    }

    verify(token: string): AuthUser {
        const key = (this.opts.secret ?? this.opts.publicKey)!;
        const payload = jwt.verify(token, key, {
            algorithms: this.opts.algorithms,
            // Cast required: jwt.VerifyOptions.audience is a variadic tuple type
            audience: this.opts.audience as jwt.VerifyOptions['audience'],
            issuer: this.opts.issuer,
        });
        if (typeof payload !== 'object' || !payload) {
            throw new Error('Unexpected JWT payload type');
        }
        return payload as AuthUser;
    }
}

function extractToken(req: FastifyRequest): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    // Browser WebSocket can't set headers — fall back to query param
    const query = req.query as Record<string, string>;
    if (typeof query.token === 'string' && query.token) return query.token;
    return null;
}
