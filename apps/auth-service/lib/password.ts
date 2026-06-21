import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString('hex');
    const hash = await scryptAsync(password, salt, 64) as Buffer;
    return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
    try {
        const [salt, hashHex] = stored.split(':');
        const hash       = await scryptAsync(password, salt!, 64) as Buffer;
        const storedHash = Buffer.from(hashHex!, 'hex');
        return timingSafeEqual(hash, storedHash);
    } catch { return false; }
}
