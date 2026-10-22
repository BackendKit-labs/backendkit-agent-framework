import { createServer, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

/** What the server does with one request. Behaviours are consumed in order, one per request. */
export type MockBehavior =
    /** A normal answer, streamed as SSE in small chunks. */
    | { kind: 'text'; content: string; chunkSize?: number; usage?: { promptTokens: number; completionTokens: number }; delayMs?: number }
    /** An assistant turn that calls a tool (optionally with some text first). */
    | { kind: 'tool_call'; name: string; args: Record<string, unknown>; id?: string; content?: string; delayMs?: number }
    /** An HTTP error before any streaming (429, 500, 503…). */
    | { kind: 'status'; status: number; message?: string; headers?: Record<string, string>; delayMs?: number }
    /** The connection is dropped before any response. */
    | { kind: 'reset'; delayMs?: number }
    /** The stream starts, `afterChunks` content chunks arrive, then the connection is cut. */
    | { kind: 'cut'; content?: string; afterChunks?: number; delayMs?: number }
    /** The stream starts, `afterChunks` content chunks arrive, then the server sends an error event inside the stream (as OpenAI and DeepSeek do when something fails after the 200). */
    | { kind: 'stream_error'; message?: string; content?: string; afterChunks?: number; delayMs?: number }
    /** A 200 SSE response whose first data line is not valid JSON. */
    | { kind: 'corrupt'; delayMs?: number }
    /** The request is accepted and never answered (until the client aborts or the server closes). */
    | { kind: 'stall' }
    /** The 400 DeepSeek/OpenAI send when the prompt does not fit the context window. */
    | { kind: 'overflow'; limit?: number; requested?: number; delayMs?: number };

export interface CapturedRequest {
    method: string;
    url: string;
    headers: IncomingHttpHeaders;
    /** Parsed JSON body (undefined when it was not JSON). */
    body: any;
}

export interface MockLlmServerOptions {
    /** Behaviours to play, one per request. When used up the server answers 500 "mock script exhausted". */
    script?: MockBehavior[];
    /** Instead of a script: pick a behaviour per request from a seeded generator (reproducible runs). */
    random?: { seed: number; weights?: Partial<Record<Exclude<MockBehavior['kind'], 'stall' | 'tool_call' | 'stream_error'>, number>> };
    port?: number;
}

export interface MockLlmServer {
    /** Base URL to give a provider (`http://127.0.0.1:<port>/v1`). */
    readonly url: string;
    /** Every request received, in order. */
    readonly requests: CapturedRequest[];
    /** Scripted behaviours not consumed yet. */
    remaining(): number;
    close(): Promise<void>;
}

const DEFAULT_WEIGHTS = { text: 6, status: 2, reset: 1, cut: 1, corrupt: 1, overflow: 0 };

function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function randomBehavior(rand: () => number, weights: Record<string, number>): MockBehavior {
    const entries = Object.entries(weights).filter(([, w]) => w > 0);
    let pick = rand() * entries.reduce((n, [, w]) => n + w, 0);
    let kind = entries[0]?.[0] ?? 'text';
    for (const [k, w] of entries) { if ((pick -= w) < 0) { kind = k; break; } }
    switch (kind) {
        case 'status': return { kind: 'status', status: [429, 500, 502, 503][Math.floor(rand() * 4)] };
        case 'reset': return { kind: 'reset' };
        case 'cut': return { kind: 'cut' };
        case 'corrupt': return { kind: 'corrupt' };
        case 'overflow': return { kind: 'overflow' };
        default: return { kind: 'text', content: 'ok from the random mock' };
    }
}

/**
 * Drops the connection with a TCP reset. A plain `destroy()` ends it with a clean FIN on Linux, which
 * some HTTP clients read as the end of the response; a reset is an error on every platform.
 */
function dropConnection(req: IncomingMessage): void {
    const socket = req.socket as Socket & { resetAndDestroy?: () => void };
    if (typeof socket.resetAndDestroy === 'function') socket.resetAndDestroy();
    else socket.destroy();
}

const sse = (res: ServerResponse, data: unknown) => res.write(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);

function chunk(delta: Record<string, unknown>, finish: string | null = null) {
    return { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta, finish_reason: finish }] };
}

function splitText(text: string, size: number): string[] {
    const parts: string[] = [];
    for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
    return parts.length ? parts : [''];
}

function startStream(res: ServerResponse) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
}

function sendError(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}) {
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify({ error: { message, type: status === 400 ? 'invalid_request_error' : 'api_error', param: null, code: status === 400 ? 'invalid_request_error' : null } }));
}

function wantsUsage(body: any): boolean {
    return !!body?.stream_options?.include_usage;
}

