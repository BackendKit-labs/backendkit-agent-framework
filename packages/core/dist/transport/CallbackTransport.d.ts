import type { AgentEvent } from '../types';
import type { Transport, Unsubscribe } from './Transport';
export declare class CallbackTransport implements Transport {
    private readonly onEvent;
    private inputHandlers;
    constructor(onEvent: (event: AgentEvent) => void);
    emit(event: AgentEvent): void;
    onInput(handler: (input: string) => void): Unsubscribe;
    send(input: string): void;
    close(): void;
}
//# sourceMappingURL=CallbackTransport.d.ts.map