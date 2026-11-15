/**
 * SPEC-0016 §4: un agente de negocio se construye con createBaseEngine sin tocar el disco
 * si no se le pasan fuentes de archivos.
 */
// require: el namespace de `import *` no es configurable y jest no puede espiarlo.
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs');
const os = require('os') as typeof import('os');
import { createBaseEngine } from '../createBaseEngine';
import type { LLMProvider, AgentProfile } from '../../types';

const agent: AgentProfile = {
    id: 'biz', name: 'Biz', icon: 'b', description: 'negocio',
    systemPrompt: 'You handle invoices.', allowedTools: [], delegatesTo: [],
};

const provider: LLMProvider = {
    async chat(_m, _t, cb) {
        cb.onChunk?.('ok');
        cb.onDone({ role: 'assistant', content: 'ok' });
    },
};

describe('createBaseEngine sin fuentes de archivos', () => {
    it('no lee ni escribe el disco ni consulta el home', async () => {
        const touched: string[] = [];
        const spies = (['readFileSync', 'writeFileSync', 'existsSync', 'readdirSync', 'mkdirSync', 'statSync', 'appendFileSync'] as const)
            .map(fn => jest.spyOn(fs, fn as never).mockImplementation(((p: unknown) => { touched.push(`${fn}:${String(p)}`); throw new Error('disk'); }) as never));
        const promiseSpies = (['readFile', 'writeFile', 'readdir', 'mkdir', 'stat', 'access', 'appendFile'] as const)
            .map(fn => jest.spyOn(fs.promises, fn as never).mockImplementation((async (p: unknown) => { touched.push(`promises.${fn}:${String(p)}`); throw new Error('disk'); }) as never));
        const home = jest.spyOn(os, 'homedir');

        try {
            const engine = createBaseEngine({
                providers: { mock: provider },
                defaultProvider: 'mock',
                agents: [agent],
            } as never);
            await (engine as { run(i: string): Promise<unknown> }).run('hola');
        } finally {
            [...spies, ...promiseSpies, home].forEach(s => s.mockRestore());
        }
        expect(touched).toEqual([]);
        expect(home).not.toHaveBeenCalled();
    });
});
