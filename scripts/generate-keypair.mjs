#!/usr/bin/env node
/**
 * Genera un keypair Ed25519 y lo imprime listo para pegar en .env
 * Uso: node scripts/generate-keypair.mjs
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).replace(/\n/g, '\\n');
const pubPem  = publicKey.export({ type: 'spki',  format: 'pem' }).replace(/\n/g, '\\n');

const jwtSecret      = randomBytes(32).toString('hex');
const nextauthSecret = randomBytes(32).toString('hex');

console.log(`
# ── Generado por scripts/generate-keypair.mjs ─────────────────────────────────
# Pegá estos valores en tu .env (o .env.local para desarrollo)

JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=7d

ED25519_PRIVATE_KEY="${privPem}"
ED25519_PUBLIC_KEY="${pubPem}"

NEXTAUTH_SECRET=${nextauthSecret}
# ──────────────────────────────────────────────────────────────────────────────
`);
