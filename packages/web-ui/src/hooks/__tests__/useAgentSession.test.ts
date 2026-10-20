import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentSession } from '../useAgentSession';
import { FakeWebSocket } from './fakeWebSocket';

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal('WebSocket', FakeWebSocket);
});
afterEach(() => { vi.unstubAllGlobals(); });

/** Renders the hook, connects and opens the socket. */
function connected() {
  const hook = renderHook(() => useAgentSession({ url: 'ws://test' }));
  act(() => hook.result.current.connect());
  act(() => FakeWebSocket.last.open());
  const emit = (frame: unknown) => act(() => FakeWebSocket.last.emit(frame));
  return { ...hook, emit };
}

describe('useAgentSession — connection', () => {
  it('goes disconnected -> connecting -> connected -> disconnected', () => {
    const { result } = renderHook(() => useAgentSession({ url: 'ws://test' }));
    expect(result.current.status).toBe('disconnected');
    act(() => result.current.connect());
    expect(result.current.status).toBe('connecting');
    expect(FakeWebSocket.last.url).toBe('ws://test');
    act(() => FakeWebSocket.last.open());
    expect(result.current.status).toBe('connected');
    act(() => FakeWebSocket.last.close());
    expect(result.current.status).toBe('disconnected');
  });

  it('autoConnect opens a socket on mount and closes it on unmount', () => {
    const { unmount } = renderHook(() => useAgentSession({ url: 'ws://auto', autoConnect: true }));
    expect(FakeWebSocket.instances).toHaveLength(1);
    unmount();
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CLOSED);
  });

  it('connect() twice replaces the previous socket', () => {
    const { result } = renderHook(() => useAgentSession({ url: 'ws://test' }));
    act(() => result.current.connect());
    const first = FakeWebSocket.last;
    act(() => result.current.connect());
    expect(first.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it('a socket error adds a system message and marks the hook disconnected', () => {
    const { result } = renderHook(() => useAgentSession({ url: 'ws://test' }));
    act(() => result.current.connect());
    act(() => FakeWebSocket.last.fail());
    expect(result.current.status).toBe('disconnected');
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'system', content: 'WebSocket connection error.' });
  });

  it('stores the session id from session_created', () => {
    const { result, emit } = connected();
    emit({ type: 'session_created', sessionId: 's-1' });
    expect(result.current.sessionId).toBe('s-1');
  });

  it('ignores malformed frames', () => {
    const { result, emit } = connected();
    emit('{not json');
    emit({ type: 'token', content: 'ok' });
    expect(result.current.messages).toHaveLength(1);
  });
});

describe('useAgentSession — sending', () => {
  it('sendMessage does nothing while the socket is not open', () => {
    const { result } = renderHook(() => useAgentSession({ url: 'ws://test' }));
    act(() => result.current.connect());
    act(() => result.current.sendMessage('hi'));
    expect(result.current.messages).toHaveLength(0);
    expect(FakeWebSocket.last.sent).toEqual([]);
  });

  it('sendMessage adds the user message, flags running and sends an input frame', () => {
    const { result } = connected();
    act(() => result.current.sendMessage('hello'));
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(result.current.isRunning).toBe(true);
    expect(JSON.parse(FakeWebSocket.last.sent[0])).toEqual({ type: 'input', content: 'hello' });
  });

  it('abort sends an abort frame and clears running', () => {
    const { result } = connected();
    act(() => result.current.sendMessage('x'));
    act(() => result.current.abort());
    expect(JSON.parse(FakeWebSocket.last.sent.at(-1)!)).toEqual({ type: 'abort' });
    expect(result.current.isRunning).toBe(false);
  });

  it('clearMessages empties the list', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'a' });
    act(() => result.current.clearMessages());
    expect(result.current.messages).toEqual([]);
  });
});

