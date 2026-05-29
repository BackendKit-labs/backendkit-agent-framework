import http from 'http';
import crypto from 'crypto';

type WebhookHandler = (body: unknown, headers: Record<string, string>) => void;

interface Route {
    path: string;
    secret?: string;
    handler: WebhookHandler;
}

/**
 * Lightweight HTTP server that routes POST requests to registered webhook handlers.
 * Supports GitHub-style HMAC-SHA256 signature verification.
 */
export class WebhookServer {
    private readonly routes: Route[] = [];
    private server: http.Server | null = null;

    constructor(private readonly port: number) {}

    register(path: string, handler: WebhookHandler, secret?: string): void {
        this.routes.push({ path, secret, handler });
    }

    start(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.server = http.createServer((req, res) => {
                this.handleRequest(req, res).catch(err => {
                    res.writeHead(500);
                    res.end('Internal Server Error');
                    console.error('[WebhookServer]', err);
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
            req.on('data', chunk => chunks.push(chunk as Buffer));
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
