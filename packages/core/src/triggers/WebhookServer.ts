import http from 'http';
import crypto from 'crypto';

type WebhookHandler = (body: unknown, headers: Record<string, string>) => void;

interface Route {
    path: string;
    secret?: string;
    handler: WebhookHandler;
}

const DEFAULT_MAX_BODY_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Lightweight HTTP server that routes POST requests to registered webhook handlers.
 * Supports GitHub-style HMAC-SHA256 signature verification.
 */
export class WebhookServer {
    private readonly routes: Route[] = [];
    private server: http.Server | null = null;
    private readonly maxBodyBytes: number;

    constructor(private readonly port: number, opts?: { maxBodyBytes?: number }) {
        this.maxBodyBytes = opts?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    }

    register(path: string, handler: WebhookHandler, secret?: string): void {
        this.routes.push({ path, secret, handler });
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(err => {
                    if (!res.headersSent) {
                        const status = (err as { code?: number }).code === 413 ? 413 : 500;
                        res.writeHead(status);
                        res.end(status === 413 ? 'Payload Too Large' : 'Internal Server Error');
                    }
                    if ((err as { code?: number }).code !== 413) {
                        console.error('[WebhookServer]', err);
                    }
                });
            });
            this.server.listen(this.port, () => resolve());
            this.server.once('error', reject);
        });
    }

    stop(): Promise<void> {
        return new Promise((resolve, reject) => {
            if (!this.server) { resolve(); return; }
            this.server.close(err => err ? reject(err) : resolve());
            this.server = null;
        });
    }

    // ── Private ────────────────────────────────────────────────────────────────

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        if (req.method !== 'POST') {
            res.writeHead(405);
            res.end('Method Not Allowed');
            return;
        }

        const route = this.routes.find(r => r.path === req.url);
        if (!route) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }

        const rawBody = await this.readBody(req);
        const headers = this.normalizeHeaders(req.headers);

        if (route.secret) {
            const sig = headers['x-hub-signature-256'];
            if (!sig || !this.verifySignature(route.secret, rawBody, sig)) {
                res.writeHead(401);
                res.end('Unauthorized');
                return;
            }
        }

        let body: unknown;
        try { body = JSON.parse(rawBody); } catch { body = rawBody; }

        // Respond immediately — handler runs asynchronously
        res.writeHead(202);
        res.end('Accepted');

        route.handler(body, headers);
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let totalBytes = 0;
            req.on('data', (chunk: Buffer) => {
                totalBytes += chunk.length;
                if (totalBytes > this.maxBodyBytes) {
                    req.destroy();
                    reject(Object.assign(new Error('Request body too large'), { code: 413 }));
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
            req.on('error', reject);
        });
    }

    private normalizeHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(raw)) {
            if (typeof v === 'string') out[k] = v;
            else if (Array.isArray(v)) out[k] = v.join(', ');
        }
        return out;
    }

    private verifySignature(secret: string, body: string, signature: string): boolean {
        const expected = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`;
        try {
            return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
        } catch {
            return false;
        }
    }
}
