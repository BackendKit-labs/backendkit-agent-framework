/** The body of a response as text, refusing to read more than `max` bytes. */
export async function readLimited(resp: Response, max: number, what: string): Promise<string> {
    const declared = Number(resp.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) throw new Error(`${what} is too large (${declared} bytes; the limit is ${max})`);
    if (!resp.body) {
        const text = await resp.text();
        if (Buffer.byteLength(text) > max) throw new Error(`${what} is too large (more than ${max} bytes)`);
        return text;
    }
    const reader = resp.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > max) {
            await reader.cancel().catch(() => undefined);
            throw new Error(`${what} is too large (more than ${max} bytes)`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf-8');
}
