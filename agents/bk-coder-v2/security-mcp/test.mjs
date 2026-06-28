#!/usr/bin/env node
/**
 * Test para Security-MCP con AgentMCPServer.
 * Verifica tools, buildPrompt y detección OWASP.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('\n🧪 Test: Security-MCP (AgentMCPServer)\n');

const { SECURITY_TOOLS } = await import('./src/tools/index.ts');

// ── Test 1: Tools registradas ───────────────────────────────────────────────
console.log('1. Tools registradas');
assert(Array.isArray(SECURITY_TOOLS), 'SECURITY_TOOLS es un array');
assert(SECURITY_TOOLS.length === 1, '1 tool registrada');
assert(SECURITY_TOOLS[0].name === 'security_review', 'security_review registrada');

// ── Test 2: Schema Zod ──────────────────────────────────────────────────────
console.log('\n2. Schema Zod');
const schemaKeys = Object.keys(SECURITY_TOOLS[0].schema);
assert(schemaKeys.length === 3, 'schema con 3 campos');
assert(schemaKeys.includes('codePaths'), 'Incluye codePaths');
assert(schemaKeys.includes('vaultNamespace'), 'Incluye vaultNamespace');
assert(schemaKeys.includes('domain'), 'Incluye domain');

// ── Test 3: buildPrompt síncrono ────────────────────────────────────────────
console.log('\n3. buildPrompt síncrono');
const prompt = SECURITY_TOOLS[0].buildPrompt({
  codePaths: ['/tmp/test'],
  vaultNamespace: 'security-test',
  domain: 'auth',
});
assert(typeof prompt === 'string' && prompt.length > 0, `buildPrompt retorna string (${prompt.length} chars)`);
assert(prompt.includes('security-test'), 'Incluye vaultNamespace');
assert(prompt.includes('auth'), 'Incluye domain');

// ── Test 4: AgentMCPServer se construye ─────────────────────────────────────
console.log('\n4. AgentMCPServer construction');
try {
  const { AgentMCPServer } = await import('@backendkit-labs/mcp-server');
  const { CallbackTransport } = await import('@backendkit-labs/agent-core');
  const { createCodingEngine } = await import('@backendkit-labs/agent-coding');

  const server = new AgentMCPServer({
    name: 'security-mcp-test',
    version: '1.0.0',
    tools: SECURITY_TOOLS,
    engineFactory: (transport) => createCodingEngine({
      providers: { openai: { apiKey: 'test-key', model: 'gpt-4o' } },
      defaultProvider: 'openai',
      transport,
      disablePersistence: true,
    }),
  });
  assert(true, 'Server creado correctamente');
} catch (err) {
  assert(false, `Error creando server: ${err.message}`);
}

// ── Test 5: Detección OWASP en buildPrompt ──────────────────────────────────
console.log('\n5. Detección OWASP en buildPrompt');

// Crear archivo temporal con vulnerabilidades
const tmpDir = mkdtempSync(path.join(tmpdir(), 'security-test-'));
const srcDir = path.join(tmpDir, 'src');
mkdirSync(srcDir, { recursive: true });
writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'test' }));

const vulnerableCode = `
import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

@Injectable()
export class AuthService {
  private readonly apiKey = 'sk-1234567890abcdef';
  private readonly password = 'super-secret-123';

  async login(username, password) {
    const query = 'SELECT * FROM users WHERE username = ' + username;
    return await this.db.execute(query);
  }

  hashData(data) {
    return createHash('md5').update(data).digest('hex');
  }

  renderPage(input) {
    document.getElementById('output').innerHTML = input;
  }

  runCommand(cmd) {
    exec('ls -la ' + cmd);
  }

  parseData(jsonStr) {
    return JSON.parse(jsonStr);
  }
}
`;
writeFileSync(path.join(srcDir, 'auth.service.ts'), vulnerableCode);

const cleanCode = `
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ConfigService {
  constructor(private config: ConfigService) {}
  getDbUrl() { return process.env.DATABASE_URL; }
  getApiKey() { return process.env.API_KEY; }
}
`;
writeFileSync(path.join(srcDir, 'config.service.ts'), cleanCode);

// Ejecutar buildPrompt con los archivos reales
const reviewPrompt = SECURITY_TOOLS[0].buildPrompt({
  codePaths: [srcDir],
  vaultNamespace: 'test-security',
  domain: 'auth',
});

// Verificar que el prompt incluye los hallazgos OWASP
assert(reviewPrompt.includes('Hardcoded') || reviewPrompt.includes('hardcoded'), 'Detecta hardcoded secrets');
assert(reviewPrompt.includes('SQL'), 'Detecta SQL injection');
assert(reviewPrompt.includes('innerHTML') || reviewPrompt.includes('XSS'), 'Detecta XSS');
assert(reviewPrompt.includes('md5') || reviewPrompt.includes('weak'), 'Detecta crypto débil');
assert(reviewPrompt.includes('command') || reviewPrompt.includes('Command'), 'Detecta command injection');
assert(reviewPrompt.includes('JSON.parse') || reviewPrompt.includes('deserialization'), 'Detecta deserialization insegura');

// Verificar que el reporte se generó
const reportPath = path.join(tmpDir, '.security', 'security-review.md');
assert(fs.existsSync(reportPath), 'Reporte generado en .security/security-review.md');

const reportContent = fs.readFileSync(reportPath, 'utf-8');
assert(reportContent.includes('FAIL'), 'Veredicto FAIL por vulnerabilidades críticas');
assert(reportContent.includes('CWE-798'), 'Incluye CWE-798 (hardcoded secrets)');
assert(reportContent.includes('CWE-89'), 'Incluye CWE-89 (SQL injection)');

// Verificar que el archivo limpio no generó falsos positivos
assert(!reportContent.includes('config.service'), 'Sin falsos positivos en archivo limpio');

// Limpiar
rmSync(tmpDir, { recursive: true, force: true });

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
