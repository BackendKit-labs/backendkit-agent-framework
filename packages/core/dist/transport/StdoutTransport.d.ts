import type { AgentEvent } from '../types';
import type { Transport, Unsubscribe } from './Transport';
export declare class StdoutTransport implements Transport {
    emit(event: AgentEvent): void;
    onInput(handler: (input: string) => void): Unsubscribe;
    close(): void;
}
//# sourceMappingURL=StdoutTransport.d.ts.map