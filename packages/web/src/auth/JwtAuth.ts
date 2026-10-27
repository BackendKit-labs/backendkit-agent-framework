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
    /**
     * Accept the token in the `?token=` query parameter. Default: true. A token in a URL ends up in access logs,
     * proxies and browser history; set false and send it as `Authorization: Bearer` or, from a browser
     * WebSocket, as the subprotocol `bearer, <jwt>` (`new WebSocket(url, ['bearer', jwt])`).
     */
    allowQueryToken?: boolean;
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
 *  2. Sec-WebSocket-Protocol: bearer, <jwt>   (browser WebSocket — can't set headers)
 *  3. ?token=<jwt>                    query param, unless `allowQueryToken` is false
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
            const token = extractToken(req, this.opts.allowQueryToken !== false);
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

function extractToken(req: FastifyRequest, allowQueryToken: boolean): string | null {
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    // Browser WebSocket can't set headers: the token rides as the second subprotocol, `bearer, <jwt>`.
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '').split(',').map(p => p.trim());
    if (protocols[0] === 'bearer' && protocols[1]) return protocols[1];
    if (!allowQueryToken) return null;
    const query = (req.query ?? {}) as Record<string, string>;
    if (typeof query.token === 'string' && query.token) return query.token;
    return null;
}
