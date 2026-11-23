import { inflateRawSync } from 'zlib';
import { DocumentExtractError } from './errors';

export interface ZipListing {
    names: string[];
    /** What the entries really expand to (measured by inflating them, not read from the directory). */
    uncompressedBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/**
 * Checks a ZIP BEFORE any library opens it, so a decompression bomb is refused first.
 *
 * Two layers. The sizes the directory declares are summed first (cheap, refuses an honest bomb at once). Then every entry is
 * actually inflated, with an output cap equal to what is left of `maxUncompressedBytes`: an archive that lies in its
 * directory (declares a few bytes, expands to gigabytes) is stopped by the cap, not by the declaration. Nothing is kept: the
 * inflated bytes are dropped, only their length is counted.
 */
export function listZip(bytes: Uint8Array, maxEntries: number, maxUncompressedBytes: number): ZipListing {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
        if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new DocumentExtractError('CORRUPT', 'not a readable ZIP archive');
    const count = view.getUint16(eocd + 10, true);
    const offset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || offset === 0xffffffff) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', 'ZIP64 archive');
    if (count > maxEntries) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', `${count} entries`);

    interface Entry { name: string; method: number; compressed: number; localOffset: number }
    const entries: Entry[] = [];
    let declared = 0;
    let at = offset;
    for (let n = 0; n < count; n++) {
        if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new DocumentExtractError('CORRUPT', 'damaged ZIP directory');
        const flags = view.getUint16(at + 8, true);
        const method = view.getUint16(at + 10, true);
        const compressed = view.getUint32(at + 20, true);
        const size = view.getUint32(at + 24, true);
        const nameLen = view.getUint16(at + 28, true);
        const extraLen = view.getUint16(at + 30, true);
        const commentLen = view.getUint16(at + 32, true);
        const localOffset = view.getUint32(at + 42, true);
        if (flags & 1) throw new DocumentExtractError('ENCRYPTED');
        if (size === 0xffffffff || compressed === 0xffffffff || localOffset === 0xffffffff) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', 'ZIP64 entry');
        declared += size;
        if (declared > maxUncompressedBytes) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', `expands to more than ${maxUncompressedBytes} bytes`);
        entries.push({ name: Buffer.from(bytes.subarray(at + 46, at + 46 + nameLen)).toString('utf8'), method, compressed, localOffset });
        at += 46 + nameLen + extraLen + commentLen;
    }

    // What it REALLY expands to. The sizes come from the central directory (the local header's are 0 when a data descriptor is used);
    // the local header is read only for where the data starts, since its name and extra lengths may differ from the central ones.
    let real = 0;
    for (const entry of entries) {
        const h = entry.localOffset;
        if (h + 30 > bytes.length || view.getUint32(h, true) !== LOCAL) throw new DocumentExtractError('CORRUPT', 'damaged ZIP entry');
        const start = h + 30 + view.getUint16(h + 26, true) + view.getUint16(h + 28, true);
        const end = start + entry.compressed;
        if (end > bytes.length) throw new DocumentExtractError('CORRUPT', 'ZIP entry runs past the end of the file');
        const data = bytes.subarray(start, end);
        const room = maxUncompressedBytes - real;
        if (entry.method === 0) {
            real += data.length; // stored: its size is its length
        } else if (entry.method === 8) {
            try {
                // maxOutputLength is the real brake: inflation stops with an error as soon as the output would pass it.
                real += inflateRawSync(data, { maxOutputLength: Math.max(1, room + 1) }).length;
            } catch (err) {
                const code = (err as { code?: string } | null)?.code;
                if (code === 'ERR_BUFFER_TOO_LARGE' || err instanceof RangeError) {
                    throw new DocumentExtractError('ARCHIVE_TOO_LARGE', `expands to more than ${maxUncompressedBytes} bytes`);
                }
                throw new DocumentExtractError('CORRUPT', 'a part of the ZIP could not be inflated');
            }
        } else {
            throw new DocumentExtractError('UNSUPPORTED_FORMAT', `ZIP compression method ${entry.method}`);
        }
        if (real > maxUncompressedBytes) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', `expands to more than ${maxUncompressedBytes} bytes`);
    }
    return { names: entries.map(e => e.name), uncompressedBytes: real };
}
