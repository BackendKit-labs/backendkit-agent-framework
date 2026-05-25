import type { AgentEvent } from '../types';
import type { Transport, Unsubscribe } from './Transport';

export class CallbackTransport implements Transport {
    private inputHandlers: Array<(input: string) => void> = [];

    constructor(private readonly onEvent: (event: AgentEvent) => void) {}

    emit(event: AgentEvent): void {
        this.onEvent(event);
    }

    onInput(handler: (input: string) => void): Unsubscribe {
        this.inputHandlers.push(handler);
        return () => {
            this.inputHandlers = this.inputHandlers.filter(h => h !== handler);
        };
    }

    send(input: string): void {
        for (const h of this.inputHandlers) h(input);
    }

    close(): void {
        this.inputHandlers = [];
    }
}
