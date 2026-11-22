/** Audit 2026-11: a request body is bounded, and a failure does not hand its internal message to the client. */
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { BodyTooLargeError, readJsonBody, replyRequestError } from '../request-guards';
import { isAuthorized } from '../agent-server';

const req = (...chunks: string[]): IncomingMessage => Readable.from(chunks.map(c => Buffer.from(c))) as unknown as IncomingMessage;

describe('readJsonBody', () => {
    it('parses a body and treats an empty one as undefined', async () => {
        await expect(readJsonBody(req('{"a":', '1}'))).resolves.toEqual({ a: 1 });
        await expect(readJsonBody(req())).resolves.toBeUndefined();
    });
    it('refuses a body over the limit instead of holding it', async () => {
        await expect(readJsonBody(req('x'.repeat(60), 'y'.repeat(60)), 100)).rejects.toBeInstanceOf(BodyTooLargeError);
    });
    it('a body that is not JSON is a SyntaxError', async () => {
        await expect(readJsonBody(req('{nope'))).rejects.toBeInstanceOf(SyntaxError);
    });
});

describe('replyRequestError', () => {
    const res = () => {
        const out: { status?: number; body?: string } = {};
        const r = { headersSent: false, writeHead: (s: number) => { out.status = s; }, end: (b: string) => { out.body = b; } } as unknown as ServerResponse;
        return { r, out };
    };
    it('413 / 400 / 500 by class, and the internal message never reaches the client', () => {
        const log = jest.fn();
        const a = res(); replyRequestError(a.r, new BodyTooLargeError(10), log);
        const b = res(); replyRequestError(b.r, new SyntaxError('Unexpected token'), log);
        const c = res(); replyRequestError(c.r, new Error('ECONNREFUSED 10.0.0.5:5432 password=hunter2'), log);
        expect([a.out.status, b.out.status, c.out.status]).toEqual([413, 400, 500]);
        expect(c.out.body).toBe('{"error":"Internal server error"}');
        expect(log).toHaveBeenCalledWith(expect.stringContaining('hunter2'));        // the detail is logged on our side
    });
});

describe('isAuthorized scheme', () => {
    it('is case-insensitive about "Bearer", as RFC 7235 says, and still exact about the token', () => {
        expect(isAuthorized('bearer secret', 'secret')).toBe(true);
        expect(isAuthorized('BEARER secret', 'secret')).toBe(true);
        expect(isAuthorized('bearer nope', 'secret')).toBe(false);
    });
});
