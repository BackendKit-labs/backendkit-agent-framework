import { ToolRegistry } from '../ToolRegistry';
import type { ToolDefinition } from '../../types';

function makeTool(name: string): ToolDefinition {
    return {
        name,
        description: `Tool ${name}`,
        parameters: { type: 'object', properties: {} },
        execute: async () => `result:${name}`,
    };
}

describe('ToolRegistry', () => {
    let reg: ToolRegistry;
    beforeEach(() => { reg = new ToolRegistry(); });

    it('register → get returns the tool', () => {
        const t = makeTool('my_tool');
        reg.register(t);
        expect(reg.get('my_tool')).toBe(t);
    });

    it('register throws on duplicate name', () => {
        reg.register(makeTool('dup'));
        expect(() => reg.register(makeTool('dup'))).toThrow(/already registered/);
    });

    it('unregister removes the tool', () => {
        reg.register(makeTool('bye'));
        reg.unregister('bye');
        expect(reg.get('bye')).toBeUndefined();
        expect(reg.has('bye')).toBe(false);
    });

    it('has returns correct boolean', () => {
        reg.register(makeTool('exists'));
        expect(reg.has('exists')).toBe(true);
        expect(reg.has('nope')).toBe(false);
    });

    it('getAll returns all registered tools', () => {
        reg.register(makeTool('a'));
        reg.register(makeTool('b'));
        expect(reg.getAll()).toHaveLength(2);
    });

    it('getForAgent returns only listed tools', () => {
        reg.register(makeTool('a'));
        reg.register(makeTool('b'));
        reg.register(makeTool('c'));
        const result = reg.getForAgent(['a', 'c']);
        expect(result.map(t => t.name)).toEqual(['a', 'c']);
    });

    it('getForAgent silently ignores unknown names', () => {
        reg.register(makeTool('a'));
        expect(reg.getForAgent(['a', 'unknown'])).toHaveLength(1);
    });

    it('getForAgent with empty list returns empty', () => {
        reg.register(makeTool('a'));
        expect(reg.getForAgent([])).toHaveLength(0);
    });
});
