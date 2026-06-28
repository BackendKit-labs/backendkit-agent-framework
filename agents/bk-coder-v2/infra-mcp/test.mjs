#!/usr/bin/env node
/**
 * Test para Infrastructure-MCP con AgentMCPServer.
 */

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('\n🧪 Test: Infrastructure-MCP (AgentMCPServer)\n');

const { INFRA_TOOLS } = await import('./src/tools/index.ts');

// ── Test 1: Tools registradas ───────────────────────────────────────────────
console.log('1. Tools registradas');
assert(Array.isArray(INFRA_TOOLS), 'INFRA_TOOLS es un array');
assert(INFRA_TOOLS.length === 4, '4 tools registradas');

const toolNames = INFRA_TOOLS.map(t => t.name);
assert(toolNames.includes('generate_docker'), 'generate_docker registrada');
assert(toolNames.includes('generate_compose'), 'generate_compose registrada');
assert(toolNames.includes('generate_cicd'), 'generate_cicd registrada');
assert(toolNames.includes('generate_k8s'), 'generate_k8s registrada');

// ── Test 2: Schemas Zod ─────────────────────────────────────────────────────
console.log('\n2. Schemas Zod');
for (const tool of INFRA_TOOLS) {
  const schemaKeys = Object.keys(tool.schema);
  assert(schemaKeys.length > 0, `${tool.name}: schema con ${schemaKeys.length} campos`);
}

// ── Test 3: buildPrompt síncrono ────────────────────────────────────────────
console.log('\n3. buildPrompt síncrono');
for (const tool of INFRA_TOOLS) {
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
    name: 'infra-mcp-test',
    version: '1.0.0',
    tools: INFRA_TOOLS,
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

// ── Test 5: generate_docker buildPrompt ─────────────────────────────────────
console.log('\n5. generate_docker buildPrompt contenido');
const dockerTool = INFRA_TOOLS.find(t => t.name === 'generate_docker');
const dockerPrompt = dockerTool.buildPrompt({
  projectRoot: '/project',
  stack: 'node',
  nodeVersion: '20',
  exposePort: 3000,
});
assert(dockerPrompt.includes('/project'), 'Incluye projectRoot');
assert(dockerPrompt.includes('node'), 'Incluye stack');
assert(dockerPrompt.includes('20'), 'Incluye nodeVersion');
assert(dockerPrompt.includes('3000'), 'Incluye exposePort');
assert(dockerPrompt.includes('Dockerfile'), 'Incluye Dockerfile');

// ── Test 6: generate_compose buildPrompt ────────────────────────────────────
console.log('\n6. generate_compose buildPrompt contenido');
const composeTool = INFRA_TOOLS.find(t => t.name === 'generate_compose');
const composePrompt = composeTool.buildPrompt({
  projectRoot: '/project',
  stack: 'node',
  services: ['postgres', 'redis'],
  exposePort: 3000,
});
assert(composePrompt.includes('/project'), 'Incluye projectRoot');
assert(composePrompt.includes('postgres'), 'Incluye servicios');
assert(composePrompt.includes('redis'), 'Incluye redis');
assert(composePrompt.includes('docker-compose.yml'), 'Incluye docker-compose.yml');

// ── Test 7: generate_cicd buildPrompt ───────────────────────────────────────
console.log('\n7. generate_cicd buildPrompt contenido');
const cicdTool = INFRA_TOOLS.find(t => t.name === 'generate_cicd');
const cicdPrompt = cicdTool.buildPrompt({
  projectRoot: '/project',
  stack: 'node',
  platform: 'github-actions',
});
assert(cicdPrompt.includes('/project'), 'Incluye projectRoot');
assert(cicdPrompt.includes('github-actions'), 'Incluye platform');
assert(cicdPrompt.includes('.github/workflows/ci.yml'), 'Incluye ruta GitHub Actions');

const cicdPromptGitlab = cicdTool.buildPrompt({
  projectRoot: '/project',
  stack: 'python',
  platform: 'gitlab-ci',
});
assert(cicdPromptGitlab.includes('gitlab-ci'), 'Incluye gitlab-ci');
assert(cicdPromptGitlab.includes('.gitlab-ci.yml'), 'Incluye ruta GitLab CI');

// ── Test 8: generate_k8s buildPrompt ────────────────────────────────────────
console.log('\n8. generate_k8s buildPrompt contenido');
const k8sTool = INFRA_TOOLS.find(t => t.name === 'generate_k8s');
const k8sPrompt = k8sTool.buildPrompt({
  projectRoot: '/project',
  appName: 'my-app',
  exposePort: 8080,
  replicas: 3,
});
assert(k8sPrompt.includes('/project'), 'Incluye projectRoot');
assert(k8sPrompt.includes('my-app'), 'Incluye appName');
assert(k8sPrompt.includes('8080'), 'Incluye exposePort');
assert(k8sPrompt.includes('3'), 'Incluye replicas');
assert(k8sPrompt.includes('deployment.yaml'), 'Incluye deployment.yaml');
assert(k8sPrompt.includes('service.yaml'), 'Incluye service.yaml');
assert(k8sPrompt.includes('configmap.yaml'), 'Incluye configmap.yaml');

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
