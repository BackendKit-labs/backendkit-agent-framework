import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CodexAuditLogger, buildCodexAuditPath } from '../audit.js';
import { KnowledgeSynthesizer } from '../knowledge/synthesis.js';
import { createProvider, OpenAIAdapter, AnthropicAdapter } from '../providers/index.js';
import type { CuratorLLMProvider } from '../providers/types.js';
import type { RagSearchResult } from '../knowledge/rag-provider.js';

let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'curator2-')); });
afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

describe('CodexAuditLogger', () => {
    it('appends NDJSON entries stamped with ts and project, creating parent dirs', async () => {
        const log = new CodexAuditLogger(path.join(dir, 'deep', 'a.ndjson'), 'proj');
        await log.log({ event: 'vault.search', query: 'q' });
        await log.log({ event: 'note.read', path: 'a.md', status: 'done' });
        const all = await log.readAll();
        expect(all.map(e => e.event)).toEqual(['vault.search', 'note.read']);
        expect(all[0]).toMatchObject({ project: 'proj', query: 'q' });
        expect(Date.parse(all[0].ts)).not.toBeNaN();
    });

    it('readAll returns [] when the file does not exist', async () => {
        expect(await new CodexAuditLogger(path.join(dir, 'none.ndjson'), 'p').readAll()).toEqual([]);
    });

    it('readAll skips a truncated line instead of discarding the whole log', async () => {
        const file = path.join(dir, 'a.ndjson');
        const log = new CodexAuditLogger(file, 'p');
        await log.log({ event: 'vault.search' });
        await fs.appendFile(file, '{"ts":"2026-01-01","event":"note.re\n'); // crash mid-write
        await log.log({ event: 'vault.reset' });
        expect((await log.readAll()).map(e => e.event)).toEqual(['vault.search', 'vault.reset']);
    });

    it('write() is fire-and-forget and eventually persists', async () => {
        const log = new CodexAuditLogger(path.join(dir, 'w.ndjson'), 'p');
        log.write({ event: 'embedder.init' });
        for (let i = 0; i < 50 && (await log.readAll()).length === 0; i++) await new Promise(r => setTimeout(r, 10));
        expect(await log.readAll()).toHaveLength(1);
    });

    it('buildCodexAuditPath honours a custom path, else uses ~/.backendkit/audit', () => {
        expect(buildCodexAuditPath('p', 'x/y.ndjson')).toBe(path.resolve('x/y.ndjson'));
        expect(buildCodexAuditPath('p')).toBe(path.join(os.homedir(), '.backendkit', 'audit', 'codex-p.ndjson'));
    });
});

describe('KnowledgeSynthesizer', () => {
    const results = (...contents: string[]): RagSearchResult[] =>
        contents.map((c, i) => ({ title: `Doc ${i}`, content: c })) as unknown as RagSearchResult[];
    const provider = (out: string | Error) => {
        const prompts: string[] = [];
        const p: CuratorLLMProvider = {
            complete: async (_sys: string, user: string) => { prompts.push(user); if (out instanceof Error) throw out; return out; },
        } as unknown as CuratorLLMProvider;
        return { p, prompts };
    };

    it('returns null without results and for empty or failing LLM output', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await new KnowledgeSynthesizer(provider('x').p, dir).synthesize('q', [])).toBeNull();
        expect(await new KnowledgeSynthesizer(provider('   \n').p, dir).synthesize('q', results('a'))).toBeNull();
        expect(await new KnowledgeSynthesizer(provider(new Error('llm down')).p, dir).synthesize('q', results('a'))).toBeNull();
        spy.mockRestore();
    });

    it('builds the note from the LLM output and lists the source titles', async () => {
        const { p } = provider('## Answer');
        const note = await new KnowledgeSynthesizer(p, dir).synthesize('how auth', results('a', 'b'));
        expect(note).toMatchObject({ title: 'how auth — Synthesis', content: '## Answer', basedOn: ['Doc 0', 'Doc 1'], synthesisVersion: 1 });
    });

    it('document text is inserted literally ($-patterns are not interpreted)', async () => {
        const { p, prompts } = provider('ok');
        await new KnowledgeSynthesizer(p, dir).synthesize('q', results("price is $& and $' and $1"));
        expect(prompts[0]).toContain("price is $& and $' and $1");
    });

    it('a query containing "{documents}" does not swallow the documents placeholder', async () => {
        const { p, prompts } = provider('ok');
        await new KnowledgeSynthesizer(p, dir).synthesize('what is {documents}?', results('DOC-BODY'));
        expect(prompts[0]).toContain('Query: what is {documents}?');
        expect(prompts[0].match(/DOC-BODY/g)).toHaveLength(1);
        expect(prompts[0]).toContain('Relevant Documents:\n## Document 1: Doc 0');
    });

    it('saveNote writes frontmatter + content, escapes quotes, and refuses to overwrite', async () => {
        const s = new KnowledgeSynthesizer(provider('x').p, dir);
        const note = {
            title: 'Say "hi"', content: 'BODY', basedOn: ['A "quoted" title'],
            synthesisVersion: 1, generatedAt: new Date().toISOString(),
        };
        const file = await s.saveNote(note);
        expect(file).not.toBeNull();
        const text = await fs.readFile(file!, 'utf-8');
        expect(text).toContain('title: "Say \\"hi\\""');
        expect(text).toContain('based_on: ["A \\"quoted\\" title"]');
        expect(text.endsWith('BODY')).toBe(true);
        expect(await s.saveNote(note)).toBeNull();
    });
});

describe('createProvider', () => {
    it('requires an API key', () => {
        expect(() => createProvider({ apiKey: '' })).toThrow(/API key is required/);
    });
    it('anthropic -> AnthropicAdapter; others -> OpenAIAdapter (default deepseek)', () => {
        expect(createProvider({ provider: 'anthropic', apiKey: 'k' })).toBeInstanceOf(AnthropicAdapter);
        for (const provider of ['openai', 'ollama', 'deepseek'] as const) {
            expect(createProvider({ provider, apiKey: 'k' })).toBeInstanceOf(OpenAIAdapter);
        }
        expect(createProvider({ apiKey: 'k' })).toBeInstanceOf(OpenAIAdapter);
    });
});