describe('useAgentSession — streaming', () => {
  it('accumulates tokens into one streaming message and closes it on done', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'Hel' });
    emit({ type: 'token', content: 'lo' });
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({ role: 'assistant', content: 'Hello', isStreaming: true });
    emit({ type: 'done' });
    expect(result.current.messages[0].isStreaming).toBe(false);
    expect(result.current.isRunning).toBe(false);
  });

  it('after done, the next token starts a new message', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'one' });
    emit({ type: 'done' });
    emit({ type: 'token', content: 'two' });
    expect(result.current.messages.map(m => m.content)).toEqual(['one', 'two']);
  });

  it('a system event appends a system message', () => {
    const { result, emit } = connected();
    emit({ type: 'system', level: 'info', text: 'heads up' });
    expect(result.current.messages[0]).toMatchObject({ role: 'system', content: 'heads up' });
  });

  it('an error event adds an error message, stops running and does not leave a streaming spinner', () => {
    const { result, emit } = connected();
    act(() => result.current.sendMessage('go'));
    emit({ type: 'token', content: 'partial' });
    emit({ type: 'error', message: 'boom' });
    expect(result.current.isRunning).toBe(false);
    expect(result.current.messages.at(-1)).toMatchObject({ role: 'system', content: 'Error: boom' });
    expect(result.current.messages.some(m => m.isStreaming)).toBe(false);
  });

  it('closing the socket mid-stream stops the streaming spinner', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'partial' });
    act(() => FakeWebSocket.last.close());
    expect(result.current.messages.some(m => m.isStreaming)).toBe(false);
  });
});

describe('useAgentSession — agents', () => {
  it('tracks the active agent and attributes later messages to it (even though connect() ran earlier)', () => {
    const { result, emit } = connected();
    emit({ type: 'agent_switch', from: 'orch', to: 'coder', to_name: 'Coder', to_icon: '🛠' });
    expect(result.current.activeAgent).toEqual({ id: 'coder', name: 'Coder', icon: '🛠' });
    emit({ type: 'token', content: 'hi' });
    expect(result.current.messages[0]).toMatchObject({ agentId: 'coder', agentName: 'Coder', agentIcon: '🛠' });
  });

  it('block_start also sets the active agent; a switch closes the open streaming message', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'a' });
    emit({ type: 'block_start', agent_id: 'qa', agent_name: 'QA' });
    expect(result.current.messages[0].isStreaming).toBe(false);
    emit({ type: 'token', content: 'b' });
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[1]).toMatchObject({ agentId: 'qa', content: 'b' });
  });
});

describe('useAgentSession — tool calls', () => {
  const toolCalls = (msgs: ReturnType<typeof useAgentSession>['messages']) => msgs.flatMap(m => m.toolCalls ?? []);

  it('a tool_call closes the streaming message and adds a pending badge', () => {
    const { result, emit } = connected();
    emit({ type: 'token', content: 'thinking' });
    emit({ type: 'tool_call', name: 'read_file', args_preview: '{"p":1}' });
    expect(result.current.messages[0].isStreaming).toBe(false);
    expect(toolCalls(result.current.messages)).toEqual([
      expect.objectContaining({ name: 'read_file', argsPreview: '{"p":1}', status: 'pending' }),
    ]);
  });

  it.each([[true, 'done'], [false, 'error']])('tool_result success=%s -> %s with preview', (success, status) => {
    const { result, emit } = connected();
    emit({ type: 'tool_call', name: 't' });
    emit({ type: 'tool_result', name: 't', success, preview: 'out' });
    expect(toolCalls(result.current.messages)[0]).toMatchObject({ status, preview: 'out' });
  });

  it('two tool calls in a row each get their own result', () => {
    const { result, emit } = connected();
    emit({ type: 'tool_call', name: 'a' });
    emit({ type: 'tool_call', name: 'b' });
    emit({ type: 'tool_result', name: 'a', success: true, preview: 'ra' });
    emit({ type: 'tool_result', name: 'b', success: false, preview: 'rb' });
    const calls = toolCalls(result.current.messages);
    expect(calls.find(c => c.name === 'a')).toMatchObject({ status: 'done', preview: 'ra' });
    expect(calls.find(c => c.name === 'b')).toMatchObject({ status: 'error', preview: 'rb' });
  });

  it('a tool_result with no matching call is ignored', () => {
    const { result, emit } = connected();
    emit({ type: 'tool_result', name: 'ghost', success: true });
    expect(result.current.messages).toEqual([]);
  });
});
