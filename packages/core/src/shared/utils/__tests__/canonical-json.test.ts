import { canonicalJson, hashArgs } from '../canonical-json';
import { hashArgs as fromToolServer } from '../../../mcp/tool-server';

describe('canonicalJson', () => {
    it('sorts keys at every level and keeps array order', () => {
        expect(canonicalJson({ b: 1, a: { d: [3, 1], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,1]},"b":1}');
    });

    it('drops undefined object members like JSON.stringify, and writes null for undefined in arrays', () => {
        expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
        expect(canonicalJson([undefined, 1])).toBe('[null,1]');
        expect(canonicalJson(undefined)).toBe('null');
    });

    it('handles primitives', () => {
        expect(canonicalJson('s')).toBe('"s"');
        expect(canonicalJson(null)).toBe('null');
        expect(canonicalJson(false)).toBe('false');
    });
});

describe('hashArgs', () => {
    it('is a hex SHA-256 independent of key order', () => {
        const h = hashArgs({ a: 1, b: { c: 2 } });
        expect(h).toMatch(/^[0-9a-f]{64}$/);
        expect(hashArgs({ b: { c: 2 }, a: 1 })).toBe(h);
        expect(hashArgs({ a: 2, b: { c: 2 } })).not.toBe(h);
    });

    it('is the same function the MCP tool server exports (one implementation)', () => {
        expect(fromToolServer).toBe(hashArgs);
    });
});
