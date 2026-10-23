import { mkdirSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Writes a file as a temp file renamed over the real one, one write at a time, so a crash leaves the previous complete
 * content. On Windows a rename can be refused for a moment while another process (an antivirus, an indexer) holds the target.
 */
export class AtomicFile {
    private chain: Promise<unknown> = Promise.resolve();

    constructor(private readonly file: string) {}

    write(text: string): Promise<void> {
        const file = this.file;
        const run = async () => {
            mkdirSync(dirname(file), { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            await writeFile(tmp, text, 'utf8');
            for (let attempt = 0; ; attempt++) {
                try { await rename(tmp, file); return; }
                catch (err) {
                    const code = (err as NodeJS.ErrnoException).code;
                    if (attempt >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
                    await new Promise(r => setTimeout(r, 20 * (attempt + 1)));
                }
            }
        };
        const next = this.chain.then(run, run);
        this.chain = next.catch(() => undefined);
        return next;
    }

    flush(): Promise<void> { return this.chain.then(() => undefined); }
}
