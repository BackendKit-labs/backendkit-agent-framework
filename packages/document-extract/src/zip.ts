import { DocumentExtractError } from './errors';

export interface ZipListing {
    names: string[];
    uncompressedBytes: number;
}

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;

/**
 * Reads only the central directory of a ZIP, without inflating anything, so a decompression bomb is refused BEFORE
 * any library opens it. The sizes are the ones the archive declares; see the README for what that does not cover.
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

    const names: string[] = [];
    let total = 0;
    let at = offset;
    for (let n = 0; n < count; n++) {
        if (at + 46 > bytes.length || view.getUint32(at, true) !== CENTRAL) throw new DocumentExtractError('CORRUPT', 'damaged ZIP directory');
        const flags = view.getUint16(at + 8, true);
        const size = view.getUint32(at + 24, true);
        const nameLen = view.getUint16(at + 28, true);
        const extraLen = view.getUint16(at + 30, true);
        const commentLen = view.getUint16(at + 32, true);
        if (flags & 1) throw new DocumentExtractError('ENCRYPTED');
        if (size === 0xffffffff) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', 'ZIP64 entry');
        total += size;
        if (total > maxUncompressedBytes) throw new DocumentExtractError('ARCHIVE_TOO_LARGE', `expands to more than ${maxUncompressedBytes} bytes`);
        names.push(Buffer.from(bytes.subarray(at + 46, at + 46 + nameLen)).toString('utf8'));
        at += 46 + nameLen + extraLen + commentLen;
    }
    return { names, uncompressedBytes: total };
}
