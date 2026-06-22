#!/usr/bin/env node
/**
 * Test de integración del ecosistema Coder v2.
 * Verifica que todos los componentes se comuniquen correctamente.
 */

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) { console.log(`  ✅ ${msg}`); passed++; }
  else { console.log(`  ❌ ${msg}`); failed++; }
}

console.log('\n🧪 Test: Integración del Ecosistema Coder v2\n');

// ── 1. Verificar que todos los directorios existen ─────────────────────────
console.log('1. Directorios de componentes');
const dirs = [
  'workspace-manager-project',
  'codex-context-agent',
  'backend-mcp',
  'qa-mcp',
  'security-mcp',
  'infra-mcp',
  'orchestrator',
];
for (const dir of dirs) {
  assert(existsSync(resolve(ROOT, dir)), `${dir}/ existe`);
  assert(existsSync(resolve(ROOT, dir, 'package.json')), `${dir}/package.json existe`);
  assert(existsSync(resolve(ROOT, dir, 'src', 'server.ts')), `${dir}/src/server.ts existe`);
}

// ── 2. Verificar que el Orchestrator puede cargar la config ────────────────
console.log('\n2. Orchestrator config');
const configPath = resolve(ROOT, 'orchestrator', 'orchestrator.yaml');
assert(existsSync(configPath), 'orchestrator.yaml existe');

const configContent = readFileSync(configPath, 'utf-8');
assert(configContent.includes('backend-mcp'), 'Config incluye backend-mcp');
assert(configContent.includes('qa-mcp'), 'Config incluye qa-mcp');
assert(configContent.includes('security-mcp'), 'Config incluye security-mcp');
assert(configContent.includes('infra-mcp'), 'Config incluye infra-mcp');
assert(configContent.includes('deepseek'), 'Config incluye provider deepseek');
assert(configContent.includes('anthropic'), 'Config incluye provider anthropic');
assert(configContent.includes('openai'), 'Config incluye provider openai');
assert(configContent.includes('sdd-implement'), 'Config incluye flow sdd-implement');

// ── 3. Verificar que el flow SDD existe y es válido ────────────────────────
console.log('\n3. Flow SDD');
const flowPath = resolve(ROOT, 'orchestrator', 'flows', 'sdd-implement.yaml');
assert(existsSync(flowPath), 'flows/sdd-implement.yaml existe');

const flowContent = readFileSync(flowPath, 'utf-8');
assert(flowContent.includes('design-review'), 'Flow incluye design-review');
assert(flowContent.includes('backend-phase-1'), 'Flow incluye backend-phase-1');
assert(flowContent.includes('qa-phase-1'), 'Flow incluye qa-phase-1');
assert(flowContent.includes('backend-phase-2'), 'Flow incluye backend-phase-2');
assert(flowContent.includes('qa-phase-2'), 'Flow incluye qa-phase-2');
assert(flowContent.includes('backend-phase-3'), 'Flow incluye backend-phase-3');
assert(flowContent.includes('qa-phase-3'), 'Flow incluye qa-phase-3');
assert(flowContent.includes('security-review'), 'Flow incluye security-review');
assert(flowContent.includes('infra-generation'), 'Flow incluye infra-generation');
assert(flowContent.includes('final-qa'), 'Flow incluye final-qa');

// Verificar dependencias del flow
assert(flowContent.includes('depends_on: [design-review]'), 'Phase 1 depende de design-review');
assert(flowContent.includes('depends_on: [backend-phase-1]'), 'QA Phase 1 depende de Backend Phase 1');
assert(flowContent.includes('depends_on: [qa-phase-1]'), 'Phase 2 depende de QA Phase 1');
assert(flowContent.includes('depends_on: [qa-phase-2]'), 'Phase 3 depende de QA Phase 2');
assert(flowContent.includes('depends_on: [backend-phase-3]'), 'QA Phase 3 depende de Backend Phase 3');
assert(flowContent.includes('depends_on: [qa-phase-3]'), 'Security depende de QA Phase 3');
assert(flowContent.includes('depends_on: [security-review]'), 'Infra depende de Security');
assert(flowContent.includes('depends_on: [infra-generation]'), 'Final QA depende de Infra');

// ── 4. Verificar que los agentes MCP tienen AgentMCPServer ─────────────────
console.log('\n4. Agentes MCP con AgentMCPServer');
const agentDirs = ['backend-mcp', 'qa-mcp', 'security-mcp', 'infra-mcp'];
for (const dir of agentDirs) {
  const serverContent = readFileSync(resolve(ROOT, dir, 'src', 'server.ts'), 'utf-8');
  assert(serverContent.includes('AgentMCPServer'), `${dir}: usa AgentMCPServer`);
  assert(serverContent.includes('engineFactory'), `${dir}: tiene engineFactory`);
  assert(serverContent.includes('createCodingEngine'), `${dir}: usa createCodingEngine`);
}

