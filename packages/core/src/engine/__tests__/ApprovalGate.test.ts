import { ApprovalGate } from '../ApprovalGate';
import type { ToolApprovalDecision } from '../../types';

describe('ApprovalGate — decided by the facts a tool declares', () => {
    const transport = { emit: jest.fn() };
    const writer = { readOnly: false as const };
    const reader = { readOnly: true as const };
    const undeclared = {};
    const installer = {
        readOnly: false as const,
        alwaysAsk: (args: Record<string, unknown>) => typeof args.command === 'string' && args.command.startsWith('install'),
    };
    const call = (name: string, args: unknown = {}) => ({ name, args: JSON.stringify(args) });

    function gate(decisions: ToolApprovalDecision[]) {
        const onToolApproval = jest.fn(async () => decisions.shift() ?? 'approve');
        return { gate: new ApprovalGate({ onToolApproval, transport: transport as never }), onToolApproval };
    }

    it('asks for a tool that declares readOnly: false, not for readOnly: true nor for one that declares nothing', async () => {
        const { gate: g, onToolApproval } = gate([]);
        await g.check(call('write'), 'a', undefined, writer);
        expect(onToolApproval).toHaveBeenCalledTimes(1);
        await g.check(call('read'), 'a', undefined, reader);
        await g.check(call('other'), 'a', undefined, undeclared);
        await g.check(call('write_file'), 'a'); // the name alone no longer matters
        expect(onToolApproval).toHaveBeenCalledTimes(1);
    });

    it('after "approve all", ordinary tool calls stop asking', async () => {
        const { gate: g, onToolApproval } = gate(['approve_all']);
        expect(await g.check(call('write'), 'a', undefined, writer)).toBe('run');
        expect(await g.check(call('write'), 'a', undefined, writer)).toBe('run');
        expect(onToolApproval).toHaveBeenCalledTimes(1);
    });

    it('a call the tool flags with alwaysAsk is asked even after "approve all"', async () => {
        const { gate: g, onToolApproval } = gate(['approve_all', 'approve']);
        await g.check(call('write'), 'a', undefined, writer); // approve all
        expect(await g.check(call('sh', { command: 'install foo' }), 'a', undefined, installer)).toBe('run');
        expect(onToolApproval).toHaveBeenCalledTimes(2);
    });

    it('a rejected alwaysAsk call is rejected even after "approve all"', async () => {
        const { gate: g } = gate(['approve_all', 'reject']);
        await g.check(call('write'), 'a', undefined, writer);
        expect(await g.check(call('sh', { command: 'install evil' }), 'a', undefined, installer)).toBe('rejected');
    });

    it('does not ask about an unflagged call after "approve all"', async () => {
        const { gate: g, onToolApproval } = gate(['approve_all']);
        await g.check(call('write'), 'a', undefined, writer);
        expect(await g.check(call('sh', { command: 'test' }), 'a', undefined, installer)).toBe('run');
        expect(onToolApproval).toHaveBeenCalledTimes(1);
    });

    it('a plain agent whose tools declare nothing is never asked (no behavior change for non-coding agents)', async () => {
        const { gate: g, onToolApproval } = gate([]);
        expect(await g.check(call('send_invoice', { amount: 10 }), 'a', undefined, undeclared)).toBe('run');
        expect(onToolApproval).not.toHaveBeenCalled();
    });
});
