/**
 * Baseline de SPEC-0016: lo que la CLI de coding produce hoy, para comprobar que sacar los
 * modulos de archivos de core no cambia nada. Si una fase cambia el snapshot, hay que
 * diagnosticarlo, no actualizarlo.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-baseline-home-'));
const CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-baseline-cwd-'));
process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.BK_TRUST_PROJECT = '1';
fs.writeFileSync(path.join(CWD, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { express: '^4' } }));
fs.writeFileSync(path.join(CWD, 'tsconfig.json'), '{}');
fs.writeFileSync(path.join(CWD, 'AGENT.md'), '# Fixture\nUse tabs.');

import * as core from '@backendkit-labs/agent-core';
import type { LLMProvider } from '@backendkit-labs/agent-core';

const captured: string[] = [];
const provider: LLMProvider = {
    async chat(messages, _tools, callbacks) {
        const sys = messages.find(m => m.role === 'system');
        if (sys?.content) captured.push(sys.content as string);
        callbacks.onChunk?.('ok');
        callbacks.onDone({ role: 'assistant', content: 'ok' });
    },
};

jest.mock('@backendkit-labs/agent-core', () => {
    const actual = jest.requireActual('@backendkit-labs/agent-core');
    return {
        ...actual,
        createBaseEngine: (o: { defaultProvider: string }) =>
            actual.createBaseEngine({ ...o, providers: { [o.defaultProvider]: (global as { __bkProvider?: unknown }).__bkProvider } }),
    };
});

import { createCodingEngine } from '../index';
import { detectStack } from '../cli';

const normalize = (s: string) =>
    s.split(CWD).join('<CWD>').split(HOME).join('<HOME>')
        .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '<TS>')
        .replace(/\\/g, '/')
        .replace(/\r\n/g, '\n');

afterAll(() => {
    delete process.env.BK_TRUST_PROJECT;
    fs.rmSync(HOME, { recursive: true, force: true });
    fs.rmSync(CWD, { recursive: true, force: true });
});

describe('SPEC-0016 baseline: CLI de coding', () => {
    beforeAll(() => { (global as { __bkProvider?: unknown }).__bkProvider = provider; });

    it('el system prompt del agente por defecto', async () => {
        const engine = createCodingEngine({
            providers: { ollama: {} } as never,
            defaultProvider: 'ollama',
            workingDir: CWD,
            appName: 'bk-baseline',
        } as never);
        await (engine as { run(i: string): Promise<unknown> }).run('hola');
        expect(captured.length).toBeGreaterThan(0);
        expect(normalize(captured[0])).toMatchSnapshot();
    });

    it('las skills que se activan con una entrada fija', async () => {
        const activator = new core.SkillActivator();
        const skills = [
            { name: 'by-trigger', description: 'a', triggers: ['express'], prompt: 'A', source: 'builtin' },
            { name: 'node-only', description: 'b', triggers: ['express'], language: ['node'], prompt: 'B', source: 'builtin' },
            { name: 'go-only', description: 'c', triggers: ['express'], language: ['go'], prompt: 'C', source: 'builtin' },
            { name: 'for-agent', description: 'd', agents: ['general'], prompt: 'D', source: 'builtin' },
        ] as unknown as core.Skill[];
        const stack = await detectStack(CWD);
        const active = activator.activate('configura Express', skills, stack);
        expect({
            stack: [...stack].sort(), // the detection order depends on which fs.access finishes first
            active: active.map(s => s.name),
            forAgent: activator.getAgentSkills('general', skills, stack).map(s => s.name),
            addition: activator.buildSystemPromptAddition(active),
        }).toMatchSnapshot();
    });
});
