import { EventEmitter } from 'events';

export interface EventPayload {
    source?: string;
    data: unknown;
}

/** Process-wide typed pub/sub bus for cross-agent and external events. */
class GlobalEventBus {
    private readonly emitter = new EventEmitter();

    emit(topic: string, payload: EventPayload): void {
        this.emitter.emit(topic, payload);
    }

    /** Subscribe to a topic. Returns an unsubscribe function. */
    on(topic: string, listener: (payload: EventPayload) => void): () => void {
        this.emitter.on(topic, listener);
        return () => this.emitter.off(topic, listener);
    }
}

export const EventBus = new GlobalEventBus();
