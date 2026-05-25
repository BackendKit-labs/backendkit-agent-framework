import * as readline from 'readline';
import type { AgentEvent } from '../types';
import type { Transport, Unsubscribe } from './Transport';

export class StdoutTransport implements Transport {
    emit(event: AgentEvent): void {
        process.stdout.write(JSON.stringify(event) + '\n');
    }

    onInput(handler: (input: string) => void): Unsubscribe {
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
            const trimmed = line.trim();
            if (trimmed) handler(trimmed);
        });
        return () => rl.close();
    }

    close(): void {}
}
