import type { AgentEvent } from '../types';
export interface Transport {
    emit(event: AgentEvent): void;
    onInput(handler: (input: string) => void): Unsubscribe;
    close(): void;
}
export type Unsubscribe = () => void;
//# sourceMappingURL=Transport.d.ts.map