import { AgentEngine } from '../AgentEngine';
import { resolveSecrets } from '../secrets';
import { defineTool, z } from '../../tools/defineTool';
import { secretLeakGuardrail } from '../../guardrails/builtins';
import type { AgentProfile, LLMMessage } from '../../types';
import { buildRegistries, createMockTransport, createScriptedProvider, testAgent } from '../../__tests__/helpers';

const ENV = 'BK_TEST_SECRET_REF';
afterEach(() => { delete process.env[ENV]; });

const profile = (secrets: AgentProfile['secrets']): AgentProfile => ({ ...testAgent, allowedTools: ['peek'], secrets });

describe('resolveSecrets', () => {
    it('resolves literals, env references, resolver fallback, and omits what stays empty', async () => {
        process.env[ENV] = 'from-env';
        const resolver = jest.fn(async (name: string) => (name === 'VAULT' ? 'from-vault' : undefined));
        const got = await resolveSecrets(profile({
            LIT: 'plain', ENVED: { env: ENV }, VAULT: { env: 'BK_TEST_UNSET_VAR' }, NOPE: { env: 'BK_TEST_UNSET_VAR_2' },
        }), resolver);
        expect(got).toEqual({ LIT: 'plain', ENVED: 'from-env', VAULT: 'from-vault' });
        expect(resolver).not.toHaveBeenCalledWith('LIT', expect.anything());
        expect(resolver).toHaveBeenCalledWith('VAULT', 'test-agent');
    });
    it('env wins over the resolver; no profile or secrets gives an empty object', async () => {
        process.env[ENV] = 'from-env';
        const resolver = jest.fn(async () => 'from-vault');
        expect(await resolveSecrets(profile({ K: { env: ENV } }), resolver)).toEqual({ K: 'from-env' });
        expect(resolver).not.toHaveBeenCalled();
        expect(await resolveSecrets(undefined)).toEqual({});
    });
});

function build(opts: { secrets: AgentProfile['secrets']; script: Parameters<typeof createScriptedProvider>[0]; resolver?: (n: string, a: string) => string | undefined | Promise<string | undefined>; guard?: boolean }) {
    const seen: Array<Record<string, string> | undefined> = [];
    const provider = createScriptedProvider(opts.script);
    const messages: LLMMessage[][] = [];
    const wrapped = { chat: (m: LLMMessage[], t: never, cb: never, o: never) => { messages.push(m); return provider.chat(m, t, cb, o); } };
    const { agents, tools, providers } = buildRegistries(wrapped as never, profile(opts.secrets));
    tools.register(defineTool({
        name: 'peek', description: 'reads ctx.secrets', input: z.object({}),
        execute: async (_a, ctx) => { seen.push(ctx.secrets); return `ok ${JSON.stringify(ctx.secrets ?? {})}`; },
    }));
    const { transport, events } = createMockTransport();
    const engine = new AgentEngine({ requireAgentIdentity: false,
        model: { provider: 'mock', id: 'mock' }, agents, tools, providers, defaultProvider: 'mock', transport,
        defaultAgentId: 'test-agent', secretResolver: opts.resolver,
        ...(opts.guard ? { guardrails: [secretLeakGuardrail()] } : {}),
    });
    return { engine, seen, events, messages };
}

const call = (id: string) => ({ tool_calls: [{ id, name: 'peek', args: {} }] });

describe('AgentEngine — secret references', () => {
    it('hands the tool resolved strings, and picks up a rotated env var on the next call', async () => {
        process.env[ENV] = 'v1';
        const { engine, seen } = build({ secrets: { K: { env: ENV }, LIT: 'x' }, script: [call('1'), { content: 'done' }, call('2'), { content: 'done' }] });
        await engine.run('first');
        process.env[ENV] = 'v2';
        await engine.run('second');
        expect(seen).toEqual([{ K: 'v1', LIT: 'x' }, { K: 'v2', LIT: 'x' }]);
    });

    it('uses an async secretResolver when the env var is unset', async () => {
        const { engine, seen } = build({ secrets: { K: { env: 'BK_TEST_UNSET_VAR' } }, script: [call('1'), { content: 'done' }], resolver: async n => `vault-${n}` });
        await engine.run('go');
        expect(seen[0]).toEqual({ K: 'vault-K' });
    });

    it('an unresolved reference is omitted (ctx.secrets stays absent)', async () => {
        const { engine, seen } = build({ secrets: { K: { env: 'BK_TEST_UNSET_VAR' } }, script: [call('1'), { content: 'done' }] });
        await engine.run('go');
        expect(seen[0]).toBeUndefined();
    });

    it('secretLeakGuardrail masks the resolved value', async () => {
        process.env[ENV] = 'ref-secret-value-12345';
        const { engine, messages } = build({ secrets: { K: { env: ENV } }, script: [call('1'), { content: 'done' }], guard: true });
        await engine.run('go');
        const lastSent = JSON.stringify(messages[messages.length - 1]);
        expect(lastSent).not.toContain('ref-secret-value-12345');
        expect(lastSent).toContain('[REDACTED:secret]');
    });
});

describe('the guardrails resolve every agent\'s secrets once per run (audit B-08)', () => {
    it('several tool calls in one run ask the resolver once for the guardrails, and again in the next run', async () => {
        const resolver = jest.fn(async () => 'from-vault-1234567890');
        const { engine } = build({
            secrets: { V: { env: 'BK_TEST_UNSET_FOR_B08' } }, resolver, guard: true,
            script: [call('1'), call('2'), call('3'), { content: 'done' }, { content: 'again' }],
        });
        await engine.run('first');
        const afterFirst = resolver.mock.calls.length;
        // One for the guardrails' cache, plus one per tool call (the tool's own ctx.secrets is resolved fresh each call).
        expect(afterFirst).toBe(1 + 3);
        await engine.run('second');
        expect(resolver.mock.calls.length).toBe(afterFirst + 1);
    });
});