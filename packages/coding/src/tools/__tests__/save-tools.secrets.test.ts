import { saveContextTool } from '../save-context';
import { saveAuditTool } from '../save-audit';
import { saveLearningTool } from '../save-learning';
import { updateSessionTool } from '../update-session';

const SECRET = 'AKIAIOSFODNN7EXAMPLE';

describe('save_* tools warn about secrets', () => {
    const store = {
        appendContext: jest.fn(),
        saveAudit: jest.fn(),
        appendLearning: jest.fn(),
        updateSession: jest.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ctx = { services: new Map<string, unknown>([['coding.store', store]]) } as any;
    let warn: jest.SpyInstance;

    beforeEach(() => { warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined); });
    afterEach(() => { warn.mockRestore(); jest.clearAllMocks(); });

    const warned = () => warn.mock.calls.some(c => String(c[0]).includes('SecretScanner'));

    it('save_context', async () => {
        await saveContextTool.execute({ content: `key ${SECRET}` }, ctx);
        expect(warned()).toBe(true);
        expect(store.appendContext).toHaveBeenCalled(); // warns, does not block
    });

    it('save_audit', async () => {
        await saveAuditTool.execute({ agent_id: 'qa', content: `key ${SECRET}` }, ctx);
        expect(warned()).toBe(true);
        expect(store.saveAudit).toHaveBeenCalled();
    });

    it('save_learning (no LLM router)', async () => {
        await saveLearningTool.execute({ content: `key ${SECRET}` }, ctx);
        expect(warned()).toBe(true);
        expect(store.appendLearning).toHaveBeenCalled();
    });

    it('update_session', async () => {
        await updateSessionTool.execute({ decisions: [`use ${SECRET}`] }, ctx);
        expect(warned()).toBe(true);
        expect(store.updateSession).toHaveBeenCalled();
    });

    it('stays quiet for clean content', async () => {
        await saveContextTool.execute({ content: 'uses postgres 16' }, ctx);
        expect(warned()).toBe(false);
    });
});
