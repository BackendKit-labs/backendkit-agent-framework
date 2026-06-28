/**
 * Test rápido del Workspace Manager PROJECT
 * Simula llamadas MCP via la clase WorkspaceManager directamente
 */

import { WorkspaceManager } from './dist/WorkspaceManager.js';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PROJECTS_PATH = join(homedir(), '.backendkit', 'projects.json');

// Limpiar estado previo
if (existsSync(PROJECTS_PATH)) {
  unlinkSync(PROJECTS_PATH);
}

const wm = new WorkspaceManager();
let passed = 0;
let failed = 0;

function assert(condition, msg) {
  if (condition) {
    console.log(`  ✅ ${msg}`);
    passed++;
  } else {
    console.log(`  ❌ ${msg}`);
    failed++;
  }
}

function assertError(fn, expectedMsg) {
  try {
    fn();
    console.log(`  ❌ Se esperaba error: "${expectedMsg}" pero no hubo error`);
    failed++;
  } catch (e) {
    if (e.message.includes(expectedMsg)) {
      console.log(`  ✅ Error correcto: "${e.message}"`);
      passed++;
    } else {
      console.log(`  ❌ Error inesperado: "${e.message}" (esperaba: "${expectedMsg}")`);
      failed++;
    }
  }
}

console.log('\n🧪 Test: Workspace Manager PROJECT\n');

// ── Test 1: project_list vacío ──────────────────────────────────────────────
console.log('1. project_list sin proyectos');
const list1 = wm.list();
assert(list1.current === null, 'current es null');
assert(list1.projects.length === 0, 'projects está vacío');

// ── Test 2: project_current sin proyecto activo ─────────────────────────────
console.log('\n2. project_current sin proyecto activo');
assertError(() => wm.current(), 'No hay proyecto activo');

// ── Test 3: project_create ──────────────────────────────────────────────────
console.log('\n3. project_create');
const created = wm.create('test-project', 'C:/dev/test-project', 'Test project');
assert(created.success === true, 'create exitoso');
assert(created.project.name === 'test-project', 'nombre correcto');
assert(created.project.root === 'C:/dev/test-project', 'root correcto');
assert(created.project.agents.backend !== undefined, 'agente backend creado');
assert(created.project.agents.qa !== undefined, 'agente qa creado');
assert(created.project.agents.security !== undefined, 'agente security creado');
assert(created.project.agents.design !== undefined, 'agente design creado');
assert(created.project.agents.infra !== undefined, 'agente infra creado');
assert(created.project.memory.namespace === 'test-project', 'memoryNamespace = projectId');
assert(created.project.policies.enabled.includes('pr-require-tests'), 'policies default');
assert(created.project.gates.designReview === 'human', 'gate designReview default');

// ── Test 4: project_create con agentes parciales ────────────────────────────
console.log('\n4. project_create con agentes parciales');
const partial = wm.create('partial-project', 'C:/dev/partial', undefined, {
  backend: { model: 'gpt-4o' },
});
assert(partial.project.agents.backend.model === 'gpt-4o', 'backend model sobrescrito');
assert(Object.keys(partial.project.agents).length === 1, 'solo backend incluido (agentes parciales)');

// ── Test 5: project_create duplicado ────────────────────────────────────────
console.log('\n5. project_create duplicado');
assertError(() => wm.create('test-project', 'C:/dev/x'), 'Ya existe un proyecto');

// ── Test 6: project_create sin name ─────────────────────────────────────────
console.log('\n6. project_create sin name');
assertError(() => wm.create('', 'C:/dev/x'), 'name');

// ── Test 7: project_create sin root ─────────────────────────────────────────
console.log('\n7. project_create sin root');
assertError(() => wm.create('x', ''), 'root');

// ── Test 8: project_switch ──────────────────────────────────────────────────
console.log('\n8. project_switch');
const sw = wm.switch('test-project');
assert(sw.success === true, 'switch exitoso');
assert(sw.previous === null, 'previous es null (primer proyecto)');
assert(sw.current === 'test-project', 'current es test-project');

// ── Test 9: project_current después de switch ───────────────────────────────
console.log('\n9. project_current después de switch');
const current = wm.current();
assert(current.name === 'test-project', 'proyecto activo correcto');

// ── Test 10: project_get_agent_config ───────────────────────────────────────
console.log('\n10. project_get_agent_config');
const config = wm.getAgentConfig('backend');
assert(config.model === 'deepseek-v3', 'model correcto');
assert(config.temperature === 0.3, 'temperature correcto');
assert(config.memoryNamespace === 'test-project', 'memoryNamespace correcto');
assert(config.root === 'C:/dev/test-project', 'root correcto');
assert(config.srcPath === 'src', 'srcPath correcto');
assert(Array.isArray(config.tools), 'tools es array');

// ── Test 11: project_get_agent_config con projectId explícito ───────────────
console.log('\n11. project_get_agent_config con projectId');
const config2 = wm.getAgentConfig('backend', 'partial-project');
assert(config2.model === 'gpt-4o', 'model backend correcto (partial-project)');
assert(config2.root === 'C:/dev/partial', 'root correcto');

