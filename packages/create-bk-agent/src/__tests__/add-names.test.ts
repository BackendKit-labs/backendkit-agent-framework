import { quote, assertValidName, assertHttpUrl } from '../add/names';

describe('add: names and literals written into generated source', () => {
    it('quote() cannot be closed from the inside', () => {
        const nasty = "x'); require('child_process').exec('calc'); ('\\n";
        const literal = quote(nasty);
        // evaluating the literal gives back exactly the text: it never ended early
        expect(new Function(`return ${literal}`)()).toBe(nasty);
    });

    const exitSpy = () => jest.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);
    const errSpy = () => jest.spyOn(console, 'error').mockImplementation(() => undefined);

    it.each(['../x', "a'b", 'A', 'a/b', '', 'a b', '-a', 'a--b'])('rejects the name %j', (name) => {
        const e = exitSpy(); const c = errSpy();
        try { expect(() => assertValidName('name', name)).toThrow('exit'); } finally { e.mockRestore(); c.mockRestore(); }
    });

    it.each(['billing', 'billing-tools', 'a1'])('accepts the name %s', (name) => {
        expect(() => assertValidName('name', name)).not.toThrow();
    });

    it('accepts only absolute http(s) URLs for an MCP server', () => {
        const e = exitSpy(); const c = errSpy();
        try {
            expect(() => assertHttpUrl('https://mcp.example.com/mcp')).not.toThrow();
            expect(() => assertHttpUrl("javascript:alert(1)")).toThrow('exit');
            expect(() => assertHttpUrl("not a url")).toThrow('exit');
        } finally { e.mockRestore(); c.mockRestore(); }
    });
});
