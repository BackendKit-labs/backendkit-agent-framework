#!/usr/bin/env node
/**
 * Test para Backend-MCP con AgentMCPServer.
 * Importa desde source .ts via tsx.
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('\n🧪 Test: Backend-MCP (AgentMCPServer)\n');

// ── Test 1: Tools registradas correctamente ─────────────────────────────────
console.log('1. Tools registradas');

// Importar dinámicamente con tsx
const { BACKEND_TOOLS } = await import('./src/tools/index.ts');

assert(Array.isArray(BACKEND_TOOLS), 'BACKEND_TOOLS es un array');
assert(BACKEND_TOOLS.length === 4, '4 tools registradas');

const toolNames = BACKEND_TOOLS.map(t => t.name);
assert(toolNames.includes('implement_feature'), 'implement_feature registrada');
assert(toolNames.includes('read_project_files'), 'read_project_files registrada');
assert(toolNames.includes('write_code'), 'write_code registrada');
assert(toolNames.includes('execute_command'), 'execute_command registrada');

// ── Test 2: Cada tool tiene schema Zod ──────────────────────────────────────
console.log('\n2. Schemas Zod');
for (const tool of BACKEND_TOOLS) {
  const schemaKeys = Object.keys(tool.schema);
  assert(schemaKeys.length > 0, `${tool.name}: schema con ${schemaKeys.length} campos`);
}

// ── Test 3: buildPrompt es síncrono y retorna string ────────────────────────
console.log('\n3. buildPrompt síncrono');
for (const tool of BACKEND_TOOLS) {
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

// ── Test 4: AgentMCPServer se construye sin errores ─────────────────────────
console.log('\n4. AgentMCPServer construction');
try {
  const { AgentMCPServer } = await import('@backendkit-labs/mcp-server');
  const { CallbackTransport } = await import('@backendkit-labs/agent-core');
  const { createCodingEngine } = await import('@backendkit-labs/agent-coding');

  const server = new AgentMCPServer({
    name: 'backend-mcp-test',
    version: '1.0.0',
    tools: BACKEND_TOOLS,
    engineFactory: (transport) => createCodingEngine({
      providers: { deepseek: { apiKey: 'test-key', model: 'deepseek-chat' } },
      defaultProvider: 'deepseek',
      transport,
      disablePersistence: true,
    }),
  });
  assert(true, 'Server creado correctamente');
} catch (err) {
  assert(false, `Error creando server: ${err.message}`);
}

// ── Test 5: implement_feature buildPrompt incluye datos de args ─────────────
console.log('\n5. implement_feature buildPrompt contenido');
const implTool = BACKEND_TOOLS.find(t => t.name === 'implement_feature');
const implPrompt = implTool.buildPrompt({
  specPath: '/path/to/spec.md',
  roadmapPath: '/path/to/roadmap.md',
  currentPhase: 2,
  vaultNamespace: 'test-project',
});
assert(implPrompt.includes('/path/to/spec.md'), 'Incluye specPath');
assert(implPrompt.includes('/path/to/roadmap.md'), 'Incluye roadmapPath');
assert(implPrompt.includes('Phase 2'), 'Incluye currentPhase');
assert(implPrompt.includes('test-project'), 'Incluye vaultNamespace');

// ── Test 6: write_code buildPrompt incluye filePath y content ───────────────
console.log('\n6. write_code buildPrompt contenido');
const writeTool = BACKEND_TOOLS.find(t => t.name === 'write_code');
const writePrompt = writeTool.buildPrompt({
  filePath: 'src/test.ts',
  content: 'export const x = 1;',
});
assert(writePrompt.includes('src/test.ts'), 'Incluye filePath');
assert(writePrompt.includes('export const x = 1;'), 'Incluye content');

// ── Test 7: execute_command buildPrompt incluye command ─────────────────────
console.log('\n7. execute_command buildPrompt contenido');
const execTool = BACKEND_TOOLS.find(t => t.name === 'execute_command');
const execPrompt = execTool.buildPrompt({
  command: 'npm test',
  cwd: 'src',
});
assert(execPrompt.includes('npm test'), 'Incluye command');
assert(execPrompt.includes('src'), 'Incluye cwd');

// ── Test 8: read_project_files buildPrompt incluye paths ────────────────────
console.log('\n8. read_project_files buildPrompt contenido');
const readTool = BACKEND_TOOLS.find(t => t.name === 'read_project_files');
const readPrompt = readTool.buildPrompt({
  paths: ['src/file1.ts', 'src/file2.ts'],
});
assert(readPrompt.includes('src/file1.ts'), 'Incluye paths[0]');
assert(readPrompt.includes('src/file2.ts'), 'Incluye paths[1]');

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
