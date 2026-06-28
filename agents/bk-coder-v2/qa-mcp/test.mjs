#!/usr/bin/env node
/**
 * Test para QA-MCP con AgentMCPServer.
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('\n🧪 Test: QA-MCP (AgentMCPServer)\n');

const { QA_TOOLS } = await import('./src/tools/index.ts');

// ── Test 1: Tools registradas ───────────────────────────────────────────────
console.log('1. Tools registradas');
assert(Array.isArray(QA_TOOLS), 'QA_TOOLS es un array');
assert(QA_TOOLS.length === 3, '3 tools registradas');

const toolNames = QA_TOOLS.map(t => t.name);
assert(toolNames.includes('run_qa_phase'), 'run_qa_phase registrada');
assert(toolNames.includes('validate_against_spec'), 'validate_against_spec registrada');
assert(toolNames.includes('generate_tests'), 'generate_tests registrada');

// ── Test 2: Schemas Zod ─────────────────────────────────────────────────────
console.log('\n2. Schemas Zod');
for (const tool of QA_TOOLS) {
  const schemaKeys = Object.keys(tool.schema);
  assert(schemaKeys.length > 0, `${tool.name}: schema con ${schemaKeys.length} campos`);
}

// ── Test 3: buildPrompt síncrono ────────────────────────────────────────────
console.log('\n3. buildPrompt síncrono');
for (const tool of QA_TOOLS) {
  const mockArgs = {};
  for (const key of Object.keys(tool.schema)) {
    const z = tool.schema[key];
    if (z._def?.typeName === 'ZodString') mockArgs[key] = 'test';
    else if (z._def?.typeName === 'ZodNumber') mockArgs[key] = 1;
    else if (z._def?.typeName === 'ZodArray') mockArgs[key] = ['test'];
    else mockArgs[key] = 'test';
  }
  const prompt = tool.buildPrompt(mockArgs);
  assert(typeof prompt === 'string' && prompt.length > 0, `${tool.name}: buildPrompt retorna string (${prompt.length} chars)`);
}

// ── Test 4: AgentMCPServer se construye ─────────────────────────────────────
console.log('\n4. AgentMCPServer construction');
try {
  const { AgentMCPServer } = await import('@backendkit-labs/mcp-server');
  const { CallbackTransport } = await import('@backendkit-labs/agent-core');
  const { createCodingEngine } = await import('@backendkit-labs/agent-coding');

  const server = new AgentMCPServer({
    name: 'qa-mcp-test',
    version: '1.0.0',
    tools: QA_TOOLS,
    engineFactory: (transport) => createCodingEngine({
      providers: { anthropic: { apiKey: 'test-key', model: 'claude-sonnet-4-20250514' } },
      defaultProvider: 'anthropic',
      transport,
      disablePersistence: true,
    }),
  });
  assert(true, 'Server creado correctamente');
} catch (err) {
  assert(false, `Error creando server: ${err.message}`);
}

// ── Test 5: run_qa_phase buildPrompt incluye args ───────────────────────────
console.log('\n5. run_qa_phase buildPrompt contenido');
const qaTool = QA_TOOLS.find(t => t.name === 'run_qa_phase');
const qaPrompt = qaTool.buildPrompt({
  specPath: '/path/to/spec.md',
  phaseNumber: 3,
  codePaths: ['src/file1.ts', 'src/file2.ts'],
  vaultNamespace: 'qa-project',
  designPath: '/path/to/design.md',
});
assert(qaPrompt.includes('/path/to/spec.md'), 'Incluye specPath');
assert(qaPrompt.includes('Phase 3'), 'Incluye phaseNumber');
assert(qaPrompt.includes('src/file1.ts'), 'Incluye codePaths');
assert(qaPrompt.includes('qa-project'), 'Incluye vaultNamespace');
assert(qaPrompt.includes('/path/to/design.md'), 'Incluye designPath');

// ── Test 6: validate_against_spec buildPrompt ───────────────────────────────
console.log('\n6. validate_against_spec buildPrompt contenido');
const valTool = QA_TOOLS.find(t => t.name === 'validate_against_spec');
const valPrompt = valTool.buildPrompt({
  specPath: '/path/to/spec.md',
  criterionId: 'RF-001',
  codePath: 'src/auth.service.ts',
});
assert(valPrompt.includes('/path/to/spec.md'), 'Incluye specPath');
assert(valPrompt.includes('RF-001'), 'Incluye criterionId');
assert(valPrompt.includes('src/auth.service.ts'), 'Incluye codePath');

// ── Test 7: generate_tests buildPrompt ──────────────────────────────────────
console.log('\n7. generate_tests buildPrompt contenido');
const genTool = QA_TOOLS.find(t => t.name === 'generate_tests');
const genPrompt = genTool.buildPrompt({
  specPath: '/path/to/spec.md',
  codePaths: ['src/service.ts', 'src/controller.ts'],
});
assert(genPrompt.includes('/path/to/spec.md'), 'Incluye specPath');
assert(genPrompt.includes('src/service.ts'), 'Incluye codePaths[0]');
assert(genPrompt.includes('src/controller.ts'), 'Incluye codePaths[1]');

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