// ── Test 12: project_get_agent_config de agente inexistente ─────────────────
console.log('\n12. project_get_agent_config de agente inexistente');
assertError(() => wm.getAgentConfig('frontend'), 'no configurado');

// ── Test 13: project_get_root ───────────────────────────────────────────────
console.log('\n13. project_get_root');
const root = wm.getRoot();
assert(root.root === 'C:/dev/test-project', 'root correcto');
assert(root.name === 'test-project', 'name correcto');

// ── Test 14: project_get_root con projectId ─────────────────────────────────
console.log('\n14. project_get_root con projectId');
const root2 = wm.getRoot('partial-project');
assert(root2.root === 'C:/dev/partial', 'root correcto');

// ── Test 15: project_delete del activo ──────────────────────────────────────
console.log('\n15. project_delete del activo');
assertError(() => wm.delete('test-project'), 'No se puede eliminar el proyecto activo');

// ── Test 16: project_delete de inactivo ─────────────────────────────────────
console.log('\n16. project_delete de inactivo');
const del = wm.delete('partial-project');
assert(del.success === true, 'delete exitoso');
assert(del.deleted === 'partial-project', 'nombre correcto');

// ── Test 17: project_duplicate ──────────────────────────────────────────────
console.log('\n17. project_duplicate');
const dup = wm.duplicate('test-project', 'cloned-project', 'C:/dev/cloned');
assert(dup.success === true, 'duplicate exitoso');
assert(dup.project.name === 'cloned-project', 'nombre correcto');
assert(dup.project.root === 'C:/dev/cloned', 'root correcto');
assert(dup.project.memory.namespace === 'cloned-project', 'memoryNamespace actualizado');

// ── Test 18: project_update ─────────────────────────────────────────────────
console.log('\n18. project_update');
const upd = wm.update('test-project', { 'agents.backend.model': 'gpt-4o', 'gates.qaApproval': 'human' });
assert(upd.success === true, 'update exitoso');
assert(upd.changes.length === 2, '2 cambios registrados');
assert(upd.changes.some(c => c.includes('agents.backend.model')), 'cambio de model registrado');
// Verificar persistencia
const updatedConfig = wm.getAgentConfig('backend');
assert(updatedConfig.model === 'gpt-4o', 'model actualizado');

// ── Test 19: project_agent_exists ───────────────────────────────────────────
console.log('\n19. project_agent_exists');
const exists1 = wm.agentExists('backend');
assert(exists1.exists === true, 'backend existe');
assert(exists1.config !== undefined, 'config devuelta');
const exists2 = wm.agentExists('frontend');
assert(exists2.exists === false, 'frontend no existe');

// ── Test 20: workspace_policies ─────────────────────────────────────────────
console.log('\n20. workspace_policies');
const policies = wm.policies();
assert(policies.length >= 1, 'al menos 1 política');
assert(policies.some(p => p.id === 'pr-require-tests'), 'pr-require-tests incluida');

// ── Test 21: workspace_policies con filtro ──────────────────────────────────
console.log('\n21. workspace_policies con filtro');
// Crear proyecto con más políticas habilitadas para probar filtros
wm.create('filter-test', 'C:/dev/filter', undefined, undefined,
  { enabled: ['pr-require-tests', 'pr-auth-security-review', 'pr-payment-critical'] });
wm.switch('filter-test');
const filtered = wm.policies(undefined, ['auth']);
assert(filtered.some(p => p.id === 'pr-auth-security-review'), 'auth filter encuentra pr-auth-security-review');
const filtered2 = wm.policies(undefined, ['payment']);
assert(filtered2.some(p => p.id === 'pr-payment-critical'), 'payment filter encuentra pr-payment-critical');
// Volver al proyecto original
wm.switch('test-project');

// ── Test 22: workspace_gate_config ──────────────────────────────────────────
console.log('\n22. workspace_gate_config');
const gates = wm.gateConfig();
assert(gates.designReview === 'human', 'designReview default');
assert(gates.securityReview === 'auto', 'securityReview default');

// ── Test 23: workspace_memory_config ────────────────────────────────────────
console.log('\n23. workspace_memory_config');
const mem = wm.memoryConfig();
assert(mem.namespace === 'test-project', 'namespace correcto');
assert(mem.enabled === true, 'enabled true');

// ── Test 24: project_switch idempotente ─────────────────────────────────────
console.log('\n24. project_switch al mismo proyecto');
const sw2 = wm.switch('test-project');
assert(sw2.success === true, 'switch idempotente');
assert(sw2.previous === 'test-project', 'previous = current');

// ── Test 25: Persistencia ───────────────────────────────────────────────────
console.log('\n25. Persistencia (simular reinicio)');
const wm2 = new WorkspaceManager();
const list2 = wm2.list();
assert(list2.projects.length >= 2, 'proyectos persisten después de reinicio');
const current2 = wm2.current();
assert(current2.name === 'test-project', 'proyecto activo persiste');

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Resultados: ${passed} pasaron, ${failed} fallaron`);
console.log(`${'='.repeat(50)}`);

if (failed > 0) {
  process.exit(1);
}
