import { AgentRegistry } from '../AgentRegistry';
import type { AgentProfile } from '../../types';

const agent: AgentProfile = {
    id: 'alpha',
    name: 'Alpha',
    icon: '🅰',
    description: 'desc',
    systemPrompt: 'sys',
    allowedTools: [],
};

describe('AgentRegistry', () => {
    let reg: AgentRegistry;
    beforeEach(() => { reg = new AgentRegistry(); });

    it('starts empty', () => {
        expect(reg.getAll()).toHaveLength(0);
    });

    it('upsert → get returns the agent', () => {
        reg.upsert(agent);
        expect(reg.get('alpha')).toEqual(agent);
    });

    it('has returns true for registered, false otherwise', () => {
        reg.upsert(agent);
        expect(reg.has('alpha')).toBe(true);
        expect(reg.has('beta')).toBe(false);
    });

    it('upsert replaces existing agent', () => {
        reg.upsert(agent);
        reg.upsert({ ...agent, name: 'Alpha v2' });
        expect(reg.get('alpha')?.name).toBe('Alpha v2');
        expect(reg.getAll()).toHaveLength(1);
    });

    it('register throws on duplicate id', () => {
        reg.register(agent);
        expect(() => reg.register(agent)).toThrow(/already registered/);
    });

    it('registerAll adds multiple agents', () => {
        reg.registerAll([agent, { ...agent, id: 'beta' }]);
        expect(reg.getAll()).toHaveLength(2);
    });

    it('get returns undefined for unknown id', () => {
        expect(reg.get('unknown')).toBeUndefined();
    });
});
