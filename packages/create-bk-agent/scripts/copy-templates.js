#!/usr/bin/env node
/**
 * Copies packages/templates/* → packages/create-bk-agent/templates/
 * before packing/publishing so the CLI can bundle all templates.
 * Run automatically via the "prepack" script.
 */
const { cpSync, rmSync, existsSync } = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '../../templates');
const dst = path.resolve(__dirname, '../templates');

if (!existsSync(src)) {
    console.error(`[copy-templates] Source not found: ${src}`);
    process.exit(1);
}

if (existsSync(dst)) rmSync(dst, { recursive: true, force: true });
cpSync(src, dst, { recursive: true });

const dirs = require('fs').readdirSync(dst);
console.log(`[copy-templates] Copied ${dirs.length} templates: ${dirs.join(', ')}`);
