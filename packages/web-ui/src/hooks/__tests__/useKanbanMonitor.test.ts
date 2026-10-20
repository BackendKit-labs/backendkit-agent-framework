import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useKanbanMonitor } from '../useKanbanMonitor';
import { FakeWebSocket } from './fakeWebSocket';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => { vi.unstubAllGlobals(); });

function monitor() {
  const hook = renderHook(() => useKanbanMonitor({ url: 'ws://monitor' }));
  act(() => hook.result.current.connect());
  act(() => FakeWebSocket.last.open());
  const emit = (frame: unknown) => act(() => FakeWebSocket.last.emit(frame));
  return { ...hook, emit };
}

describe('useKanbanMonitor — connection and sessions', () => {
  it('tracks connection status', () => {
    const { result } = renderHook(() => useKanbanMonitor({ url: 'ws://monitor' }));
    expect(result.current.status).toBe('disconnected');
    act(() => result.current.connect());
    expect(result.current.status).toBe('connecting');
    act(() => FakeWebSocket.last.open());
    expect(result.current.status).toBe('connected');
    act(() => FakeWebSocket.last.close());
    expect(result.current.status).toBe('disconnected');
  });

  it('monitor_hello seeds the sessions; open adds without duplicates; close removes', () => {
    const { result, emit } = monitor();
    emit({ type: 'monitor_hello', sessionIds: ['a', 'b'] });
    expect(result.current.activeSessions).toEqual(['a', 'b']);
    emit({ type: 'monitor_session_open', sessionId: 'b' });
    emit({ type: 'monitor_session_open', sessionId: 'c' });
    expect(result.current.activeSessions).toEqual(['a', 'b', 'c']);
    emit({ type: 'monitor_session_close', sessionId: 'a' });
    expect(result.current.activeSessions).toEqual(['b', 'c']);
  });

  it('ignores malformed frames and session events without a sessionId', () => {
    const { result, emit } = monitor();
    emit('nope{');
    emit({ type: 'run_input', content: 'x' });
    expect(result.current.runs).toEqual([]);
  });
});

describe('useKanbanMonitor — runs', () => {
  it('run_input creates a pending run with a truncated title', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'x'.repeat(200) });
    const run = result.current.runs[0];
    expect(run).toMatchObject({ sessionId: 's1', column: 'pending', tokens: 0, toolCalls: [] });
    expect(run.title).toHaveLength(80);
    expect(run.title.endsWith('…')).toBe(true);
  });

  it('newest run goes first', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'first' });
    emit({ type: 'done', sessionId: 's1' });
    emit({ type: 'run_input', sessionId: 's1', content: 'second' });
    expect(result.current.runs.map(r => r.title)).toEqual(['second', 'first']);
  });

  it('follows block_start -> tokens -> tool call -> done', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'task' });
    emit({ type: 'block_start', sessionId: 's1', agent_id: 'dev', agent_name: 'Dev', agent_icon: '🛠' });
    expect(result.current.runs[0]).toMatchObject({ column: 'running', agentId: 'dev', agentName: 'Dev', agentIcon: '🛠' });
    emit({ type: 'token', sessionId: 's1', content: 'abcde' });
    emit({ type: 'token', sessionId: 's1', content: 'fg' });
    expect(result.current.runs[0].tokens).toBe(7);
    emit({ type: 'tool_call', sessionId: 's1', name: 'grep', args_preview: '-r x' });
    expect(result.current.runs[0].toolCalls).toEqual([expect.objectContaining({ name: 'grep', argsPreview: '-r x', status: 'pending' })]);
    emit({ type: 'tool_result', sessionId: 's1', name: 'grep', success: true });
    expect(result.current.runs[0].toolCalls[0].status).toBe('done');
    emit({ type: 'done', sessionId: 's1' });
    expect(result.current.runs[0].column).toBe('done');
    expect(result.current.runs[0].completedAt).toBeInstanceOf(Date);
  });

  it('agent_switch updates the agent; error finishes the run in the error column', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'task' });
    emit({ type: 'agent_switch', sessionId: 's1', from: 'a', to: 'b', to_name: 'B' });
    expect(result.current.runs[0]).toMatchObject({ agentId: 'b', agentName: 'B' });
    emit({ type: 'error', sessionId: 's1' });
    expect(result.current.runs[0].column).toBe('error');
  });

  it('"ready" also completes the run', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'task' });
    emit({ type: 'ready', sessionId: 's1' });
    expect(result.current.runs[0].column).toBe('done');
  });

  it('events for a session without an active run are ignored', () => {
    const { result, emit } = monitor();
    emit({ type: 'token', sessionId: 'nobody', content: 'x' });
    emit({ type: 'done', sessionId: 'nobody' });
    expect(result.current.runs).toEqual([]);
  });

  it('runs of different sessions do not mix', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 'a', content: 'A' });
    emit({ type: 'run_input', sessionId: 'b', content: 'B' });
    emit({ type: 'token', sessionId: 'a', content: '123' });
    expect(result.current.runs.find(r => r.sessionId === 'a')!.tokens).toBe(3);
    expect(result.current.runs.find(r => r.sessionId === 'b')!.tokens).toBe(0);
  });

  it('closing a session mid-run marks that run as error', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'task' });
    emit({ type: 'monitor_session_close', sessionId: 's1' });
    expect(result.current.runs[0]).toMatchObject({ column: 'error' });
    expect(result.current.runs[0].completedAt).toBeInstanceOf(Date);
  });

  it('a new run_input while the previous one never finished does not leave a ghost "running" card', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'old' });
    emit({ type: 'block_start', sessionId: 's1', agent_id: 'x' });
    emit({ type: 'run_input', sessionId: 's1', content: 'new' });
    const old = result.current.runs.find(r => r.title === 'old')!;
    expect(old.column).toBe('error');
    expect(old.completedAt).toBeInstanceOf(Date);
  });

  it('parallel tool calls resolve by name, not just the last pending one', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 's1', content: 'task' });
    emit({ type: 'tool_call', sessionId: 's1', name: 'a' });
    emit({ type: 'tool_call', sessionId: 's1', name: 'b' });
    emit({ type: 'tool_result', sessionId: 's1', name: 'a', success: true });
    const calls = result.current.runs[0].toolCalls;
    expect(calls.find(c => c.name === 'a')!.status).toBe('done');
    expect(calls.find(c => c.name === 'b')!.status).toBe('pending');
  });

  it('clearDone removes finished and failed runs but keeps active ones', () => {
    const { result, emit } = monitor();
    emit({ type: 'run_input', sessionId: 'a', content: 'done-run' });
    emit({ type: 'done', sessionId: 'a' });
    emit({ type: 'run_input', sessionId: 'b', content: 'err-run' });
    emit({ type: 'error', sessionId: 'b' });
    emit({ type: 'run_input', sessionId: 'c', content: 'active-run' });
    act(() => result.current.clearDone());
    expect(result.current.runs.map(r => r.title)).toEqual(['active-run']);
  });
});
