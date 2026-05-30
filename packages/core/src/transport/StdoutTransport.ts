import * as readline from 'readline';
import type { AgentEvent } from '../types';
import type { Transport, Unsubscribe } from './Transport';

export class StdoutTransport implements Transport {
    // Singleton readline interface — prevents listener accumulation when
    // onInput() is called multiple times (e.g. on workspace switch).
    private rl: readline.Interface | null = null;

    emit(event: AgentEvent): void {
        process.stdout.write(JSON.stringify(event) + '\n');
    }

    onInput(handler: (input: string) => void): Unsubscribe {
        if (!this.rl) {
            this.rl = readline.createInterface({ input: process.stdin });
        }
        const listener = (line: string) => {
            const trimmed = line.trim();
            if (trimmed) handler(trimmed);
        };
        this.rl.on('line', listener);
        return () => { this.rl?.off('line', listener); };
    }

    close(): void {
        this.rl?.close();
        this.rl = null;
    }
}
