import jwt from 'jsonwebtoken';
import { JwtAuth } from '../auth/JwtAuth';
import type { FastifyRequest, FastifyReply } from 'fastify';

const SECRET = 'test-secret-at-least-32-chars-long!';

function makeReq(overrides: {
    headers?: Record<string, string>;
    query?: Record<string, string>;
} = {}): FastifyRequest {
    return {
        headers: overrides.headers ?? {},
        query:   overrides.query   ?? {},
    } as unknown as FastifyRequest;
}

function makeReply() {
    const r: Record<string, unknown> = {};
    r['code'] = jest.fn().mockReturnValue(r);
    r['send'] = jest.fn().mockReturnValue(r);
    return r as unknown as FastifyReply & { code: jest.Mock; send: jest.Mock };
}

// ── constructor ───────────────────────────────────────────────────────────────

describe('JwtAuth constructor', () => {
    it('throws when neither secret nor publicKey is provided', () => {
        expect(() => new JwtAuth({})).toThrow('provide either secret');
    });

    it('does not throw when secret is provided', () => {
        expect(() => new JwtAuth({ secret: SECRET })).not.toThrow();
    });

    it('does not throw when publicKey is provided', () => {
        const { generateKeyPairSync } = require('crypto') as typeof import('crypto');
        const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
        const pem = publicKey.export({ type: 'pkcs1', format: 'pem' }) as string;
        expect(() => new JwtAuth({ publicKey: pem })).not.toThrow();
    });
});

// ── verify() ─────────────────────────────────────────────────────────────────

describe('JwtAuth.verify()', () => {
    const auth = new JwtAuth({ secret: SECRET });

    it('decodes a valid HS256 token and returns the payload', () => {
        const token = jwt.sign({ sub: 'user-1', email: 'a@b.com', roles: ['admin'] }, SECRET);
        const user = auth.verify(token);
        expect(user.sub).toBe('user-1');
        expect(user.email).toBe('a@b.com');
        expect(user.roles).toEqual(['admin']);
    });

    it('throws on a completely invalid token string', () => {
        expect(() => auth.verify('not.a.token')).toThrow();
    });

    it('throws when the token was signed with a different secret', () => {
        const token = jwt.sign({ sub: 'x' }, 'wrong-secret');
        expect(() => auth.verify(token)).toThrow();
    });

    it('throws on an expired token', () => {
        const token = jwt.sign({ sub: 'x' }, SECRET, { expiresIn: -10 });
        expect(() => auth.verify(token)).toThrow();
    });

    it('validates audience when configured', () => {
        const strictAuth = new JwtAuth({ secret: SECRET, audience: 'my-api' });
        const good = jwt.sign({ sub: 'x', aud: 'my-api' }, SECRET);
        const bad  = jwt.sign({ sub: 'x', aud: 'other'  }, SECRET);
        expect(() => strictAuth.verify(good)).not.toThrow();
        expect(() => strictAuth.verify(bad)).toThrow();
    });

    it('validates issuer when configured', () => {
        const strictAuth = new JwtAuth({ secret: SECRET, issuer: 'auth.example.com' });
        const good = jwt.sign({ sub: 'x' }, SECRET, { issuer: 'auth.example.com' });
        const bad  = jwt.sign({ sub: 'x' }, SECRET, { issuer: 'attacker.com' });
        expect(() => strictAuth.verify(good)).not.toThrow();
        expect(() => strictAuth.verify(bad)).toThrow();
    });
});

// ── hook() ────────────────────────────────────────────────────────────────────

describe('JwtAuth.hook()', () => {
    let auth: JwtAuth;
    let validToken: string;

    beforeEach(() => {
        auth = new JwtAuth({ secret: SECRET });
        validToken = jwt.sign({ sub: 'user-42', roles: ['editor'] }, SECRET);
    });

    it('returns 401 when no token is present in headers or query', async () => {
        const hook  = auth.hook();
        const req   = makeReq();
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith({ error: 'Missing authentication token' });
    });

    it('sets req.user from a valid Authorization: Bearer header', async () => {
        const hook  = auth.hook();
        const req   = makeReq({ headers: { authorization: `Bearer ${validToken}` } });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect(reply.code).not.toHaveBeenCalled();
        expect((req as unknown as { user: { sub: string } }).user.sub).toBe('user-42');
    });

    it('sets req.user from a valid ?token= query param', async () => {
        const hook  = auth.hook();
        const req   = makeReq({ query: { token: validToken } });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect(reply.code).not.toHaveBeenCalled();
        expect((req as unknown as { user: { sub: string } }).user.sub).toBe('user-42');
    });

    it('prefers the Authorization header over the ?token= query param', async () => {
        const otherToken = jwt.sign({ sub: 'interloper' }, SECRET);
        const hook  = auth.hook();
        const req   = makeReq({
            headers: { authorization: `Bearer ${validToken}` },
            query:   { token: otherToken },
        });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        const user = (req as unknown as { user: { sub: string } }).user;
        expect(user.sub).toBe('user-42');
    });

    it('returns 401 when the token is invalid', async () => {
        const hook  = auth.hook();
        const req   = makeReq({ headers: { authorization: 'Bearer invalid.token.payload' } });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    });

    it('returns 401 when the token is expired', async () => {
        const expired = jwt.sign({ sub: 'x' }, SECRET, { expiresIn: -10 });
        const hook    = auth.hook();
        const req     = makeReq({ headers: { authorization: `Bearer ${expired}` } });
        const reply   = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect(reply.code).toHaveBeenCalledWith(401);
        expect(reply.send).toHaveBeenCalledWith({ error: 'Invalid or expired token' });
    });

    it('does not set req.user when auth fails', async () => {
        const hook  = auth.hook();
        const req   = makeReq({ headers: { authorization: 'Bearer bad' } });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        expect((req as unknown as { user?: unknown }).user).toBeUndefined();
    });

    it('ignores an Authorization header that does not start with "Bearer "', async () => {
        const hook  = auth.hook();
        const req   = makeReq({ headers: { authorization: `Basic ${validToken}` } });
        const reply = makeReply();

        await hook(req, reply as unknown as FastifyReply);

        // No token extracted → 401
        expect(reply.code).toHaveBeenCalledWith(401);
    });
});