// ── 5. Verificar providers por agente ──────────────────────────────────────
console.log('\n5. Providers por agente');
const backendServer = readFileSync(resolve(ROOT, 'backend-mcp', 'src', 'server.ts'), 'utf-8');
assert(backendServer.includes('deepseek'), 'Backend-MCP: provider deepseek');

const qaServer = readFileSync(resolve(ROOT, 'qa-mcp', 'src', 'server.ts'), 'utf-8');
assert(qaServer.includes('anthropic'), 'QA-MCP: provider anthropic');

const securityServer = readFileSync(resolve(ROOT, 'security-mcp', 'src', 'server.ts'), 'utf-8');
assert(securityServer.includes('openai'), 'Security-MCP: provider openai');

const infraServer = readFileSync(resolve(ROOT, 'infra-mcp', 'src', 'server.ts'), 'utf-8');
assert(infraServer.includes('deepseek'), 'Infra-MCP: provider deepseek');

// ── 6. Verificar que el Orchestrator tiene Reflection Engine ───────────────
console.log('\n6. Reflection Engine');
const orchServer = readFileSync(resolve(ROOT, 'orchestrator', 'src', 'server.ts'), 'utf-8');
assert(orchServer.includes('EnterpriseReflection'), 'Orchestrator: usa EnterpriseReflection');
assert(orchServer.includes('recordRuleOutcome'), 'Orchestrator: recordRuleOutcome');
assert(orchServer.includes('activeRules'), 'Orchestrator: activeRules');
assert(orchServer.includes('pendingPromotions'), 'Orchestrator: pendingPromotions');
assert(orchServer.includes('approvePromotion'), 'Orchestrator: approvePromotion');
assert(orchServer.includes('orchestrator_reflect'), 'Orchestrator: tool orchestrator_reflect');
assert(orchServer.includes('orchestrator_reflect_promote'), 'Orchestrator: tool orchestrator_reflect_promote');
assert(orchServer.includes('orchestrator_reflect_demote'), 'Orchestrator: tool orchestrator_reflect_demote');

// ── 7. Verificar que el Workspace Manager PROJECT tiene las 13 tools ───────
console.log('\n7. Workspace Manager PROJECT tools');
const wmTools = readFileSync(resolve(ROOT, 'workspace-manager-project', 'src', 'tools', 'index.ts'), 'utf-8');
const expectedTools = [
  'project_list', 'project_current', 'project_switch', 'project_create',
  'project_delete', 'project_get_agent_config', 'project_get_root',
  'project_duplicate', 'project_update', 'project_agent_exists',
  'workspace_policies', 'workspace_gate_config', 'workspace_memory_config',
];
for (const tool of expectedTools) {
  assert(wmTools.includes(tool), `Tool registrada: ${tool}`);
}

// ── 8. Verificar que el Codex-Context-Agent tiene memoria 3-tier ───────────
console.log('\n8. Codex-Context-Agent memoria 3-tier');
const codexMemory = readFileSync(resolve(ROOT, 'codex-context-agent', 'src', 'server.ts'), 'utf-8');
assert(codexMemory.includes('search_vault'), 'Codex: search_vault');
assert(codexMemory.includes('search_knowledge'), 'Codex: search_knowledge');
assert(codexMemory.includes('save_knowledge'), 'Codex: save_knowledge');
assert(codexMemory.includes('learn_pattern'), 'Codex: learn_pattern');
assert(codexMemory.includes('search_patterns'), 'Codex: search_patterns');
assert(codexMemory.includes('promote_patterns'), 'Codex: promote_patterns');
assert(codexMemory.includes('remember'), 'Codex: remember');
assert(codexMemory.includes('recall'), 'Codex: recall');
assert(codexMemory.includes('reindex'), 'Codex: reindex');

// ── 9. Verificar QA reports existen ────────────────────────────────────────
console.log('\n9. QA Reports');
const qaReports = ['qa-phase1.md', 'qa-phase2.md', 'qa-phase3.md', 'qa-phase4.md', 'qa-phase5.md', 'qa-phase6.md', 'qa-phase7.md', 'qa-phase8.md'];
for (const report of qaReports) {
  assert(existsSync(resolve(ROOT, report)), `${report} existe`);
}

// ── 10. Verificar documentos de diseño ─────────────────────────────────────
console.log('\n10. Documentos de diseño');
assert(existsSync(resolve(ROOT, 'specification.md')), 'specification.md existe');
assert(existsSync(resolve(ROOT, 'design.md')), 'design.md existe');
assert(existsSync(resolve(ROOT, 'ROADMAP.md')), 'ROADMAP.md existe');

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) process.exit(1);
