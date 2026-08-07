#!/usr/bin/env node
/**
 * Genera un keypair Ed25519 en formato nacl (tweetnacl) listo para pegar en .env
 * Uso: node scripts/generate-keypair.mjs
 *
 * Formato de claves:
 *   ED25519_PRIVATE_KEY — 64 bytes Base64 (nacl secretKey = seed[32] + pubkey[32])
 *   ED25519_PUBLIC_KEY  — 32 bytes Base64 (nacl publicKey)
 */

import { generateKeyPairSync, randomBytes } from 'node:crypto';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');

// Extraer bytes crudos desde DER (sin PEM headers)
// PKCS8 DER para Ed25519: los últimos 32 bytes son el seed
const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
const seed    = privDer.slice(-32);

// SPKI DER para Ed25519: los últimos 32 bytes son la clave pública
const pubDer  = publicKey.export({ type: 'spki', format: 'der' });
const pub     = pubDer.slice(-32);

// nacl secretKey = seed (32) + publicKey (32) = 64 bytes
const naclPriv = Buffer.concat([seed, pub]).toString('base64');
const naclPub  = pub.toString('base64');

const jwtSecret      = randomBytes(32).toString('hex');
const nextauthSecret = randomBytes(32).toString('hex');

console.log(`
# ── Generado por scripts/generate-keypair.mjs ─────────────────────────────────
# Pegá estos valores en tu .env

JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=7d

ED25519_PRIVATE_KEY=${naclPriv}
ED25519_PUBLIC_KEY=${naclPub}

NEXTAUTH_SECRET=${nextauthSecret}
# ──────────────────────────────────────────────────────────────────────────────
`);
