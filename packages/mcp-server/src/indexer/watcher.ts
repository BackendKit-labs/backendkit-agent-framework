import chokidar from 'chokidar';
import * as path from 'path';
import { registeredExtensions } from './languages/index';
import type { CodeIndexer } from './indexer';

const DEBOUNCE_MS = 500;

export class FileWatcher {
    private watcher: ReturnType<typeof chokidar.watch> | null = null;
    private timers = new Map<string, ReturnType<typeof setTimeout>>();

    start(dir: string, indexer: CodeIndexer): void {
        const extensions = registeredExtensions();
        const glob = `**/*{${extensions.join(',')}}`;

        this.watcher = chokidar.watch(path.join(dir, glob), {
            ignored: [
                /node_modules/,
                /[/\\]\./,
                /dist[/\\]/,
                /build[/\\]/,
                /coverage[/\\]/,
            ],
            persistent: true,
            ignoreInitial: true,
        });

        const schedule = (filePath: string, action: () => void) => {
            const existing = this.timers.get(filePath);
            if (existing) clearTimeout(existing);
            this.timers.set(filePath, setTimeout(() => {
                this.timers.delete(filePath);
                action();
            }, DEBOUNCE_MS));
        };

        this.watcher
            .on('add', f => schedule(f, () => indexer.indexFile(f)))
            .on('change', f => schedule(f, () => indexer.indexFile(f)))
            .on('unlink', f => schedule(f, () => indexer.removeFile(f)));
    }

    stop(): Promise<void> {
        for (const t of this.timers.values()) clearTimeout(t);
        this.timers.clear();
        return this.watcher?.close() ?? Promise.resolve();
    }
}