function play(b: MockBehavior, req: IncomingMessage, res: ServerResponse, body: any): void {
    const streaming = body?.stream === true;
    switch (b.kind) {
        case 'text': {
            const usage = b.usage ?? { promptTokens: 10, completionTokens: Math.max(1, Math.ceil(b.content.length / 4)) };
            if (!streaming) {
                res.writeHead(200, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ id: 'chatcmpl-mock', object: 'chat.completion', created: 0, model: 'mock',
                    choices: [{ index: 0, message: { role: 'assistant', content: b.content }, finish_reason: 'stop' }],
                    usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.promptTokens + usage.completionTokens } }));
                return;
            }
            startStream(res);
            sse(res, chunk({ role: 'assistant', content: '' }));
            for (const part of splitText(b.content, b.chunkSize ?? 8)) sse(res, chunk({ content: part }));
            sse(res, chunk({}, 'stop'));
            if (wantsUsage(body)) {
                sse(res, { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [],
                    usage: { prompt_tokens: usage.promptTokens, completion_tokens: usage.completionTokens, total_tokens: usage.promptTokens + usage.completionTokens } });
            }
            sse(res, '[DONE]');
            res.end();
            return;
        }
        case 'tool_call': {
            const id = b.id ?? 'call_mock_1';
            const args = JSON.stringify(b.args);
            startStream(res);
            sse(res, chunk({ role: 'assistant', content: b.content ?? null }));
            sse(res, chunk({ tool_calls: [{ index: 0, id, type: 'function', function: { name: b.name, arguments: '' } }] }));
            const mid = Math.ceil(args.length / 2);
            sse(res, chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(0, mid) } }] }));
            sse(res, chunk({ tool_calls: [{ index: 0, function: { arguments: args.slice(mid) } }] }));
            sse(res, chunk({}, 'tool_calls'));
            if (wantsUsage(body)) {
                sse(res, { id: 'chatcmpl-mock', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
            }
            sse(res, '[DONE]');
            res.end();
            return;
        }
        case 'status':
            sendError(res, b.status, b.message ?? `mock error ${b.status}`, b.headers);
            return;
        case 'reset':
            dropConnection(req);
            return;
        case 'cut': {
            startStream(res);
            sse(res, chunk({ role: 'assistant', content: '' }));
            const parts = splitText(b.content ?? 'partial answer that never finishes', 6).slice(0, b.afterChunks ?? 2);
            for (const p of parts) sse(res, chunk({ content: p }));
            // Give the client a moment to read what was sent before the connection dies.
            setTimeout(() => dropConnection(req), 20);
            return;
        }
        case 'stream_error': {
            startStream(res);
            sse(res, chunk({ role: 'assistant', content: '' }));
            for (const p of splitText(b.content ?? 'partial answer that is about to fail', 6).slice(0, b.afterChunks ?? 2)) sse(res, chunk({ content: p }));
            sse(res, { error: { message: b.message ?? 'upstream failure after the stream started', type: 'server_error', code: null } });
            res.end();
            return;
        }
        case 'corrupt':
            startStream(res);
            sse(res, '{this is not json');
            res.end();
            return;
        case 'stall':
            return;
        case 'overflow': {
            const limit = b.limit ?? 1_048_576;
            const requested = b.requested ?? limit + 1_352_000;
            sendError(res, 400, `This model's maximum context length is ${limit} tokens. However, you requested ${requested} tokens (${requested - 16384} in the messages, 16384 in the completion). Please reduce the length of the messages or completion.`);
            return;
        }
    }
}

/**
 * An HTTP server that speaks the OpenAI chat-completions streaming protocol (what OpenAI, DeepSeek and
 * most compatible providers use) and misbehaves on demand. Point a real provider at `server.url` to
 * test retries, aborts, mid-stream failures and context overflow without a network or an API key.
 */
export async function startMockLlmServer(options: MockLlmServerOptions = {}): Promise<MockLlmServer> {
    const script = [...(options.script ?? [])];
    const rand = options.random ? mulberry32(options.random.seed) : undefined;
    const weights = { ...DEFAULT_WEIGHTS, ...(options.random?.weights ?? {}) };
    const requests: CapturedRequest[] = [];
    const sockets = new Set<Socket>();

    const server = createServer((req, res) => {
        const parts: Buffer[] = [];
        req.on('data', d => parts.push(d));
        req.on('end', () => {
            let body: any;
            try { body = JSON.parse(Buffer.concat(parts).toString('utf8')); } catch { body = undefined; }
            requests.push({ method: req.method ?? 'GET', url: req.url ?? '', headers: req.headers, body });
            if (req.method !== 'POST' || !(req.url ?? '').split('?')[0].endsWith('/chat/completions')) {
                sendError(res, 404, `mock server: no route for ${req.method} ${req.url}`);
                return;
            }
            const behavior = rand ? randomBehavior(rand, weights) : script.shift();
            if (!behavior) { sendError(res, 500, 'mock script exhausted'); return; }
            const delay = 'delayMs' in behavior ? behavior.delayMs ?? 0 : 0;
            if (delay > 0) setTimeout(() => play(behavior, req, res, body), delay);
            else play(behavior, req, res, body);
        });
    });
    server.on('connection', s => { sockets.add(s); s.on('close', () => sockets.delete(s)); });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('mock server: no address');

    return {
        url: `http://127.0.0.1:${address.port}/v1`,
        requests,
        remaining: () => script.length,
        close: () => new Promise<void>(resolve => {
            for (const s of sockets) s.destroy();
            server.close(() => resolve());
        }),
    };
}
