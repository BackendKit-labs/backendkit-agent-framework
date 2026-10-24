import type { WebSocket } from 'ws';
import { inScope, sessionScope } from '../auth/scope';
import { MonitorBus } from '../monitor/MonitorBus';

describe('sessionScope', () => {
    it('sees everything when no user is in play (no auth configured)', () => {
        expect(sessionScope(undefined, 'admin')).toBeUndefined();
    });

    it('scopes a user to their own sessions', () => {
        expect(sessionScope({ sub: 'alice' }, 'admin')).toBe('alice');
        expect(sessionScope({ sub: 'alice', roles: ['viewer'] }, 'admin')).toBe('alice');
    });

    it('lets the admin role see everything, and honours a custom role name', () => {
        expect(sessionScope({ sub: 'root', roles: ['admin'] }, 'admin')).toBeUndefined();
        expect(sessionScope({ sub: 'ops', roles: ['ops'] }, 'ops')).toBeUndefined();
        expect(sessionScope({ sub: 'root', roles: ['admin'] }, 'ops')).toBe('root');
    });

    it('a token without sub is scoped to nothing, never to everything', () => {
        for (const user of [{} as { sub: string }, { sub: '' }, { sub: 42 as unknown as string }]) {
            const scope = sessionScope(user, 'admin');
            expect(scope).toBeDefined();
            expect(inScope(scope, undefined)).toBe(false);
            expect(inScope(scope, 'alice')).toBe(false);
        }
    });

    it('a roles claim that is not an array does not grant admin', () => {
        expect(sessionScope({ sub: 'eve', roles: 'admin' as unknown as string[] }, 'admin')).toBe('eve');
    });
});

describe('inScope', () => {
    it('matches the owner and, with no scope, anything', () => {
        expect(inScope('alice', 'alice')).toBe(true);
        expect(inScope('alice', 'bob')).toBe(false);
        expect(inScope('alice', undefined)).toBe(false);
        expect(inScope(undefined, 'bob')).toBe(true);
        expect(inScope(undefined, undefined)).toBe(true);
    });
});

type FakeSocket = WebSocket & { _sent: string[] };
function fakeSocket(): FakeSocket {
    const sent: string[] = [];
    return { readyState: 1, send: jest.fn((d: string) => { sent.push(d); }), on: jest.fn(), _sent: sent } as unknown as FakeSocket;
}
const frames = (s: FakeSocket) => s._sent.map(d => JSON.parse(d));

describe('MonitorBus scoping', () => {
    it('a scoped observer gets only its user\'s sessions in the hello and in every frame', () => {
        const bus = new MonitorBus();
        bus.notifySessionOpen('a1', 'alice');
        bus.notifySessionOpen('b1', 'bob');
        const all = fakeSocket(); const alice = fakeSocket(); const bob = fakeSocket();
        bus.subscribe(all); bus.subscribe(alice, 'alice'); bus.subscribe(bob, 'bob');

        expect(frames(all)[0].sessionIds.sort()).toEqual(['a1', 'b1']);
        expect(frames(alice)[0].sessionIds).toEqual(['a1']);
        expect(frames(bob)[0].sessionIds).toEqual(['b1']);

        bus.broadcastRunInput('a1', 'secret prompt of alice');
        bus.broadcast('b1', { type: 'text', content: 'answer for bob' } as never);

        const seenBy = (s: FakeSocket) => frames(s).slice(1).map(f => f.sessionId);
        expect(seenBy(all)).toEqual(['a1', 'b1']);
        expect(seenBy(alice)).toEqual(['a1']);
        expect(seenBy(bob)).toEqual(['b1']);
        expect(alice._sent.join('')).not.toContain('answer for bob');
    });

    it('a session without an owner is visible only to an unscoped observer', () => {
        const bus = new MonitorBus();
        const all = fakeSocket(); const alice = fakeSocket();
        bus.subscribe(all); bus.subscribe(alice, 'alice');
        bus.notifySessionOpen('anon');
        bus.broadcastRunInput('anon', 'x');
        expect(frames(all).slice(1).map(f => f.sessionId)).toEqual(['anon', 'anon']);
        expect(frames(alice)).toHaveLength(1); // only its hello
    });

    it('the close frame still reaches the owner, and the session is forgotten afterwards', () => {
        const bus = new MonitorBus();
        const alice = fakeSocket();
        bus.subscribe(alice, 'alice');
        bus.notifySessionOpen('a1', 'alice');
        bus.notifySessionClose('a1');
        expect(frames(alice).slice(1).map(f => f.type)).toEqual(['monitor_session_open', 'monitor_session_close']);

        const late = fakeSocket();
        bus.subscribe(late, 'alice');
        expect(frames(late)[0].sessionIds).toEqual([]);
    });
});
