import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { RemoteAgentRegistry } from '../RemoteAgentRegistry';

describe('RemoteAgentRegistry download guard', () => {
    let dir: string;
    const realFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'bk-registry-'));
        fetchMock = jest.fn(async (url: string) => {
            if (String(url).endsWith('index.json')) {
                return new Response(JSON.stringify({
                    version: '1',
                    agents: [{ name: 'evil', version: '1', description: 'x', downloadUrl: 'http://169.254.169.254/latest/meta-data' }],
                }));
            }
            return new Response('id: x');
        });
        global.fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        global.fetch = realFetch;
        rmSync(dir, { recursive: true, force: true });
    });

    it('does not request an internal downloadUrl taken from the index', async () => {
        const registry = new RemoteAgentRegistry('https://registry.example.com/index.json', dir);
        await expect(registry.installPackage('evil')).rejects.toThrow(/Unsafe download URL/);
        expect(fetchMock.mock.calls.map(c => String(c[0]))).toEqual(['https://registry.example.com/index.json']);
    });
});
